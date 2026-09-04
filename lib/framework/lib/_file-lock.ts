/**
 * File lock with stale-PID cleanup and retry-with-backoff.
 *
 * Uses O_EXCL (flag "wx") to atomically create the lock file — no race condition.
 * If the lock file exists, checks whether the owning PID is still alive (kill(pid, 0)).
 * If the PID is gone (ESRCH), cleans up the stale lock and retries.
 *
 * Adapted from: https://github.com/a5c-ai/babysitter
 * Source: packages/sdk/src/storage/lock.ts
 * Source SHA: d97a2e46a84cbc3ca4589050a9bddbcbf792a785
 * Changes: extracted standalone, removed babysitter path/clock imports, simplified types
 * Date: 2026-04-26
 *
 * Use for: concurrent pi sessions writing to the same state directory,
 * future dc-runner coordinating child processes, multi-process state files.
 */

import { promises as fs } from "fs";

export interface LockInfo {
  pid: number;
  owner: string;
  acquiredAt: string;
}

/**
 * Attempt to acquire an exclusive lock file at `lockPath`.
 *
 * Writes a JSON file with PID, owner name, and ISO timestamp.
 * If the lock file exists and the owning process is dead (ESRCH),
 * cleans up the stale lock and retries once.
 *
 * @throws Error if lock is held by a live process
 */
/** Rename a (presumed stale/corrupt) lock aside and discard it. Atomic: of two
 *  contenders, only one rename succeeds — the loser gets ENOENT and just retries. */
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
            // safe to restore; the residual window here needs a triple
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

/**
 * Release a lock file (delete it).
 */
async function releaseLock(lockPath: string): Promise<void> {
  await fs.rm(lockPath, { force: true });
}

/**
 * Read the current lock info, or null if no lock exists.
 */
async function readLock(lockPath: string): Promise<LockInfo | null> {
  try {
    const data = await fs.readFile(lockPath, "utf8");
    return JSON.parse(data) as LockInfo;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    throw error;
  }
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
