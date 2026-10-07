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
import { excerptScore, errorSignal, SUBSTANTIVE_THRESHOLD } from "./signal.ts";
import type { CompactionSource, CompileOptions, DcDistillSummary, NormalizedRecord, ObservationFacts, SummaryRecord, TextObservation } from "./types.ts";

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

/** The template is the only formatting: fixed sections, escaped single-line rows. */
const escapeText = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
function unescapeText(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!;
    if (char !== "\\") { out += char; continue; }
    const next = value[++index];
    if (next === "\\" || next === "|") out += next;
    else if (next === "r") out += "\r";
    else if (next === "n") out += "\n";
    else invalid();
  }
  return out;
}
const NULL_CWD = "\\-";
const COMMAND_STATUSES = ["success", "error", "unknown"] as const;
const recordRow = (row: DcDistillSummary["records"][number]): string =>
  `${row.kind} | ${row.origin} | ${row.shortened} | ${escapeText(row.text)}`;
const fileRow = (section: "read" | "modified", row: DcDistillSummary["files"]["read"][number]): string =>
  `${section} ${row.identityDigest} | ${row.origin} | ${row.shortened} | ${row.createCapable} | ${escapeText(row.path)}`;
const commandRow = (row: DcDistillSummary["commands"][number]): string =>
  `${row.identityDigest} | ${row.origin} | ${row.shortened} | ${escapeText(row.runner)} | ${row.status} | ${row.cwd === null ? NULL_CWD : escapeText(row.cwd)} | ${escapeText(row.command)} | ${escapeText(row.result)}`;
const boolean = (value: string): boolean => {
  if (value !== "true" && value !== "false") invalid();
  return value === "true";
};
const originField = (value: string): "current" | "prior" => {
  if (value !== "current" && value !== "prior") invalid();
  return value;
};

