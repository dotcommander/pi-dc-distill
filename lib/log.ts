import { LEGACY_DATA_DIR_ENV } from "./legacy.ts";
/**
 * Compaction event logging.
 *
 * Uses synchronous writes (appendFileSync / writeFileSync) because
 * the session_before_compact hook runs during pi's compaction teardown.
 * Async callbacks (appendFile) can be lost when the runtime context
 * is torn down before the callback fires — the root cause of the
 * missing compact-log entries observed in session 2026-05-13.
 *
 * Two output streams:
 *   1. compact-log.jsonl — one-line JSON per compaction event (append)
 *   2. compact-dumps/    — full before/after strings per event (one file pair per compaction)
 *
 * All writes go to ~/.pi/data/dc-distill/ (via Path.data facade).
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Path } from "#distill-framework";
import type { CompactEvent } from "./types.ts";

const DATA_DIR_ENV = "DC_DISTILL_DATA_DIR";
const MAX_LOG_BYTES = 5 * 1024 * 1024;

function baseDir(): string {
  return process.env[DATA_DIR_ENV] || process.env[LEGACY_DATA_DIR_ENV] || Path.data("dc-distill").path;
}

function dumpsDir(): string {
  return join(baseDir(), "compact-dumps");
}

function logFile(): string {
  return join(baseDir(), "compact-log.jsonl");
}

/** Append one JSONL line, rotating to .old when the log exceeds MAX_LOG_BYTES. */
function appendLogLine(line: string): void {
  const path = logFile();
  mkdirSync(baseDir(), { recursive: true });
  if (existsSync(path) && statSync(path).size > MAX_LOG_BYTES) {
    renameSync(path, `${path}.old`);
  }
  appendFileSync(path, line);
}

export interface DumpOptions {
  enabled?: boolean;
  maxDumps?: number;
  dumpsDir?: string;
}

/** Ensure the dumps directory exists. */
function ensureDumpsDir(dir = dumpsDir()): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Derive a filesystem-safe timestamp slug from an ISO string.
 * "2026-05-13T23:21:39.231Z" → "20260513-232139"
 */
function tsSlug(ts: string): string {
  return ts.replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");
}

/**
 * Log a compaction event to compact-log.jsonl.
 *
 * Uses appendFileSync to guarantee the write completes before
 * the hook returns — async appendFile can lose writes during
 * pi's compaction context teardown.
 */
export function logCompaction(event: CompactEvent): void {
  try {
    appendLogLine(JSON.stringify(event) + "\n");
  } catch {
    // logging failure must never crash the extension
  }
}

/**
 * Log a compaction failure to compact-log.jsonl.
 */
export function logFailure(reasons: string[]): void {
  try {
    const entry = {
      ts: new Date().toISOString(),
      kind: "failure",
      reasons,
    };
    appendLogLine(JSON.stringify(entry) + "\n");
  } catch {
    // logging failure must never crash the extension
  }
}

/**
 * Dump full before/after strings for a compaction event.
 *
 * Writes two files to ~/.pi/data/dc-distill/compact-dumps/:
 *   <ts>-before.jsonl  — raw messages being compacted (one JSON per line)
 *   <ts>-after.txt     — the resulting summary
 *
 * The before-file is JSONL (one message object per line) so it can be
 * piped through jq for analysis. The after-file is plain
 * text (the summary string) for easy reading and diffing.
 */
export function dumpCompaction(
  ts: string,
  beforeMessages: unknown[],
  afterSummary: string,
  options: DumpOptions = {},
): void {
  try {
    if (options.enabled === false) return;
    const dir = ensureDumpsDir(options.dumpsDir);
    const slug = tsSlug(ts);

    // Before: one JSON object per line (JSONL)
    const beforePath = join(dir, `${slug}-before.jsonl`);
    const beforeLines = beforeMessages
      .map(jsonLineOrNull)
      .filter((l): l is string => l !== null)
      .join("\n");
    writeFileSync(beforePath, beforeLines + "\n");

    // After: plain text summary
    const afterPath = join(dir, `${slug}-after.txt`);
    writeFileSync(afterPath, afterSummary);

    pruneCompactionDumps(options.maxDumps, dir);
  } catch {
    // dump failure must never crash the extension
  }
}

function jsonLineOrNull(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function pruneCompactionDumps(maxDumps: number | undefined, dir = dumpsDir()): void {
  if (maxDumps === undefined || maxDumps < 0) return;
  try {
    const files = readdirSync(dir)
      .filter((name) => /^\d{8}-\d{6}-(before\.jsonl|after\.txt)$/.test(name));
    const slugs = [...new Set(files.map((name) => name.replace(/-(before\.jsonl|after\.txt)$/, "")))]
      .sort();
    const removeCount = Math.max(0, slugs.length - maxDumps);
    for (const slug of slugs.slice(0, removeCount)) {
      rmSync(join(dir, `${slug}-before.jsonl`), { force: true });
      rmSync(join(dir, `${slug}-after.txt`), { force: true });
    }
  } catch {
    // pruning failure must never crash the extension
  }
}
