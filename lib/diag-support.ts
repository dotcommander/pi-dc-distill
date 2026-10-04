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
let ownerSession: string | null = null;

function sessionIdentity(value: string | null): string {
  return typeof value === "string" && value.trim().length > 0 ? value : "unknown";
}

/** Preserve identity while keeping text records on one line and one field. */
export function diagnosticSessionLabel(value: string | null): string {
  return sessionIdentity(value).replace(/[\s\x00-\x1f\x7f]/g, (character) => encodeURIComponent(character));
}

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

function appendMonitor(msg: string, session: string | null = ownerSession): Promise<void> {
  let line: string;
  try {
    // Capture provenance at submission, before asynchronous storage or owner replacement.
    const suffix = [
      /(?:^|\s)session=/.test(msg) ? "" : `session=${diagnosticSessionLabel(session)}`,
      /(?:^|\s)pid=/.test(msg) ? "" : `pid=${process.pid}`,
    ].filter(Boolean).join(" ");
    line = `${new Date().toISOString()} ${msg}${suffix ? ` ${suffix}` : ""}\n`;
  } catch { return Promise.resolve(); }
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
  session: string;
  pid: number;
  err?: { name?: string; message: string; stack?: string };
}

const DEBUG_ON = !!process.env.PI_DEBUG;
const DEBUG_STACK = process.env.PI_DEBUG === "stack";

function normalizeErr(err: unknown): DiagEntry["err"] | undefined {
  try {
    if (err === undefined || err === null) return undefined;
    if (err instanceof Error) {
      return DEBUG_STACK
        ? { name: err.name, message: err.message, stack: err.stack }
        : { name: err.name, message: err.message };
    }
    return { message: String(err) };
  } catch { return { message: "unavailable error details" }; }
}

function write(
  level: DiagLevel,
  scope: string,
  msg: string,
  err?: unknown,
): void {
  try {
    const entry: DiagEntry = {
      level,
      scope: scope || "unknown",
      msg,
      session: sessionIdentity(ownerSession),
      pid: process.pid,
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
  } catch {
    // Formatting, hostile error objects, and storage must never poison the caller.
  }
}

export const Diag = {
  /** Only the accepted primary-session lifecycle changes shared diagnostic ownership. */
  setOwnerSession(session: string | null): void {
    ownerSession = typeof session === "string" && session.trim().length > 0 ? session : null;
  },
  /** Serialized text sink used by the asynchronous compaction monitor. */
  monitor(msg: string, session?: string | null): Promise<void> {
    return appendMonitor(msg, session);
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