export function encodeSummary(document: DcDistillSummary): string {
  validate(document);
  return [
    `<${SUMMARY_FORMAT}>`,
    `notice: ${document.notice}`,
    ...(document.focus === null ? [] : [`focus: ${escapeText(document.focus)}`]),
    ...(document.latestRequest === null ? [] : [`latest-request: ${document.latestRequest.origin} ${document.latestRequest.shortened} ${escapeText(document.latestRequest.text)}`]),
    "records:",
    ...document.records.map(recordRow),
    "files:",
    ...document.files.read.map(row => fileRow("read", row)),
    ...document.files.modified.map(row => fileRow("modified", row)),
    "commands:",
    ...document.commands.map(commandRow),
    `omitted: ${document.omitted.inputRecords} ${document.omitted.excerpts} ${document.omitted.readFiles} ${document.omitted.modifiedFiles} ${document.omitted.commands}`,
    `</${SUMMARY_FORMAT}>`,
  ].join("\n");
}
export function decodeSummary(serialized: string): DcDistillSummary {
  if (codePointLength(serialized) > MAX_STRUCTURED_SUMMARY_CODE_POINTS) invalid();
  const lines = serialized.split("\n");
  let index = 0;
  const take = (): string => {
    if (index >= lines.length) invalid();
    return lines[index++]!;
  };
  if (take() !== `<${SUMMARY_FORMAT}>`) invalid();
  if (take() !== `notice: ${SUMMARY_NOTICE}`) invalid();
  let focus: string | null = null;
  if (lines[index]?.startsWith("focus: ")) focus = unescapeText(take().slice(7));
  let latestRequest: DcDistillSummary["latestRequest"] = null;
  if (lines[index]?.startsWith("latest-request: ")) {
    const rest = take().slice(16).split(" ");
    if (rest.length < 2) invalid();
    latestRequest = { origin: originField(rest[0]!), shortened: boolean(rest[1]!), text: unescapeText(rest.slice(2).join(" ")) };
  }
  if (take() !== "records:") invalid();
  const records: DcDistillSummary["records"] = [];
  while (lines[index] !== "files:") {
    const fields = take().split(" | ");
    if (fields.length !== 4 || !RECORD_KINDS.includes(fields[0]! as typeof RECORD_KINDS[number])) invalid();
    records.push({ kind: fields[0] as typeof RECORD_KINDS[number], origin: originField(fields[1]!), shortened: boolean(fields[2]!), text: unescapeText(fields[3]!) });
  }
  take();
  const files: DcDistillSummary["files"] = { read: [], modified: [] };
  while (lines[index] !== "commands:") {
    const line = take();
    const section = line.startsWith("read ") ? "read" : line.startsWith("modified ") ? "modified" : invalid();
    const fields = line.slice(section === "read" ? 5 : 9).split(" | ");
    if (fields.length !== 5 || !/^[a-f0-9]{64}$/.test(fields[0]!)) invalid();
    files[section].push({ identityDigest: fields[0]!, origin: originField(fields[1]!), shortened: boolean(fields[2]!), createCapable: boolean(fields[3]!), path: unescapeText(fields[4]!) });
  }
  take();
  const commands: DcDistillSummary["commands"] = [];
  while (!lines[index]?.startsWith("omitted: ")) {
    const fields = take().split(" | ");
    if (fields.length !== 8 || !/^[a-f0-9]{64}$/.test(fields[0]!) || !COMMAND_STATUSES.includes(fields[4]! as never)) invalid();
    commands.push({ identityDigest: fields[0]!, origin: originField(fields[1]!), shortened: boolean(fields[2]!), runner: unescapeText(fields[3]!), status: fields[4] as DcDistillSummary["commands"][number]["status"], cwd: fields[5] === NULL_CWD ? null : unescapeText(fields[5]!), command: unescapeText(fields[6]!), result: unescapeText(fields[7]!) });
  }
  const omitted = take().slice(9).split(" ");
  if (omitted.length !== 5 || omitted.some(value => !/^\d+$/.test(value!))) invalid();
  if (take() !== `</${SUMMARY_FORMAT}>` || index !== lines.length) invalid();
  const document = { format: SUMMARY_FORMAT, notice: SUMMARY_NOTICE, focus, latestRequest, records, files, commands,
    omitted: { inputRecords: Number(omitted[0]), excerpts: Number(omitted[1]), readFiles: Number(omitted[2]), modifiedFiles: Number(omitted[3]), commands: Number(omitted[4]) } };
  validate(document);
  return document;
}
function mineLine(line: string, document: Pick<DcDistillSummary, "records" | "files" | "commands">): void {
  const bad = (): never => { throw new Error("unmineable row"); };
  const fields = line.split(" | ");
  if (line.startsWith("read ") || line.startsWith("modified ")) {
    const section = line.startsWith("read ") ? "read" as const : "modified" as const;
    const rest = line.slice(section === "read" ? 5 : 9).split(" | ");
    if (rest.length !== 5 || !/^[a-f0-9]{64}$/.test(rest[0]!) || !bounded(rest[4]!, MAX_FILE_PATH_CODE_POINTS)) bad();
    document.files[section].push({ identityDigest: rest[0]!, origin: originField(rest[1]!), shortened: boolean(rest[2]!), createCapable: boolean(rest[3]!), path: unescapeText(rest[4]!) });
    return;
  }
  if (fields.length === 4 && RECORD_KINDS.includes(fields[0]! as typeof RECORD_KINDS[number]) && bounded(fields[3]!, MAX_TEXT_CODE_POINTS)) {
    document.records.push({ kind: fields[0] as typeof RECORD_KINDS[number], origin: originField(fields[1]!), shortened: boolean(fields[2]!), text: unescapeText(fields[3]!) });
    return;
  }
  if (fields.length === 8 && /^[a-f0-9]{64}$/.test(fields[0]!) && COMMAND_STATUSES.includes(fields[4]! as typeof COMMAND_STATUSES[number])
    && bounded(fields[3]!, MAX_COMMAND_RUNNER_CODE_POINTS) && bounded(fields[5]!, MAX_COMMAND_CWD_CODE_POINTS) && bounded(fields[6]!, MAX_COMMAND_CODE_POINTS) && bounded(fields[7]!, MAX_COMMAND_RESULT_CODE_POINTS)) {
    document.commands.push({ identityDigest: fields[0]!, origin: originField(fields[1]!), shortened: boolean(fields[2]!), runner: unescapeText(fields[3]!), status: fields[4] as typeof COMMAND_STATUSES[number], cwd: fields[5] === NULL_CWD ? null : unescapeText(fields[5]!), command: unescapeText(fields[6]!), result: unescapeText(fields[7]!) });
  }
}

/** Row-mining salvage for corrupted predecessor text. Each row is
 *  self-validating, so partial corruption drops rows rather than misreading
 *  them; null when nothing valid can be mined. Counters are unknowable and
 *  default to zero. */
