/**
 * Diag — diagnostic / cleanup-path / debug logging facade.
 *
 * Owned port of dc-framework `lib/diag`, trimmed to the consumed surface
 * (`Diag.warn` in `index.ts`; `error`/`debug` kept because they share one
 * write path and the framework facade exported them together).
 *
 * Routing (preserved):
 *   • Always: append a line to ~/.pi/data/pi-dc-distill/diag.ndjson
 *   • If process.env.PI_DEBUG is truthy: also mirror to process.stderr
 *
 * Safety: callable from any context (no host, no ctx). Never throws —
 * NDJSON writes are swallowed; stderr writes are try/catch wrapped.
 *
 * Self-contained by design (support-module isolation rule): the NDJSON
 * append and the data-dir resolution are inlined rather than imported from
 * sibling support modules.
 *
 * @module lib/diag-support
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
  try {
    const dir = join(homedir(), ".pi", "data", "pi-dc-distill");
    mkdirSync(dir, { recursive: true });
    const timestamped = { ts: new Date().toISOString(), ...entry };
    appendFileSync(
      join(dir, "diag.ndjson"),
      JSON.stringify(timestamped) + "\n",
      "utf-8",
    );
  } catch {
    // Swallowed: diag writes must not poison the caller or write to
    // stderr unconditionally (which breaks pi TUI rendering).
  }
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
