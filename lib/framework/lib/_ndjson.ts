/**
 * NDJSON utilities: async line-buffered parser + sync append writer.
 *
 * parseNDJSON — async generator over chunked byte streams (pi --mode json).
 * appendNDJSON — sync fire-and-forget line appender; errors are swallowed so
 *   audit/log writes never poison the caller.
 *
 * @module dc-framework/lib/_ndjson
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ── Append writer ────────────────────────────────────────────────────

export interface AppendNDJSONOptions {
  /** Pre-write transform (e.g. redact secrets). Applied before timestamp injection. */
  sanitize?: <T>(entry: T) => T;
  /**
   * If set, inject `{ [timestampField]: new Date().toISOString() }` into the entry
   * before serialisation — only when entry is a plain object and the field is absent.
   */
  timestampField?: string;
  /** mkdir -p the parent directory if missing. Default: true. */
  ensureDir?: boolean;
}

/**
 * Append a single JSON line to a file.
 *
 * Sync — both observed consumers (appendAudit in dc-memory, writeLogLine in
 * dc-prompt/bard-engine) are synchronous void callers. Errors are swallowed
 * silently so log/audit writes never bubble into the caller.
 */
export function appendNDJSON<T>(
  path: string,
  entry: T,
  opts: AppendNDJSONOptions = {},
): void {
  try {
    if (opts.ensureDir !== false) {
      mkdirSync(dirname(path), { recursive: true });
    }
    let value: T = opts.sanitize ? opts.sanitize(entry) : entry;
    if (
      opts.timestampField &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(opts.timestampField in (value as object))
    ) {
      value = {
        [opts.timestampField]: new Date().toISOString(),
        ...(value as object),
      } as T;
    }
    appendFileSync(path, JSON.stringify(value) + "\n", "utf-8");
  } catch {
    // Swallowed: audit/log writes must not poison the caller or write to
    // stderr (which breaks pi TUI rendering).
  }
}

// ── Parser ───────────────────────────────────────────────────────────

export interface NDJSONOptions {
  /** Invoked when a line fails JSON.parse. Default: silently skip. */
  onParseError?: (line: string, err: unknown) => void;
}

/**
 * Parse a byte stream as NDJSON, yielding each successfully-parsed event.
 *
 * Accepts any AsyncIterable<Uint8Array> — Bun.spawn's stdout, fetch().body,
 * or a hand-rolled async iterator. Yields parsed events as `unknown` so the
 * caller can narrow against pi's event schema.
 *
 * Behavior:
 *   - Decodes bytes as UTF-8 with stream-mode TextDecoder (handles multi-byte
 *     characters split across chunks).
 *   - Splits on `\n`; trims trailing `\r` so `\r\n` line endings work.
 *   - Skips empty lines (no yield, no onParseError call).
 *   - Calls `onParseError` for malformed lines (default: skip silently — the
 *     stream keeps flowing rather than aborting on a single bad line).
 *   - On stream end, flushes the decoder and parses any remaining buffer
 *     content, so a final line without a trailing newline still emits.
 */
export async function* parseNDJSON(
  source: AsyncIterable<Uint8Array>,
  opts: NDJSONOptions = {},
): AsyncGenerator<unknown> {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  for await (const chunk of source) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      if (line.length === 0) continue;
      try {
        yield JSON.parse(line);
      } catch (err) {
        opts.onParseError?.(line, err);
      }
    }
  }

  buffer += decoder.decode();
  const tail = buffer.replace(/\r$/, "");
  if (tail.length > 0) {
    try {
      yield JSON.parse(tail);
    } catch (err) {
      opts.onParseError?.(tail, err);
    }
  }
}
