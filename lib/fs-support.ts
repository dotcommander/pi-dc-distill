/**
 * Fs — owned port of the consumed dc-framework filesystem surface.
 *
 * Atomic writes: temp file → fsync → rename over target → fsync parent dir,
 * with retry on transient errors (EBUSY/ETXTBSY/EPERM/EACCES) and an ENOENT
 * direct-write fallback. Sync variant skips retry but keeps temp+rename.
 *
 * File lock: O_EXCL ("wx") creation, stale-PID detection via `kill(pid, 0)`,
 * atomic-rename takeover of dead-owner locks with fresh-lock restore via
 * `link()`, and retry-with-backoff on live contention.
 *
 * Semantics are byte-ports of dc-framework `_atomic-write.ts` and
 * `_file-lock.ts` (themselves adapted from a5c-ai/babysitter
 * packages/sdk/src/storage/{atomic,lock}.ts @ d97a2e46a). The framework's
 * `JsonStore` is NOT ported: no product consumer uses it (see
 * `.work/prds/deframework-owned-surface.md` Source Baseline).
 *
 * @module lib/fs-support
 */

import { promises as fs } from "node:fs";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const RETRYABLE_ERRORS = new Set(["EBUSY", "ETXTBSY", "EPERM", "EACCES"]);

// ── Atomic write (async) ─────────────────────────────────────────────────────

async function fsyncPath(targetPath: string): Promise<void> {
  const handle = await fs.open(targetPath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Atomic write (async): temp → fsync → rename → fsync parent dir, with retry. */
export async function writeFileAtomic(
  targetPath: string,
  data: string | Buffer,
  retries = 3,
): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  const handle = await fs.open(tempPath, "w");
  try {
    if (typeof data === "string") {
      await handle.writeFile(data, "utf8");
    } else {
      await handle.writeFile(data);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await fs.rename(tempPath, targetPath);
      await fsyncPath(path.dirname(targetPath));
      return;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      // ENOENT: parent dir or temp file vanished — fall back to direct write
      if (err.code === "ENOENT") {
        await fs.writeFile(targetPath, data);
        await fs.rm(tempPath, { force: true }).catch(() => {});
        return;
      }
      if (attempt === retries || !err.code || !RETRYABLE_ERRORS.has(err.code)) {
        await fs.rm(tempPath, { force: true });
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 25));
    }
  }
}

// ── Atomic write (sync) ──────────────────────────────────────────────────────

