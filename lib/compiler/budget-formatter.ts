import { codePointLength } from "../unicode.ts";
import { CompactionInputError } from "./errors.ts";
import {
  SUMMARY_FORMAT, SUMMARY_NOTICE, RECORD_KINDS, MAX_TEXT_CODE_POINTS,
  MAX_FILE_PATH_CODE_POINTS, MAX_READ_FILES, MAX_MODIFIED_FILES, MAX_COMMANDS,
  MAX_COMMAND_RUNNER_CODE_POINTS, MAX_COMMAND_CODE_POINTS, MAX_COMMAND_CWD_CODE_POINTS,
  MAX_COMMAND_RESULT_CODE_POINTS, MAX_STRUCTURED_SUMMARY_CODE_POINTS,
  TARGET_RESUME_SUMMARY_CODE_POINTS, OPTIONAL_FACTS_CODE_POINTS,
  isRecord, shorten, saturatingAdd, emptyOmissions, validateStructuralInput,
} from "./helpers.ts";
import type { CompactionSource, CompileOptions, DcDistillSummary, ObservationFacts, SummaryRecord, TextObservation } from "./types.ts";

function invalid(): never { throw new CompactionInputError("incompatible dc-distill summary shape", "incompatible_summary"); }
function keys(value: unknown, expected: string[]): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) invalid();
}
function bounded(value: unknown, limit: number): value is string { return typeof value === "string" && codePointLength(value) <= limit; }
function origin(value: unknown): boolean { return value === "current" || value === "prior"; }
function text(value: unknown): void {
  keys(value, ["text", "shortened", "origin"]);
  if (!bounded(value.text, MAX_TEXT_CODE_POINTS) || typeof value.shortened !== "boolean" || !origin(value.origin)) invalid();
}
function validate(document: unknown): asserts document is DcDistillSummary {
  validateStructuralInput(document);
  keys(document, ["format", "notice", "focus", "latestRequest", "records", "files", "commands", "omitted"]);
  if (document.format !== SUMMARY_FORMAT || document.notice !== SUMMARY_NOTICE || !(document.focus === null || bounded(document.focus, MAX_TEXT_CODE_POINTS))) invalid();
  if (document.latestRequest !== null) text(document.latestRequest);
  if (!Array.isArray(document.records)) invalid();
  for (const record of document.records) {
    keys(record, ["text", "shortened", "origin", "kind"]);
    text({ text: record.text, shortened: record.shortened, origin: record.origin });
    if (!RECORD_KINDS.includes(record.kind as typeof RECORD_KINDS[number])) invalid();
  }
  keys(document.files, ["read", "modified"]);
  for (const [name, limit] of [["read", MAX_READ_FILES], ["modified", MAX_MODIFIED_FILES]] as const) {
    const rows = document.files[name];
    if (!Array.isArray(rows) || rows.length > limit) invalid();
    const identities = new Set<string>();
    for (const row of rows) {
      keys(row, ["identityDigest", "path", "shortened", "createCapable", "origin"]);
      if (typeof row.identityDigest !== "string" || !/^[a-f0-9]{64}$/.test(row.identityDigest) || identities.has(row.identityDigest) || !bounded(row.path, MAX_FILE_PATH_CODE_POINTS) || typeof row.shortened !== "boolean" || typeof row.createCapable !== "boolean" || !origin(row.origin)) invalid();
      identities.add(row.identityDigest);
    }
  }
  if (!Array.isArray(document.commands) || document.commands.length > MAX_COMMANDS) invalid();
  for (const row of document.commands) {
    keys(row, ["identityDigest", "runner", "command", "cwd", "status", "result", "shortened", "origin"]);
    if (typeof row.identityDigest !== "string" || !/^[a-f0-9]{64}$/.test(row.identityDigest) || !bounded(row.runner, MAX_COMMAND_RUNNER_CODE_POINTS) || !bounded(row.command, MAX_COMMAND_CODE_POINTS) || !(row.cwd === null || bounded(row.cwd, MAX_COMMAND_CWD_CODE_POINTS)) || !["success", "error", "unknown"].includes(row.status as string) || !bounded(row.result, MAX_COMMAND_RESULT_CODE_POINTS) || typeof row.shortened !== "boolean" || !origin(row.origin)) invalid();
  }
  keys(document.omitted, ["inputRecords", "excerpts", "readFiles", "modifiedFiles", "commands"]);
  if (Object.values(document.omitted).some(value => !Number.isSafeInteger(value) || (value as number) < 0)) invalid();
}