export function salvageSummary(serialized: string): DcDistillSummary | null {
  if (codePointLength(serialized) > MAX_STRUCTURED_SUMMARY_CODE_POINTS) return null;
  const document: Pick<DcDistillSummary, "records" | "files" | "commands"> = { records: [], files: { read: [], modified: [] }, commands: [] };
  for (const line of serialized.split("\n")) {
    try { mineLine(line, document); } catch { /* row dropped */ }
  }
  if (document.records.length + document.files.read.length + document.files.modified.length + document.commands.length === 0) return null;
  const dedupe = <T extends { identityDigest: string }>(rows: T[]): T[] => [...new Map(rows.map(row => [row.identityDigest, row])).values()];
  const clamp = <T>(rows: T[], limit: number): T[] => rows.slice(Math.max(0, rows.length - limit));
  const salvaged: DcDistillSummary = { format: SUMMARY_FORMAT, notice: SUMMARY_NOTICE, focus: null, latestRequest: null,
    records: document.records, files: { read: clamp(dedupe(document.files.read), MAX_READ_FILES), modified: clamp(dedupe(document.files.modified), MAX_MODIFIED_FILES) },
    commands: clamp(document.commands, MAX_COMMANDS), omitted: emptyOmissions() };
  try { validate(salvaged); return salvaged; } catch { return null; }
}
export function evictOldestOptional(document: DcDistillSummary): boolean {
  // Signal-tiered eviction (adapted from ctxgo's class-priority order):
  // chatter before signal, successes before failure evidence, then facts.
  const evictRow = <T>(rows: T[], predicate: (row: T) => boolean, counter: keyof DcDistillSummary["omitted"]): boolean => {
    const index = rows.findIndex(predicate);
    if (index < 0) return false;
    rows.splice(index, 1);
    document.omitted[counter] = saturatingAdd(document.omitted[counter], 1);
    return true;
  };
  if (evictRow(document.records, row => excerptScore(row) < SUBSTANTIVE_THRESHOLD, "excerpts")) return true;
  if (evictRow(document.commands, row => row.status !== "error", "commands")) return true;
  if (evictRow(document.records, () => true, "excerpts")) return true;
  if (evictRow(document.commands, () => true, "commands")) return true;
  if (evictRow(document.files.read, () => true, "readFiles")) return true;
  return evictRow(document.files.modified, () => true, "modifiedFiles");
}
function observation(value: string, previousShortened = false, prior = false): TextObservation {
  const reduced = shorten(value, MAX_TEXT_CODE_POINTS);
  return { text: reduced.text, shortened: previousShortened || reduced.shortened, origin: prior ? "prior" : "current" };
}

/** Collapse runs of identical adjacent tool attempts (adapted from ctxgo):
 *  one count marker plus the newest outcome row, so retries cost one row. */
function collapseRepeats(records: NormalizedRecord[]): NormalizedRecord[] {
  const callKey = (record: NormalizedRecord): string | null =>
    record.kind === "tool-call" && typeof record.name === "string" ? `${record.name}\u0000${JSON.stringify(record.args ?? {})}` : null;
  const out: NormalizedRecord[] = [];
  let index = 0;
  while (index < records.length) {
    const key = callKey(records[index]!);
    if (key === null) { out.push(records[index]!); index++; continue; }
    let end = index;
    let calls = 0;
    while (end < records.length) {
      if (callKey(records[end]!) === key) { calls++; end++; continue; }
      const after = records[end + 1];
      if (records[end]!.kind === "tool-result" && after !== undefined && callKey(after) === key) { end++; continue; }
      break;
    }
    if (records[end]?.kind === "tool-result") end++; // newest outcome belongs to the run
    if (calls < 2) { out.push(records[index]!); index++; continue; }
    let lastResult: NormalizedRecord | undefined;
    for (let scan = end - 1; scan >= index && lastResult === undefined; scan--)
      if (records[scan]!.kind === "tool-result") lastResult = records[scan];
    const outcome = lastResult === undefined ? "unknown" : lastResult.isError === true || errorSignal(lastResult.text) ? "error" : "ok";
    out.push({ kind: "custom", text: `[repeat: ${records[index]!.name} ×${calls} — last ${outcome}]` });
    if (lastResult !== undefined) out.push(lastResult);
    index = end;
  }
  return out;
}

/** Select complete rows using their escaped serialized cost, never a wire substring. */
export function buildSummary(source: CompactionSource, facts: ObservationFacts, options: CompileOptions = {}): DcDistillSummary {
  const predecessor = source.predecessor;
  const excerptRecords = collapseRepeats(source.records);
  const newestRequest = [...source.records].reverse().find(record => record.kind === "user" && record.nativeUserText === true);
  const latestRequest = newestRequest ? observation(newestRequest.text) : predecessor?.latestRequest ? observation(predecessor.latestRequest.text, predecessor.latestRequest.shortened, true) : null;
  const excerpts: SummaryRecord[] = predecessor?.records.map(row => ({ ...row, origin: "prior" })) ?? [];
  for (const record of excerptRecords) {
    if (record !== newestRequest) excerpts.push({ ...observation(record.text), kind: record.kind });
  }
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
  const factCost = () => codePointLength([...document.files.read.map(row => fileRow("read", row)), ...document.files.modified.map(row => fileRow("modified", row)), ...document.commands.map(commandRow)].join("\n"));
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
  // Signal-priority fit (adapted from ctxgo's rubric): substantive rows claim
  // the budget first; ties stay newest-first and rendering stays chronological.
  const priority = excerpts.map((row, index) => ({ index, score: excerptScore(row) }))
    .sort((a, b) => b.score - a.score || b.index - a.index);
  const accepted = new Set<number>();
  for (const { index } of priority) {
    accepted.add(index);
    document.records = excerpts.filter((_, position) => accepted.has(position));
    if (!fits()) accepted.delete(index);
  }
  document.records = excerpts.filter((_, position) => accepted.has(position));
  omissions();
  while (codePointLength(encodeSummary(document)) > MAX_STRUCTURED_SUMMARY_CODE_POINTS) {
    if (!evictOldestOptional(document)) throw new CompactionInputError("mandatory summary exceeds serialized limit", "protected_overflow");
  }
  return document;
}
