/**
 * Atomic file write with fsync + retry on transient errors.
 *
 * Pattern: write to temp file → fsync → rename over target → fsync parent dir.
 * Retries EBUSY/ETXTBSY/EPERM/EACCES with linear backoff (25 ms × attempt).
 * Falls back to direct write if rename fails with ENOENT (e.g. parent created
 * between mkdir and rename on some platforms).
 *
 * Adapted from: https://github.com/a5c-ai/babysitter
 * Source: packages/sdk/src/storage/atomic.ts
 * Source SHA: d97a2e46a84cbc3ca4589050a9bddbcbf792a785
 * Changes: extracted standalone, no babysitter imports, added sync variant
 * Date: 2026-04-26
 *
 * Why this is better than the simpler writeFileSync+renameSync pattern
 * used in dc-memory, dc-tasks, process-registry, and mailbox:
 *   1. fsync before rename ensures data is on disk before the old file is unlinked
 *   2. fsync on parent dir ensures rename is durable (some filesystems)
 *   3. Retry on transient errors (EBUSY, EPERM) — common on macOS with iCloud
 *   4. ENOENT fallback — covers the case where a concurrent process deletes the target
 */

import { promises as fs } from "fs";
import {
  mkdirSync,
  renameSync,
  writeFileSync,
  closeSync,
  openSync,
  fsyncSync,
  rmSync,
} from "fs";
import path from "path";

const RETRYABLE_ERRORS = new Set(["EBUSY", "ETXTBSY", "EPERM", "EACCES"]);

// ── Async variant ────────────────────────────────────────────────────────────

async function fsyncPath(targetPath: string) {
  const handle = await fs.open(targetPath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Write `data` to `targetPath` atomically (async).
 *
 * Writes to a temp file, fsyncs, renames over target, fsyncs parent dir.
 * Retries on transient filesystem errors up to `retries` times with
 * linear backoff (25ms × attempt).
 */
export async function writeFileAtomic(
  targetPath: string,
  data: string | Buffer,
  retries = 3,
) {
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

// ── Sync variant ─────────────────────────────────────────────────────────────

/**
 * Write `data` to `targetPath` atomically (sync).
 *
 * For use in contexts where async is not possible (e.g. extension unload).
 * Simpler than the async variant — no retry, but still does temp + rename.
 */
export function writeFileAtomicSync(targetPath: string, data: string | Buffer) {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;

  const fd = openSync(tempPath, "w");
  try {
    if (typeof data === "string") {
      writeFileSync(fd, data, "utf8");
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
    // If rename fails, try direct write as fallback
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