/** Fixed insertion order is part of byte determinism; no historical decoder exists. */
export function encodeSummary(document: DcDistillSummary): string {
  validate(document);
  return JSON.stringify({
    format: document.format, notice: document.notice, focus: document.focus,
    latestRequest: document.latestRequest === null ? null : { text: document.latestRequest.text, shortened: document.latestRequest.shortened, origin: document.latestRequest.origin },
    records: document.records.map(row => ({ text: row.text, shortened: row.shortened, origin: row.origin, kind: row.kind })),
    files: { read: document.files.read.map(fileRow), modified: document.files.modified.map(fileRow) },
    commands: document.commands.map(row => ({ identityDigest: row.identityDigest, runner: row.runner, command: row.command, cwd: row.cwd, status: row.status, result: row.result, shortened: row.shortened, origin: row.origin })),
    omitted: { inputRecords: document.omitted.inputRecords, excerpts: document.omitted.excerpts, readFiles: document.omitted.readFiles, modifiedFiles: document.omitted.modifiedFiles, commands: document.omitted.commands },
  });
}
function fileRow(row: DcDistillSummary["files"]["read"][number]) {
  return { identityDigest: row.identityDigest, path: row.path, shortened: row.shortened, createCapable: row.createCapable, origin: row.origin };
}
export function decodeSummary(serialized: string): DcDistillSummary {
  if (codePointLength(serialized) > MAX_STRUCTURED_SUMMARY_CODE_POINTS) invalid();
  let document: unknown;
  try { document = JSON.parse(serialized); } catch { return invalid(); }
  validate(document);
  return document;
}
export function evictOldestOptional(document: DcDistillSummary): boolean {
  const choices = [
    [document.records, "excerpts"], [document.commands, "commands"],
    [document.files.read, "readFiles"], [document.files.modified, "modifiedFiles"],
  ] as const;
  for (const [rows, counter] of choices) {
    if (rows.length === 0) continue;
    rows.shift();
    document.omitted[counter] = saturatingAdd(document.omitted[counter], 1);
    return true;
  }
  return false;
}
function observation(value: string, previousShortened = false, prior = false): TextObservation {
  const reduced = shorten(value, MAX_TEXT_CODE_POINTS);
  return { text: reduced.text, shortened: previousShortened || reduced.shortened, origin: prior ? "prior" : "current" };
}

/** Select complete rows using their escaped serialized cost, never a wire substring. */
export function buildSummary(source: CompactionSource, facts: ObservationFacts, options: CompileOptions = {}): DcDistillSummary {
  const predecessor = source.predecessor;
  const newestRequestIndex = source.records.findLastIndex(record => record.kind === "user" && record.nativeUserText === true);
  const newestRequest = newestRequestIndex < 0 ? undefined : source.records[newestRequestIndex];
  const latestRequest = newestRequest ? observation(newestRequest.text) : predecessor?.latestRequest ? observation(predecessor.latestRequest.text, predecessor.latestRequest.shortened, true) : null;
  const excerpts: SummaryRecord[] = predecessor?.records.map(row => ({ ...row, origin: "prior" })) ?? [];
  source.records.forEach((record, index) => {
    if (index !== newestRequestIndex) excerpts.push({ ...observation(record.text), kind: record.kind });
  });
  const base = { ...(predecessor?.omitted ?? emptyOmissions()) };
  base.inputRecords = saturatingAdd(base.inputRecords, source.omittedInputRecords);
  const document: DcDistillSummary = {
    format: SUMMARY_FORMAT, notice: SUMMARY_NOTICE,
    focus: options.focus == null ? null : shorten(options.focus, MAX_TEXT_CODE_POINTS).text,
    latestRequest, records: [], files: { read: [], modified: [] }, commands: [], omitted: { ...base },
  };
  const omissions = () => {
    document.omitted.excerpts = saturatingAdd(base.excerpts, excerpts.length - document.records.length);
    document.omitted.readFiles = saturatingAdd(base.readFiles, facts.files.read.length - document.files.read.length);
    document.omitted.modifiedFiles = saturatingAdd(base.modifiedFiles, facts.files.modified.length - document.files.modified.length);
    document.omitted.commands = saturatingAdd(base.commands, facts.commands.length - document.commands.length);
  };
  omissions();
  const mandatorySize = codePointLength(encodeSummary(document));
  const operatingLimit = Math.max(TARGET_RESUME_SUMMARY_CODE_POINTS, mandatorySize);
  const fits = () => { omissions(); return codePointLength(encodeSummary(document)) <= operatingLimit; };
  const factCost = () => codePointLength(JSON.stringify({ files: { read: document.files.read.map(fileRow), modified: document.files.modified.map(fileRow) }, commands: document.commands }));
  // Repeated newest modification, command, read selection; arrays end chronological.
  const rounds = Math.max(facts.files.modified.length, facts.commands.length, facts.files.read.length);
  for (let offset = 1; offset <= rounds; offset++) {
    const candidates = [
      [facts.files.modified.at(-offset), document.files.modified, MAX_MODIFIED_FILES],
      [facts.commands.at(-offset), document.commands, MAX_COMMANDS],
      [facts.files.read.at(-offset), document.files.read, MAX_READ_FILES],
    ] as const;
    for (const [candidate, rows, limit] of candidates) {
      if (!candidate || rows.length >= limit) continue;
      // The union is safe: each candidate belongs to its corresponding array.
      (rows as (typeof candidate)[]).unshift(candidate);
      if (factCost() > OPTIONAL_FACTS_CODE_POINTS || !fits()) rows.shift();
    }
  }
  for (let index = excerpts.length - 1; index >= 0; index--) {
    document.records.unshift(excerpts[index]!);
    if (!fits()) document.records.shift();
  }
  omissions();
  while (codePointLength(encodeSummary(document)) > MAX_STRUCTURED_SUMMARY_CODE_POINTS) {
    if (!evictOldestOptional(document)) throw new CompactionInputError("mandatory summary exceeds serialized limit", "protected_overflow");
  }
  return document;
}
