/**
 * Atomic JSON KV storage. Four corruption modes (default/quarantine/throw/quarantine-throw)
 * for divergent legacy semantics — see dc-memory/{index,edges,state}.ts.
 * quarantine-throw: rename corrupt file to <path>.corrupt-<ts>, then throw (dc-memory atomicRead semantics).
 */

import {
  existsSync,
  openSync,
  closeSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  linkSync,
  readFileSync,
} from "fs";
import { writeFileAtomicSync } from "./_atomic-write.ts";

export interface JsonStoreOptions {
  /** When file is missing OR JSON parse fails, what should read() do? */
  onCorrupt?: "default" | "quarantine" | "throw" | "quarantine-throw"; // default: "default"
  /** Pretty-print written JSON (2-space indent). default: true */
  pretty?: boolean;
}

export class JsonStore<T> {
  private readonly path: string;
  private readonly defaults: T;
  private readonly onCorrupt:
    | "default"
    | "quarantine"
    | "throw"
    | "quarantine-throw";
  private readonly pretty: boolean;

  constructor(path: string, defaults: T, opts?: JsonStoreOptions) {
    this.path = path;
    this.defaults = defaults;
    this.onCorrupt = opts?.onCorrupt ?? "default";
    this.pretty = opts?.pretty ?? true;
  }

  /** Sync — returns parsed value, or defaults on missing/corrupt (per onCorrupt). */
  read(): T {
    if (!existsSync(this.path)) {
      return structuredClone(this.defaults);
    }
    try {
      return JSON.parse(readFileSync(this.path, "utf-8")) as T;
    } catch {
      if (this.onCorrupt === "throw") {
        throw new Error(`JsonStore: corrupt JSON at ${this.path}`);
      }
      if (
        this.onCorrupt === "quarantine" ||
        this.onCorrupt === "quarantine-throw"
      ) {
        const bak = `${this.path}.corrupt-${Date.now()}`;
        try {
          renameSync(this.path, bak);
        } catch {
          // best-effort
        }
        if (this.onCorrupt === "quarantine-throw") {
          throw new Error(
            `JsonStore: corrupt JSON at ${this.path}, quarantined to ${bak}`,
          );
        }
      }
      return structuredClone(this.defaults);
    }
  }

  /** Sync — atomic write via writeFileAtomicSync. */
  write(value: T): void {
    const body = this.pretty
      ? JSON.stringify(value, null, 2) + "\n"
      : JSON.stringify(value) + "\n";
    writeFileAtomicSync(this.path, body);
  }

  /**
   * Sync — read → fn(current) → write, all under O_EXCL file-lock.
   * Lock release is in a finally block so a thrown fn does not leak the lock.
   * On contention, retries (default 20 × 25 ms) with a blocking sleep —
   * this method is synchronous and stalls the event loop while waiting.
   * Returns the new value.
   */
  update(
    fn: (current: T) => T,
    opts?: { retries?: number; delayMs?: number },
  ): T {
    const { retries = 20, delayMs = 25 } = opts ?? {};
    const lockPath = `${this.path}.lock`;
    let lockFd: number | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        lockFd = acquireLockSync(lockPath);
        break;
      } catch (err) {
        const held =
          err instanceof Error && err.message.includes("lock held");
        if (!held || attempt >= retries) throw err;
        sleepSync(delayMs);
      }
    }
    try {
      const current = this.read();
      const next = fn(current);
      this.write(next);
      return next;
    } finally {
      releaseLockSync(lockFd, lockPath);
    }
  }

  /**
   * Sync — returns true iff the file exists and parses without falling back to defaults.
   * Useful for "first run?" checks.
   */
  exists(): boolean {
    if (!existsSync(this.path)) return false;
    try {
      JSON.parse(readFileSync(this.path, "utf-8"));
      return true;
    } catch {
      return false;
    }
  }
}

// ── Sync lock helpers (O_EXCL — same takeover algorithm as _file-lock.ts) ──

/** Blocking sleep without spinning. Atomics.wait stalls the thread for ms. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Rename a (presumed stale/corrupt) lock aside and discard it. Atomic: of two
 *  contenders, only one rename succeeds — the loser throws and just retries. */
function discardLockSync(lockPath: string): void {
  const aside = `${lockPath}.takeover-${process.pid}-${Date.now()}`;
  renameSync(lockPath, aside);
  try {
    unlinkSync(aside);
  } catch {
    /* best-effort */
  }
}

function acquireLockSync(lockPath: string, depth = 0): number {
  if (depth > 5) {
    throw new Error(`JsonStore: lock contention, gave up at ${lockPath}`);
  }
  try {
    const fd = openSync(lockPath, "wx");
    writeFileSync(fd, JSON.stringify({ pid: process.pid }) + "\n", "utf-8");
    return fd;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "EEXIST") throw err;

    let observed: { pid: number };
    try {
      observed = JSON.parse(readFileSync(lockPath, "utf-8")) as {
        pid: number;
      };
    } catch {
      // Unparseable lock — discard via atomic rename (NOT unlink: of two
      // contenders only one rename wins, so we can't delete a fresh lock
      // written after our read).
      try {
        discardLockSync(lockPath);
      } catch {
        /* another contender cleaned up first */
      }
      return acquireLockSync(lockPath, depth + 1);
    }

    let alive = true;
    try {
      process.kill(observed.pid, 0);
    } catch (killErr) {
      alive = (killErr as NodeJS.ErrnoException).code !== "ESRCH";
    }
    if (alive) {
      throw new Error(`JsonStore: lock held at ${lockPath}`);
    }

    // Stale lock — owner is dead. Take it over by atomic rename, verify we
    // renamed the SAME stale lock we observed; if a new owner slipped in
    // between read and rename, restore their lock with link() (fails EEXIST
    // rather than clobbering) and report contention.
    const aside = `${lockPath}.takeover-${process.pid}-${Date.now()}`;
    try {
      renameSync(lockPath, aside);
    } catch {
      return acquireLockSync(lockPath, depth + 1); // another contender won
    }
    let renamed: { pid: number } | undefined;
    try {
      renamed = JSON.parse(readFileSync(aside, "utf-8")) as { pid: number };
    } catch {
      renamed = undefined; // unreadable — treat as the corrupt lock we saw
    }
    if (renamed && renamed.pid !== observed.pid) {
      // We grabbed a FRESH lock written after our read. Put it back.
      try {
        linkSync(aside, lockPath);
      } catch {
        /* lockPath re-acquired by a third process — nothing safe to restore */
      }
      try {
        unlinkSync(aside);
      } catch {
        /* best-effort */
      }
      throw new Error(`JsonStore: lock held at ${lockPath}`);
    }
    try {
      unlinkSync(aside);
    } catch {
      /* best-effort */
    }
    return acquireLockSync(lockPath, depth + 1);
  }
}

function releaseLockSync(fd: number | undefined, lockPath: string): void {
  if (fd !== undefined) {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
  }
  // Best-effort delete the lock file
  try {
    unlinkSync(lockPath);
  } catch {
    /* ignore */
  }
}
