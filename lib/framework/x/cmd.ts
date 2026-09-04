// Cmd — subprocess + PATH resolution facade.
// Re-export of execCapture / spawnDetached / spawnDetachedLogged / which /
// resolveExecutable.

/**
 * Unified command facade for dc-framework.
 *
 * Wraps execCapture, spawnDetached, spawnDetachedLogged, which, and
 * resolveExecutable behind a single const object so consumers can
 * `Cmd.run(...)`, `Cmd.which(...)`, etc.
 *
 * @module dc-framework/x/cmd
 */

import {
  execCapture,
  spawnDetached,
  spawnDetachedLogged,
  which as whichSync,
  readTextTail,
  type DetachedLogOpts,
  type DetachedLogProcess,
  type DetachedLogExit,
  type ExecOpts,
  type ExecResult,
  type TailTextResult,
} from "../lib/_exec.ts";
import {
  resolveExecutable,
  resolveExecutableAsync,
} from "../lib/_executable-resolve.ts";

export type {
  DetachedLogExit,
  DetachedLogOpts,
  DetachedLogProcess,
  ExecOpts,
  ExecResult,
  TailTextResult,
};

const OUTPUT_PREVIEW_BYTES = 500;

function preview(text: string): string {
  return text.slice(0, OUTPUT_PREVIEW_BYTES);
}

function parseJsonOutput<T>(stdout: string, label: string): T {
  const text = stdout.trim();
  if (!text) {
    throw new Error(`${label} produced no stdout to parse as JSON`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${label} produced invalid JSON: ${message}. stdout preview: ${preview(text)}`,
    );
  }
}

function parseJsonLinesOutput<T>(stdout: string, label: string): T[] {
  const rows: T[] = [];
  const lines = stdout.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      rows.push(JSON.parse(line) as T);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${label} produced invalid JSONL on line ${i + 1}: ${message}. line preview: ${preview(line)}`,
      );
    }
  }
  return rows;
}

export const Cmd = {
  /** Run a command, capture stdout/stderr. Never throws on non-zero exit. */
  run(cmd: string[], opts?: ExecOpts): Promise<ExecResult> {
    return execCapture(cmd, opts);
  },

  /** Parse a command result's stdout as JSON. Throws with command context on malformed output. */
  parseJson<T = unknown>(
    result: Pick<ExecResult, "stdout">,
    label = "command",
  ): T {
    return parseJsonOutput<T>(result.stdout, label);
  },

  /** Parse a command result's stdout as JSON Lines, ignoring blank lines. */
  parseJsonLines<T = unknown>(
    result: Pick<ExecResult, "stdout">,
    label = "command",
  ): T[] {
    return parseJsonLinesOutput<T>(result.stdout, label);
  },

  /** Fire-and-forget detached child. Returns pid immediately. */
  detached(
    cmd: string[],
    opts?: { cwd?: string; env?: NodeJS.ProcessEnv },
  ): { pid: number } {
    return spawnDetached(cmd, opts);
  },

  /** Detached child whose stdout/stderr are written to `opts.logPath`. */
  detachedLogged(cmd: string[], opts: DetachedLogOpts): DetachedLogProcess {
    return spawnDetachedLogged(cmd, opts);
  },

  /** Read a bounded UTF-8 tail from a command log. */
  tailText(logPath: string, maxBytes: number): TailTextResult {
    return readTextTail(logPath, maxBytes);
  },

  /** Resolve a binary synchronously. Checks fallbackPaths first, then PATH. */
  which(bin: string, fallbackPaths?: string[]): string | null {
    if (fallbackPaths && fallbackPaths.length > 0) {
      return resolveExecutable(bin, fallbackPaths) ?? null;
    }
    return whichSync(bin);
  },

  /** Async version of which. Prefer in async contexts. */
  async whichAsync(
    bin: string,
    fallbackPaths?: string[],
  ): Promise<string | null> {
    return (await resolveExecutableAsync(bin, fallbackPaths ?? [])) ?? null;
  },
};
