/**
 * Diag — diagnostic / cleanup-path / debug logging facade.
 *
 * Notify owns user/LLM-facing channels. Diag owns the engineer-facing
 * channel: catch-block traces, cleanup errors, PI_DEBUG breadcrumbs.
 * Output never touches the TUI surface.
 *
 * Routing:
 *   • Always: append a line to dataDir("pi-dc-architect")/diag.ndjson
 *   • If process.env.PI_DEBUG is truthy: also mirror to process.stderr
 *
 * Safety: callable from any context (no host, no ctx). Never throws —
 * NDJSON writes are swallowed by appendNDJSON; stderr writes are try/catch.
 *
 * @module dc-framework/lib/diag
 */

import { join } from "node:path";
import { dataDir } from "./_paths.ts";
import { appendNDJSON } from "./_ndjson.ts";

export type DiagLevel = "warn" | "error" | "debug";

interface DiagEntry {
  level: DiagLevel;
  scope: string;
  msg: string;
  err?: { name?: string; message: string; stack?: string };
}

const DEBUG_ON = !!process.env.PI_DEBUG;
const DEBUG_STACK = process.env.PI_DEBUG === "stack";

function normalizeErr(err: unknown): DiagEntry["err"] | undefined {
  if (err === undefined || err === null) return undefined;
  if (err instanceof Error) {
    return DEBUG_STACK
      ? { name: err.name, message: err.message, stack: err.stack }
      : { name: err.name, message: err.message };
  }
  return { message: String(err) };
}

function write(
  level: DiagLevel,
  scope: string,
  msg: string,
  err?: unknown,
): void {
  const entry: DiagEntry = {
    level,
    scope: scope || "unknown",
    msg,
    err: normalizeErr(err),
  };
  appendNDJSON(join(dataDir("pi-dc-architect"), "diag.ndjson"), entry, {
    timestampField: "ts",
  });
  if (DEBUG_ON) {
    try {
      const errStr = entry.err ? ` — ${entry.err.message}` : "";
      process.stderr.write(`[${entry.scope}] ${level}: ${msg}${errStr}\n`);
    } catch {
      // Swallowed: stderr write must not poison the caller.
    }
  }
}

export const Diag = {
  warn(scope: string, msg: string, err?: unknown): void {
    write("warn", scope, msg, err);
  },
  error(scope: string, msg: string, err?: unknown): void {
    write("error", scope, msg, err);
  },
  debug(scope: string, msg: string, err?: unknown): void {
    write("debug", scope, msg, err);
  },
};
