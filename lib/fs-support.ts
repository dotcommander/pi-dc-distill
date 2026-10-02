/** Owned atomic filesystem writes and conservatively exclusive hard-link locks. */

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
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Publish by rename only: failure never degrades to a destructive direct write. */
export async function writeFileAtomic(targetPath: string, data: string | Buffer, retries = 3, beforePublish?: () => void): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    const handle = await fs.open(tempPath, "wx");
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    for (let attempt = 0; ; attempt++) {
      try { beforePublish?.(); await fs.rename(tempPath, targetPath); break; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= retries || !code || !RETRYABLE_ERRORS.has(code)) throw error;
        await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 25));
      }
    }
    await fsyncPath(path.dirname(targetPath));
  } finally { await fs.rm(tempPath, { force: true }).catch(() => {}); }
}

export function writeFileAtomicSync(targetPath: string, data: string | Buffer): void {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    const fd = openSync(tempPath, "wx");
    try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tempPath, targetPath);
    const directory = openSync(path.dirname(targetPath), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally { try { rmSync(tempPath, { force: true }); } catch {} }
}

export interface LockInfo {
  pid: number;
  owner: string;
  acquiredAt: string;
  nonce: string;
  dev: number;
  ino: number;
}

/** Complete metadata is fsynced before the hard link makes the lock visible. */
async function acquireLock(lockPath: string, owner: string): Promise<LockInfo> {
  const tempPath = `${lockPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    const handle = await fs.open(tempPath, "wx");
    let info: LockInfo;
    try {
      const identity = await handle.stat();
      info = { pid: process.pid, owner, acquiredAt: new Date().toISOString(), nonce: crypto.randomUUID(), dev: identity.dev, ino: identity.ino };
      await handle.writeFile(JSON.stringify(info) + "\n");
      await handle.sync();
    } finally { await handle.close(); }
    try { await fs.link(tempPath, lockPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Dead, corrupt and ambiguous locks require external proven-quiescent cleanup.
      throw new Error(`Lock held by an existing owner: ${lockPath}`);
    }
    return info;
  } finally { await fs.rm(tempPath, { force: true }).catch(() => {}); }
}

async function releaseLock(lockPath: string, owned: LockInfo): Promise<void> {
  try {
    const handle = await fs.open(lockPath, "r");
    let matches = false;
    try {
      const identity = await handle.stat();
      let info: LockInfo;
      try { info = JSON.parse(await handle.readFile("utf8")) as LockInfo; }
      catch { return; }
      matches = identity.dev === owned.dev && identity.ino === owned.ino
        && info.nonce === owned.nonce && info.owner === owned.owner && info.pid === owned.pid
        && info.dev === owned.dev && info.ino === owned.ino;
    } finally { await handle.close(); }
    if (matches) {
      const current = await fs.stat(lockPath);
      if (current.dev === owned.dev && current.ino === owned.ino) await fs.unlink(lockPath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function withLock<T>(lockPath: string, owner: string, fn: () => Promise<T>,
  { retries = 40, delayMs = 250 }: { retries?: number; delayMs?: number } = {}): Promise<T> {
  let owned: LockInfo | undefined;
  const maxAttempts = Math.max(0, Math.floor(retries));
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try { owned = await acquireLock(lockPath, owner); break; }
    catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("Lock held by") || attempt === maxAttempts) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  try { return await fn(); } finally { if (owned) await releaseLock(lockPath, owned); }
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
    beforePublish?: () => void,
  ): Promise<void> {
    return writeFileAtomic(targetPath, data, retries, beforePublish);
  },

  /** Atomic write (sync): temp + rename. For contexts where async is not possible. */
  writeSync(targetPath: string, data: string | Buffer): void {
    writeFileAtomicSync(targetPath, data);
  },

  /** Execute `fn` while holding an exclusively published hard-link lock, with retry on contention. */
  withLock<T>(
    lockPath: string,
    owner: string,
    fn: () => Promise<T>,
    opts?: { retries?: number; delayMs?: number },
  ): Promise<T> {
    return withLock(lockPath, owner, fn, opts);
  },
};
