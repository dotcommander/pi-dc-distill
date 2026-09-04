/**
 * Fs — unified filesystem facade for dc-framework.
 *
 * Absorbs the file / atomic-write / file-lock / ndjson / json-store barrels
 * behind a single const object so consumers can `Fs.read(...)`, `Fs.write(...)`,
 * `Fs.withLock(...)`, `Fs.appendNdjson(...)`, `Fs.json<T>(...)`, etc.
 *
 * @module dc-framework/x/fs
 */

import { readText, exists } from "../lib/_file.ts";
import { writeFileAtomic, writeFileAtomicSync } from "../lib/_atomic-write.ts";
import { withLock } from "../lib/_file-lock.ts";
import {
  appendNDJSON,
  parseNDJSON,
  type AppendNDJSONOptions,
  type NDJSONOptions,
} from "../lib/_ndjson.ts";
import { JsonStore, type JsonStoreOptions } from "../lib/_json-store.ts";

export type { LockInfo } from "../lib/_file-lock.ts";
export type { AppendNDJSONOptions, NDJSONOptions } from "../lib/_ndjson.ts";
export type { JsonStoreOptions } from "../lib/_json-store.ts";
export { JsonStore } from "../lib/_json-store.ts";

export const Fs = {
  /** UTF-8 read. Throws on missing file (ENOENT) — caller decides recovery. */
  read(path: string): Promise<string> {
    return readText(path);
  },

  /** Non-throwing existence check. */
  exists(path: string): Promise<boolean> {
    return exists(path);
  },

  /** Atomic write (async): temp → fsync → rename → fsync parent dir, with retry on transient errors. */
  write(
    targetPath: string,
    data: string | Buffer,
    retries?: number,
  ): Promise<void> {
    return writeFileAtomic(targetPath, data, retries);
  },

  /** Atomic write (sync): temp + rename. For contexts where async is not possible (e.g. extension unload). */
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

  /** Append a single JSON line to a file (sync, errors swallowed). */
  appendNdjson<T>(path: string, entry: T, opts?: AppendNDJSONOptions): void {
    appendNDJSON(path, entry, opts);
  },

  /** Parse a byte stream as NDJSON, yielding each successfully-parsed event. */
  parseNdjson(
    source: AsyncIterable<Uint8Array>,
    opts?: NDJSONOptions,
  ): AsyncGenerator<unknown> {
    return parseNDJSON(source, opts);
  },

  /** Construct an atomic JSON KV store bound to `path` with `defaults`. */
  json<T>(path: string, defaults: T, opts?: JsonStoreOptions): JsonStore<T> {
    return new JsonStore<T>(path, defaults, opts);
  },
};