/** Atomic write (sync): temp + fsync + rename. No retry (unload contexts). */
export function writeFileAtomicSync(
  targetPath: string,
  data: string | Buffer,
): void {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;

  const fd = openSync(tempPath, "w");
  try {
    if (typeof data === "string") {
      writeFileSync(fd, data, "utf-8");
    } else {
      writeFileSync(fd, data);
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  try {
    renameSync(tempPath, targetPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    // If rename fails with ENOENT, try direct write as fallback
    if (err.code === "ENOENT") {
      writeFileSync(targetPath, data);
      try {
        rmSync(tempPath, { force: true });
      } catch {
        // best-effort cleanup
      }
      return;
    }
    throw err;
  }
}

// ── File lock ────────────────────────────────────────────────────────────────

export interface LockInfo {
  pid: number;
  owner: string;
  acquiredAt: string;
}

/** Rename a (presumed stale/corrupt) lock aside and discard it. Atomic: of two
 *  contenders, only one rename succeeds — the loser gets ENOENT and retries. */
async function discardLock(lockPath: string): Promise<void> {
  const aside = `${lockPath}.takeover-${process.pid}-${Date.now()}`;
  await fs.rename(lockPath, aside);
  await fs.rm(aside, { force: true });
}

async function acquireLock(
  lockPath: string,
  owner: string,
  depth = 0,
): Promise<LockInfo> {
  if (depth > 5) {
    throw new Error(`Lock contention: gave up cleaning ${lockPath}`);
  }
  const lockInfo: LockInfo = {
    pid: process.pid,
    owner,
    acquiredAt: new Date().toISOString(),
  };
  try {
    // "wx" = O_CREAT | O_EXCL — fails if file exists
    await fs.writeFile(lockPath, JSON.stringify(lockInfo, null, 2) + "\n", {
      flag: "wx",
    });
    return lockInfo;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "EEXIST") throw err;

    // Lock file exists — check if owner is still alive
    let existing: LockInfo;
    try {
      existing = JSON.parse(await fs.readFile(lockPath, "utf8")) as LockInfo;
    } catch {
      // Unparseable lock — discard via atomic rename (NOT unlink: of two
      // contenders only one rename wins, so we can't delete a fresh lock
      // written after our read).
      await discardLock(lockPath).catch(() => {});
      return acquireLock(lockPath, owner, depth + 1);
    }
    try {
      process.kill(existing.pid, 0); // throws if PID doesn't exist
    } catch (killError) {
      const killErr = killError as NodeJS.ErrnoException;
      if (killErr.code === "ESRCH") {
        // Stale lock — owner process is dead. Take it over by atomic rename,
        // then verify we renamed the SAME stale lock we observed; if a new
        // owner slipped in between read and rename, restore their lock with
        // link() (fails EEXIST rather than clobbering) and report contention.
        const aside = `${lockPath}.takeover-${process.pid}-${Date.now()}`;
        try {
          await fs.rename(lockPath, aside);
        } catch {
          // Another contender cleaned up first — just retry.
          return acquireLock(lockPath, owner, depth + 1);
        }
        let renamed: LockInfo | undefined;
        try {
          renamed = JSON.parse(await fs.readFile(aside, "utf8")) as LockInfo;
        } catch {
          renamed = undefined; // unreadable — treat as the corrupt lock we saw
        }
        if (renamed && renamed.pid !== existing.pid) {
          // We grabbed a FRESH lock written after our read. Put it back.
          try {
            await fs.link(aside, lockPath);
          } catch {
            // lockPath re-acquired by a third process meanwhile — nothing
            // safe to restore; the residual window needs a triple
            // interleaving within microseconds.
          }
          await fs.rm(aside, { force: true });
          throw new Error(
            `Lock held by pid ${renamed.pid} (${renamed.owner}), acquired at ${renamed.acquiredAt}`,
          );
        }
        await fs.rm(aside, { force: true });
        return acquireLock(lockPath, owner, depth + 1);
      }
    }
    throw new Error(
      `Lock held by pid ${existing.pid} (${existing.owner}), acquired at ${existing.acquiredAt}`,
    );
  }
}

async function releaseLock(lockPath: string): Promise<void> {
  await fs.rm(lockPath, { force: true });
}

/**
 * Execute `fn` while holding an exclusive lock, with retry on contention.
 *
 * @param lockPath  Path to the lock file
 * @param owner     Identity string for the lock holder
 * @param fn        Function to execute while holding the lock
 * @param retries   Max retry attempts (default 40)
 * @param delayMs   Delay between retries in ms (default 250)
 */
export async function withLock<T>(
  lockPath: string,
  owner: string,
  fn: () => Promise<T>,
  { retries = 40, delayMs = 250 }: { retries?: number; delayMs?: number } = {},
): Promise<T> {
  let acquired = false;
  const maxAttempts = Math.max(0, Math.floor(retries));

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try {
      await acquireLock(lockPath, owner);
      acquired = true;
      break;
    } catch (error) {
      const isLockHeld =
        error instanceof Error && error.message.startsWith("Lock held by");
      if (!isLockHeld || attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  try {
    return await fn();
  } finally {
    if (acquired) {
      await releaseLock(lockPath);
    }
  }
}

// ── Fs facade ────────────────────────────────────────────────────────────────

export const Fs = {
  /** UTF-8 read. Throws on missing file (ENOENT) — caller decides recovery. */
  read(path: string): Promise<string> {
    return fs.readFile(path, "utf-8");
  },

  /** Non-throwing existence check. */
  exists(path: string): Promise<boolean> {
    return fs
      .access(path)
      .then(() => true)
      .catch(() => false);
  },

  /** Atomic write (async): temp → fsync → rename → fsync parent dir, with retry. */
  write(
    targetPath: string,
    data: string | Buffer,
    retries?: number,
  ): Promise<void> {
    return writeFileAtomic(targetPath, data, retries);
  },

  /** Atomic write (sync): temp + rename. For contexts where async is not possible. */
  writeSync(targetPath: string, data: string | Buffer): void {
    writeFileAtomicSync(targetPath, data);
  },

  /** Execute `fn` while holding an exclusive O_EXCL lock, with retry on contention. */
  withLock<T>(
    lockPath: string,
    owner: string,
    fn: () => Promise<T>,
    opts?: { retries?: number; delayMs?: number },
  ): Promise<T> {
    return withLock(lockPath, owner, fn, opts);
  },
};
