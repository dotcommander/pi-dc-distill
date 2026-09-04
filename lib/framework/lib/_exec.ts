/**
 * Portable subprocess helpers — Node-native replacements for Bun.spawn / Bun.which.
 *
 * execCapture  — spawn + capture stdout/stderr; always resolves, never throws on exit code.
 * which        — synchronous PATH scan; returns absolute path or null.
 * spawnDetached — fire-and-forget detached child; returns pid.
 * spawnDetachedLogged — detached child with stdout/stderr written to a log file.
 */

import { spawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
} from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";

/** Fallback timeout if 'close' never fires after SIGKILL (rare kernel edge). */
const WATCHDOG_MS = 5_000;

export interface ExecOpts {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** UTF-8 string or Buffer to pipe into stdin. */
  stdin?: string | Buffer;
  /** Wall-clock timeout in ms. SIGKILLs the child on expiry. */
  timeoutMs?: number;
  /** Hard cap on captured stdout/stderr (per stream). Default: 16 MiB. */
  maxBuffer?: number;
  /**
   * Kill the whole child process group on timeout/abort where supported.
   * Defaults to true on POSIX so shell commands cannot leave descendants behind.
   */
  killProcessGroup?: boolean;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** True if killed by timeoutMs or by the supplied signal. */
  killed: boolean;
  /** True if stdout or stderr was capped at maxBuffer. */
  truncated: boolean;
}

export interface DetachedLogOpts {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** File path receiving stdout and stderr. Parent directories are created. */
  logPath: string;
  /**
   * Kill the whole child process group on kill/abort where supported.
   * Defaults to true on POSIX so shell commands cannot leave descendants behind.
   */
  killProcessGroup?: boolean;
}

export interface DetachedLogExit {
  exitCode: number | null;
  /** True if killed by kill() or by the supplied signal. */
  killed: boolean;
  /** Spawn/runtime error surfaced through child_process 'error'. */
  error?: Error;
}

export interface DetachedLogProcess {
  pid: number;
  logPath: string;
  exit: Promise<DetachedLogExit>;
  kill(signal?: NodeJS.Signals): void;
}

export interface TailTextResult {
  text: string;
  truncated: boolean;
  bytesRead: number;
  fileBytes: number;
}

