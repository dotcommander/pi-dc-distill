/**
 * Entries facade — owned port of dc-framework `x/entries.ts`.
 *
 * Custom session-entry persistence: append via `pi.appendEntry`, read back
 * from the session manager's branch (default) or full entry log. Read
 * helpers are ported with the append because they form one cohesive handle
 * contract (`Entries.type`), matching the framework surface.
 *
 * @module lib/entries-support
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface SessionCustomEntry<T = unknown> {
  customType: string;
  data: T;
  raw: unknown;
}

export interface EntriesReadOptions {
  /**
   * Read from the current session branch when available.
   *
   * Defaults to true. Pass false to read from the full session entry log.
   */
  branchOnly?: boolean;
}

export interface EntriesHandle<T = unknown> {
  readonly customType: string;
  append(data: T): void;
  readAll(
    ctx: ExtensionContext,
    opts?: EntriesReadOptions,
  ): SessionCustomEntry<T>[];
  readLatest(
    ctx: ExtensionContext,
    opts?: EntriesReadOptions,
  ): SessionCustomEntry<T> | undefined;
  readLatestData(
    ctx: ExtensionContext,
    opts?: EntriesReadOptions,
  ): T | undefined;
}

interface RawEntry {
  type?: unknown;
  customType?: unknown;
  data?: unknown;
}

interface SessionManagerLike {
  getBranch?(): Iterable<unknown>;
  getEntries?(): Iterable<unknown>;
}

function manager(ctx: ExtensionContext): SessionManagerLike | undefined {
  return ctx.sessionManager as SessionManagerLike | undefined;
}

function entriesFrom(
  ctx: ExtensionContext,
  opts: EntriesReadOptions = {},
): Iterable<unknown> {
  const m = manager(ctx);
  if (!m) return [];
  if (opts.branchOnly !== false && typeof m.getBranch === "function") {
    return m.getBranch();
  }
  if (typeof m.getEntries === "function") {
    return m.getEntries();
  }
  if (typeof m.getBranch === "function") {
    return m.getBranch();
  }
  return [];
}

function asCustom<T>(
  entry: unknown,
  customType: string,
): SessionCustomEntry<T> | undefined {
  const raw = entry as RawEntry;
  if (raw?.type !== "custom" || raw.customType !== customType) return undefined;
  return {
    customType,
    data: raw.data as T,
    raw: entry,
  };
}

export const Entries = {
  append<T>(pi: ExtensionAPI, customType: string, data: T): void {
    pi.appendEntry(customType, data);
  },

  readAll<T = unknown>(
    ctx: ExtensionContext,
    customType: string,
    opts: EntriesReadOptions = {},
  ): SessionCustomEntry<T>[] {
    const found: SessionCustomEntry<T>[] = [];
    for (const entry of entriesFrom(ctx, opts)) {
      const custom = asCustom<T>(entry, customType);
      if (custom) found.push(custom);
    }
    return found;
  },

  readLatest<T = unknown>(
    ctx: ExtensionContext,
    customType: string,
    opts: EntriesReadOptions = {},
  ): SessionCustomEntry<T> | undefined {
    const items = [...entriesFrom(ctx, opts)];
    for (let i = items.length - 1; i >= 0; i--) {
      const custom = asCustom<T>(items[i], customType);
      if (custom) return custom;
    }
    return undefined;
  },

  readLatestData<T = unknown>(
    ctx: ExtensionContext,
    customType: string,
    opts: EntriesReadOptions = {},
  ): T | undefined {
    return Entries.readLatest<T>(ctx, customType, opts)?.data;
  },

  type<T = unknown>(pi: ExtensionAPI, customType: string): EntriesHandle<T> {
    return {
      customType,
      append(data) {
        Entries.append(pi, customType, data);
      },
      readAll(ctx, opts) {
        return Entries.readAll<T>(ctx, customType, opts);
      },
      readLatest(ctx, opts) {
        return Entries.readLatest<T>(ctx, customType, opts);
      },
      readLatestData(ctx, opts) {
        return Entries.readLatestData<T>(ctx, customType, opts);
      },
    };
  },
};
