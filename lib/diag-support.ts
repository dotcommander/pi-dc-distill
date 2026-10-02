/**
 * Diag — diagnostic / cleanup-path / debug logging facade.
 *
 * Owned port of dc-framework `lib/diag`, trimmed to the consumed surface
 * (`Diag.warn` in `index.ts`; `error`/`debug` kept because they share one
 * write path and the framework facade exported them together).
 *
 * NDJSON and monitor text share Path.data("dc-distill") resolution.
 * Each sink rotates before an append when its existing size exceeds 5 MiB.
 * Historical pi-dc-distill files and rotated archives are preserved.
 * PI_DEBUG also mirrors NDJSON diagnostics to stderr; failures are best effort.
 *
 * @module lib/diag-support
 */

import { appendFileSync, existsSync, renameSync, statSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { Path } from "./paths.ts";

const MAX_LOG_BYTES = 5 * 1024 * 1024;
let monitorWrites: Promise<void> = Promise.resolve();

/** Rotate before each append. Existing archives are never overwritten. */
function rotate(path: string): void {
  try {
    if (statSync(path).size <= MAX_LOG_BYTES) return;
    let archive = `${path}.old`;
    if (existsSync(archive)) {
      const base = `${archive}.${Date.now()}`;
      archive = base;
      for (let suffix = 1; existsSync(archive); suffix++) archive = `${base}.${suffix}`;
    }
    renameSync(path, archive);
  } catch {
    // Missing files and storage failures are best effort.
  }
}

function appendDiagnostic(line: string): void {
  try {
    const path = Path.data("dc-distill").join("diag.ndjson");
    rotate(path);
    appendFileSync(path, line, "utf8");
  } catch {
    // Diagnostics must never poison their caller.
  }
}

function appendMonitor(msg: string): Promise<void> {
  const line = `${new Date().toISOString()} ${msg}\n`;
  monitorWrites = monitorWrites.then(async () => {
    try {
      const path = Path.data("dc-distill").join("diag.log");
      rotate(path);
      await appendFile(path, line, "utf8");
    } catch {
      // Monitor writes remain asynchronous and best effort.
    }
  });
  return monitorWrites;
}

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
  const timestamped = { ts: new Date().toISOString(), ...entry };
  appendDiagnostic(JSON.stringify(timestamped) + "\n");
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
  /** Serialized text sink used by the asynchronous compaction monitor. */
  monitor(msg: string): Promise<void> {
    return appendMonitor(msg);
  },
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