const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;
const SHELL_METACHARS = /[;&|$`()<>\n\r]/;

function isExecutableFile(path: string): boolean {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) {
      return false;
    }
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isValidExecutableLookup(bin: string): boolean {
  if (bin.trim() !== bin || bin.length === 0) {
    return false;
  }
  if (SHELL_METACHARS.test(bin)) {
    return false;
  }
  if (!isAbsolute(bin) && /\s/.test(bin)) {
    return false;
  }
  if (!isAbsolute(bin) && /[\\/]/.test(bin)) {
    return false;
  }
  return true;
}

/**
 * Spawn `cmd[0]` with `cmd.slice(1)` as argv. Captures stdout+stderr.
 * Never throws on non-zero exit — caller inspects `exitCode`.
 * Throws only on spawn failure (ENOENT, EACCES) — surface `err.code` to callers.
 *
 * Equivalent to the Bun.spawn + new Response(proc.stdout).text() + proc.exited
 * idiom used across extensions.
 */
export function execCapture(
  cmd: string[],
  opts?: ExecOpts,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    if (opts?.signal?.aborted) {
      return reject(new Error("aborted"));
    }
    const maxBuffer = opts?.maxBuffer ?? DEFAULT_MAX_BUFFER;
    const killProcessGroup =
      opts?.killProcessGroup ?? process.platform !== "win32";
    const spawnOpts: SpawnOptions = {
      cwd: opts?.cwd,
      env: opts?.env ?? process.env,
      stdio: [opts?.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
      detached: killProcessGroup,
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd[0], cmd.slice(1), spawnOpts);
    } catch (err) {
      return reject(err);
    }

    // Spawn errors surface through the error event, not the try/catch above.
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });

    let killed = false;
    let truncated = false;
    let stdinClosed = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const appendCapped = (chunks: Buffer[], chunk: Buffer, current: number) => {
      const remaining = maxBuffer - current;
      if (remaining <= 0) {
        truncated = true;
        return current;
      }
      if (chunk.length > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        truncated = true;
        return maxBuffer;
      }
      chunks.push(chunk);
      return current + chunk.length;
    };

    const capturedText = (chunks: Buffer[], length: number): string => {
      return Buffer.concat(chunks, length).toString("utf8");
    };

    (child.stdout as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
      stdoutBytes = appendCapped(stdoutChunks, chunk, stdoutBytes);
    });

    (child.stderr as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
      stderrBytes = appendCapped(stderrChunks, chunk, stderrBytes);
    });

    // Wall-clock timeout.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    // Idempotent teardown for every settle path: both timers + the abort listener
    // (and its closure over `child`). Safe to call more than once.
    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (watchdog !== undefined) {
        clearTimeout(watchdog);
        watchdog = undefined;
      }
      opts?.signal?.removeEventListener("abort", onAbort);
    };
    const forceSettle = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        stdout: capturedText(stdoutChunks, stdoutBytes),
        stderr: capturedText(stderrChunks, stderrBytes),
        exitCode: -1,
        killed: true,
        truncated,
      });
    };
    const killChild = () => {
      try {
        if (killProcessGroup && child.pid && process.platform !== "win32") {
          process.kill(-child.pid, "SIGKILL");
          return;
        }
      } catch {
        // Fall back to killing the direct child if process-group kill fails.
      }
      child.kill("SIGKILL");
    };

    if (opts?.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        killed = true;
        killChild();
        // If 'close' never fires (rare kernel edge), force-settle after watchdog
        watchdog = setTimeout(forceSettle, WATCHDOG_MS);
      }, opts.timeoutMs);
    }

    // External abort signal.
    const onAbort = () => {
      killed = true;
      killChild();
      if (watchdog === undefined) {
        watchdog = setTimeout(forceSettle, WATCHDOG_MS);
      }
    };
    opts?.signal?.addEventListener("abort", onAbort);

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      stdinClosed = true;
      cleanup();
      resolve({
        stdout: capturedText(stdoutChunks, stdoutBytes),
        stderr: capturedText(stderrChunks, stderrBytes),
        exitCode: killed ? -1 : (code ?? -1),
        killed,
        truncated,
      });
    });

    // Feed stdin asynchronously in chunks, yielding to the event loop to ensure
    // stdout/stderr keep draining. Even with node:child_process, manual chunking
    // and setImmediate() are safer in shimmed environments (like Bun) to prevent
    // pipe-saturation deadlocks during large multi-edit payloads.
    if (opts?.stdin !== undefined && child.stdin) {
      const stdin = child.stdin;
      stdin.on("error", () => {
        // EPIPE / ECONNRESET — child closed its read end. Swallow; the close handler
        // resolves the promise with whatever stdout/stderr we captured.
        stdinClosed = true;
      });
      const data =
        typeof opts.stdin === "string"
          ? Buffer.from(opts.stdin, "utf8")
          : opts.stdin;
      let offset = 0;
      const chunkSize = 65536; // 64 KiB

      const writeNext = () => {
        if (
          killed ||
          stdinClosed ||
          (child as { destroyed?: boolean }).destroyed
        )
          return;

        if (offset >= data.length) {
          stdin.end();
          return;
        }

        const chunk = data.slice(offset, offset + chunkSize);
        offset += chunkSize;

        const ok = stdin.write(chunk);
        if (ok) {
          // Yield to event loop to allow stdout/stderr 'data' events to fire
          setImmediate(writeNext);
        } else {
          // Kernel buffer full — race 'drain' against the pipe closing under us.
          // Whichever fires first wakes writeNext; the bail check at the top
          // short-circuits if the pipe died.
          const wake = () => {
            stdin.removeListener("drain", wake);
            stdin.removeListener("close", wake);
            writeNext();
          };
          stdin.once("drain", wake);
          stdin.once("close", wake);
        }
      };

      writeNext();
    }
  });
}

/**
 * Synchronous PATH scan. Returns the absolute path of `bin` or null.
 * Honors the current PATH env. Accepts bare executable names and absolute
 * executable paths only; invalid shell-like input returns null.
 * Equivalent to Bun.which() for the bin-resolution use case.
 */
export function which(bin: string): string | null {
  if (!isValidExecutableLookup(bin)) {
    return null;
  }
  if (isAbsolute(bin)) {
    return isExecutableFile(bin) ? bin : null;
  }

  const parts = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of parts) {
    const candidate = join(dir, bin);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Spawn detached fire-and-forget child. Returns the pid. Caller does NOT
 * await exit. Stdout/stderr default to "ignore". Used by long-running
 * processes (repoflow serve) and spill-to-background work.
 */
export function spawnDetached(
  cmd: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv },
): { pid: number } {
  const child = spawn(cmd[0], cmd.slice(1), {
    detached: true,
    stdio: "ignore",
    cwd: opts?.cwd,
    env: opts?.env ?? process.env,
  });
  child.on("error", () => {
    /* fire-and-forget: spawn failure is non-fatal */
  });
  child.unref();
  return { pid: child.pid! };
}

/**
 * Spawn a detached child while writing stdout and stderr directly to a log fd.
 * This is for background work whose output must remain inspectable without
 * buffering it in the Pi process. The caller owns retention and cleanup of
 * `logPath`.
 */
export function spawnDetachedLogged(
  cmd: string[],
  opts: DetachedLogOpts,
): DetachedLogProcess {
  mkdirSync(dirname(opts.logPath), { recursive: true });
  const logFd = openSync(opts.logPath, "w");
  const killProcessGroup =
    opts.killProcessGroup ?? process.platform !== "win32";

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(cmd[0], cmd.slice(1), {
      detached: killProcessGroup,
      stdio: ["ignore", logFd, logFd],
      cwd: opts.cwd,
      env: opts.env ?? process.env,
    });
  } finally {
    closeSync(logFd);
  }

  let killed = false;
  let settled = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;

  const kill = (signal: NodeJS.Signals = "SIGTERM") => {
    killed = true;
    try {
      if (killProcessGroup && child.pid && process.platform !== "win32") {
        process.kill(-child.pid, signal);
        return;
      }
    } catch {
      // Fall back to killing the direct child if process-group kill fails.
    }
    child.kill(signal);
  };

  const onAbort = () => {
    kill("SIGTERM");
    if (watchdog === undefined) {
      watchdog = setTimeout(() => {
        if (!settled) kill("SIGKILL");
      }, WATCHDOG_MS);
    }
  };

  const cleanup = () => {
    if (watchdog !== undefined) {
      clearTimeout(watchdog);
      watchdog = undefined;
    }
    opts.signal?.removeEventListener("abort", onAbort);
  };

  const exit = new Promise<DetachedLogExit>((resolve) => {
    const settle = (result: DetachedLogExit) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    child.on("close", (code) => {
      settle({ exitCode: code, killed });
    });
    child.on("error", (error) => {
      settle({ exitCode: -1, killed, error });
    });
  });

  if (opts.signal?.aborted) onAbort();
  else opts.signal?.addEventListener("abort", onAbort, { once: true });

  child.unref();

  return {
    pid: child.pid ?? -1,
    logPath: opts.logPath,
    exit,
    kill,
  };
}

/** Read at most `maxBytes` from the end of a UTF-8 text file. */
export function readTextTail(logPath: string, maxBytes: number): TailTextResult {
  if (!Number.isFinite(maxBytes) || maxBytes < 1) {
    throw new Error("maxBytes must be a positive finite number");
  }

  const fd = openSync(logPath, "r");
  try {
    const { size } = fstatSync(fd);
    const bytesRead = Math.min(size, Math.floor(maxBytes));
    const buffer = Buffer.alloc(bytesRead);
    readSync(fd, buffer, 0, bytesRead, Math.max(0, size - bytesRead));
    return {
      text: buffer.toString("utf8"),
      truncated: size > bytesRead,
      bytesRead,
      fileBytes: size,
    };
  } finally {
    closeSync(fd);
  }
}
