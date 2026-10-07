import { codePointLength } from "../unicode.ts";
import { CompactionInputError } from "./errors.ts";
import {
  SUMMARY_FORMAT, SUMMARY_NOTICE, RECORD_KINDS, MAX_TEXT_CODE_POINTS,
  MAX_FILE_PATH_CODE_POINTS, MAX_READ_FILES, MAX_MODIFIED_FILES, MAX_COMMANDS,
  MAX_COMMAND_RUNNER_CODE_POINTS, MAX_COMMAND_CODE_POINTS, MAX_COMMAND_CWD_CODE_POINTS,
  MAX_COMMAND_RESULT_CODE_POINTS, MAX_STRUCTURED_SUMMARY_CODE_POINTS,
  TARGET_RESUME_SUMMARY_CODE_POINTS, OPTIONAL_FACTS_CODE_POINTS, SUMMARY_COLUMNS,
  isRecord, shorten, saturatingAdd, emptyOmissions, validateStructuralInput,
} from "./helpers.ts";
import { excerptScore, SUBSTANTIVE_THRESHOLD } from "./signal.ts";
import type { CompactionSource, CompileOptions, DcDistillSummary, ObservationFacts, SummaryRecord, TextObservation } from "./types.ts";

function invalid(): never { throw new CompactionInputError("incompatible dc-distill summary shape"); }
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
      if (typeof row.identityDigest !== "string" || !IDENTITY.test(row.identityDigest) || identities.has(row.identityDigest) || !bounded(row.path, MAX_FILE_PATH_CODE_POINTS) || typeof row.shortened !== "boolean" || typeof row.createCapable !== "boolean" || !origin(row.origin)) invalid();
      identities.add(row.identityDigest);
    }
  }
  if (!Array.isArray(document.commands) || document.commands.length > MAX_COMMANDS) invalid();
  for (const row of document.commands) {
    keys(row, ["identityDigest", "runner", "command", "cwd", "status", "result", "shortened", "origin"]);
    if (typeof row.identityDigest !== "string" || !IDENTITY.test(row.identityDigest) || !bounded(row.runner, MAX_COMMAND_RUNNER_CODE_POINTS) || !bounded(row.command, MAX_COMMAND_CODE_POINTS) || !(row.cwd === null || bounded(row.cwd, MAX_COMMAND_CWD_CODE_POINTS)) || !["success", "error", "unknown"].includes(row.status as string) || !bounded(row.result, MAX_COMMAND_RESULT_CODE_POINTS) || typeof row.shortened !== "boolean" || !origin(row.origin)) invalid();
  }
  keys(document.omitted, ["inputRecords", "excerpts", "readFiles", "modifiedFiles", "commands"]);
  if (Object.values(document.omitted).some(value => !Number.isSafeInteger(value) || (value as number) < 0)) invalid();
}

/** The template is the only formatting: fixed sections, escaped single-line rows.
 *  Booleans render as self-describing keywords, ids are 22-char base64url,
 *  and command cwds are `none` or an `=`-prefixed escaped value. */
const IDENTITY = /^[A-Za-z0-9_-]{22}$/;
const escapeText = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
function unescapeText(value: string): string {
  return value.replace(/\\[\s\S]?/g, (escape) => {
    switch (escape[1]) {
      case "\\": case "|": return escape[1]!;
      case "r": return "\r";
      case "n": return "\n";
      default: return invalid();
    }
  });
}
const NULL_CWD = "none";
const COMMAND_STATUSES = ["success", "error", "unknown"] as const;
const cut = (value: boolean): string => value ? "cut" : "full";
const cutField = (value: string): boolean => {
  if (value !== "full" && value !== "cut") invalid();
  return value === "cut";
};
const yesNo = (value: boolean): string => value ? "yes" : "no";
const createField = (value: string): boolean => {
  if (value !== "yes" && value !== "no") invalid();
  return value === "yes";
};
const recordRow = (row: DcDistillSummary["records"][number]): string =>
  `${row.kind} | ${row.origin} | ${cut(row.shortened)} | ${escapeText(row.text)}`;
const fileRow = (section: "read" | "modified", row: DcDistillSummary["files"]["read"][number]): string =>
  `${section} ${row.identityDigest} | ${row.origin} | ${cut(row.shortened)} | ${yesNo(row.createCapable)} | ${escapeText(row.path)}`;
const commandRow = (row: DcDistillSummary["commands"][number]): string =>
  `cmd ${row.identityDigest} | ${row.origin} | ${cut(row.shortened)} | ${escapeText(row.runner)} | ${row.status} | ${row.cwd === null ? NULL_CWD : `=${escapeText(row.cwd)}`} | ${escapeText(row.command)} | ${escapeText(row.result)}`;
const originField = (value: string): "current" | "prior" => {
  if (value !== "current" && value !== "prior") invalid();
  return value;
};
const cwdField = (value: string): string | null => {
  if (value === NULL_CWD) return null;
  if (!value.startsWith("=")) invalid();
  return unescapeText(value.slice(1));
};

export function encodeSummary(document: DcDistillSummary): string {
  validate(document);
  return [
    `<${SUMMARY_FORMAT}>`,
    `notice: ${document.notice}`,
    SUMMARY_COLUMNS,
    ...(document.focus === null ? [] : [`focus: ${escapeText(document.focus)}`]),
    ...(document.latestRequest === null ? [] : [`latest-request: ${document.latestRequest.origin} ${cut(document.latestRequest.shortened)} "${escapeText(document.latestRequest.text)}"`]),
    "records:",
    ...document.records.map(recordRow),
    "files:",
    ...document.files.read.map(row => fileRow("read", row)),
    ...document.files.modified.map(row => fileRow("modified", row)),
    "commands:",
    ...document.commands.map(commandRow),
    `omitted: input=${document.omitted.inputRecords} excerpts=${document.omitted.excerpts} reads=${document.omitted.readFiles} modified=${document.omitted.modifiedFiles} commands=${document.omitted.commands}`,
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
  if (take() !== SUMMARY_COLUMNS) invalid();
  let focus: string | null = null;
  if (lines[index]?.startsWith("focus: ")) focus = unescapeText(take().slice(7));
  let latestRequest: DcDistillSummary["latestRequest"] = null;
  if (lines[index]?.startsWith("latest-request: ")) {
    const line = take().slice(16);
    const first = line.indexOf(" ");
    const second = first < 0 ? -1 : line.indexOf(" ", first + 1);
    const quoted = second < 0 ? "" : line.slice(second + 1);
    if (second < 0 || !quoted.startsWith('"') || !quoted.endsWith('"') || quoted.length < 2) invalid();
    latestRequest = { origin: originField(line.slice(0, first)), shortened: cutField(line.slice(first + 1, second)), text: unescapeText(quoted.slice(1, -1)) };
  }
  if (take() !== "records:") invalid();
  const records: DcDistillSummary["records"] = [];
  while (lines[index] !== "files:") {
    const fields = take().split(" | ");
    if (fields.length !== 4 || !RECORD_KINDS.includes(fields[0]! as typeof RECORD_KINDS[number])) invalid();
    records.push({ kind: fields[0] as typeof RECORD_KINDS[number], origin: originField(fields[1]!), shortened: cutField(fields[2]!), text: unescapeText(fields[3]!) });
  }
  take();
  const files: DcDistillSummary["files"] = { read: [], modified: [] };
  while (lines[index] !== "commands:") {
    const line = take();
    const section = line.startsWith("read ") ? "read" : line.startsWith("modified ") ? "modified" : invalid();
    const fields = line.slice(section === "read" ? 5 : 9).split(" | ");
    if (fields.length !== 5 || !IDENTITY.test(fields[0]!)) invalid();
    files[section].push({ identityDigest: fields[0]!, origin: originField(fields[1]!), shortened: cutField(fields[2]!), createCapable: createField(fields[3]!), path: unescapeText(fields[4]!) });
  }
  take();
  const commands: DcDistillSummary["commands"] = [];
  while (!lines[index]?.startsWith("omitted: ")) {
    const line = take();
    if (!line.startsWith("cmd ")) invalid();
    const fields = line.slice(4).split(" | ");
    if (fields.length !== 8 || !IDENTITY.test(fields[0]!) || !COMMAND_STATUSES.includes(fields[4]! as never)) invalid();
    commands.push({ identityDigest: fields[0]!, origin: originField(fields[1]!), shortened: cutField(fields[2]!), runner: unescapeText(fields[3]!), status: fields[4] as DcDistillSummary["commands"][number]["status"], cwd: cwdField(fields[5]!), command: unescapeText(fields[6]!), result: unescapeText(fields[7]!) });
  }
  const omitted = take().slice(9).match(/^input=(\d+) excerpts=(\d+) reads=(\d+) modified=(\d+) commands=(\d+)$/);
  if (!omitted) invalid();
  if (take() !== `</${SUMMARY_FORMAT}>` || index !== lines.length) invalid();
  const document = { format: SUMMARY_FORMAT, notice: SUMMARY_NOTICE, focus, latestRequest, records, files, commands,
    omitted: { inputRecords: Number(omitted[1]), excerpts: Number(omitted[2]), readFiles: Number(omitted[3]), modifiedFiles: Number(omitted[4]), commands: Number(omitted[5]) } };
  validate(document);
  return document;
}
export function evictOldestOptional(document: DcDistillSummary): boolean {
  // Preserve user context until every other optional category is exhausted.
  const evictRow = <T>(rows: T[], predicate: (row: T) => boolean, counter: keyof DcDistillSummary["omitted"]): boolean => {
    const index = rows.findIndex(predicate);
    if (index < 0) return false;
    rows.splice(index, 1);
    document.omitted[counter] = saturatingAdd(document.omitted[counter], 1);
    return true;
  };
  if (evictRow(document.records, row => row.kind !== "user" && excerptScore(row) < SUBSTANTIVE_THRESHOLD, "excerpts")) return true;
  if (evictRow(document.commands, row => row.status !== "error", "commands")) return true;
  if (evictRow(document.records, row => row.kind !== "user", "excerpts")) return true;
  if (evictRow(document.commands, () => true, "commands")) return true;
  if (evictRow(document.files.read, () => true, "readFiles")) return true;
  if (evictRow(document.files.modified, () => true, "modifiedFiles")) return true;
  return evictRow(document.records, row => row.kind === "user", "excerpts");
}
function observation(value: string, previousShortened = false, prior = false): TextObservation {
  const reduced = shorten(value, MAX_TEXT_CODE_POINTS);
  return { text: reduced.text, shortened: previousShortened || reduced.shortened, origin: prior ? "prior" : "current" };
}

/** Select complete rows using their escaped serialized cost, never a wire substring. */
export function buildSummary(source: CompactionSource, facts: ObservationFacts, options: CompileOptions = {}): DcDistillSummary {
  const predecessor = source.predecessor;
  const excerptRecords = source.records;
  const newestRequest = [...source.records].reverse().find(record => record.kind === "user" && record.nativeUserText === true);
  const latestRequest = newestRequest ? observation(newestRequest.text) : predecessor?.latestRequest ? observation(predecessor.latestRequest.text, predecessor.latestRequest.shortened, true) : null;
  const excerpts: SummaryRecord[] = predecessor?.records.map(row => ({ ...row, origin: "prior" })) ?? [];
  for (const record of excerptRecords) {
    if (record !== newestRequest) excerpts.push({ ...observation(record.text, record.textShortened === true), kind: record.kind });
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
  let serializedCost = mandatorySize;
  let factCost = 0;
  let factCount = 0;
  const costs = {
    modified: facts.files.modified.map(row => codePointLength(fileRow("modified", row))),
    commands: facts.commands.map(row => codePointLength(commandRow(row))),
    read: facts.files.read.map(row => codePointLength(fileRow("read", row))),
  };
  // Repeated newest modification, command, read selection; arrays end chronological.
  const rounds = Math.max(facts.files.modified.length, facts.commands.length, facts.files.read.length);
  for (let offset = 1; offset <= rounds; offset++) {
    const candidates = [
      [facts.files.modified.at(-offset), document.files.modified, MAX_MODIFIED_FILES, costs.modified.at(-offset), "modifiedFiles", base.modifiedFiles, facts.files.modified.length],
      [facts.commands.at(-offset), document.commands, MAX_COMMANDS, costs.commands.at(-offset), "commands", base.commands, facts.commands.length],
      [facts.files.read.at(-offset), document.files.read, MAX_READ_FILES, costs.read.at(-offset), "readFiles", base.readFiles, facts.files.read.length],
    ] as const;
    for (const [candidate, rows, limit, rowCost, counter, carried, total] of candidates) {
      if (!candidate || rowCost === undefined || rows.length >= limit) continue;
      const omitted = saturatingAdd(carried, total - rows.length - 1);
      const counterDelta = String(omitted).length - String(document.omitted[counter]).length;
      const nextFactCost = factCost + rowCost + (factCount > 0 ? 1 : 0);
      const nextSerializedCost = serializedCost + rowCost + 1 + counterDelta;
      if (nextFactCost > OPTIONAL_FACTS_CODE_POINTS || nextSerializedCost > operatingLimit) continue;
      // A rejection does not prevent a later, smaller candidate from fitting.
      (rows as (typeof candidate)[]).unshift(candidate);
      document.omitted[counter] = omitted;
      factCost = nextFactCost;
      factCount++;
      serializedCost = nextSerializedCost;
    }
  }
  // User excerpts claim budget newest-first; other rows retain signal priority.
  // Rendering remains chronological across both groups.
  const priority = excerpts.map((row, index) => ({ index, user: row.kind === "user", score: excerptScore(row) }))
    .sort((a, b) => Number(b.user) - Number(a.user) || (a.user ? b.index - a.index : b.score - a.score || b.index - a.index));
  // Admission accounts each row's serialized cost once instead of rebuilding
  // and re-encoding the document per candidate: the fixed part comes from one
  // initial encode, per-row lengths from their encoded rows, and the omitted-
  // counter digit width from the accepted count. Exact framing, escaping, and
  // counter-width accounting keeps every admission decision byte-identical to
  // encoding the trial document.
  omissions();
  const omittedLength = (excerptsOmitted: number): number =>
    codePointLength(`omitted: input=${document.omitted.inputRecords} excerpts=${excerptsOmitted} reads=${document.omitted.readFiles} modified=${document.omitted.modifiedFiles} commands=${document.omitted.commands}`);
  const fixedCost = serializedCost - omittedLength(document.omitted.excerpts);
  const rowCosts = excerpts.map(row => codePointLength(recordRow(row)));
  let acceptedCost = 0;
  let acceptedCount = 0;
  const taken = excerpts.map(() => false);
  for (const { index } of priority) {
    const cost = acceptedCost + rowCosts[index]!;
    const count = acceptedCount + 1;
    const total = fixedCost + omittedLength(saturatingAdd(base.excerpts, excerpts.length - count)) + cost + count;
    if (total <= operatingLimit) { acceptedCost = cost; acceptedCount = count; taken[index] = true; }
  }
  document.records = excerpts.filter((_, position) => taken[position]);
  omissions();
  while (codePointLength(encodeSummary(document)) > MAX_STRUCTURED_SUMMARY_CODE_POINTS) {
    if (!evictOldestOptional(document)) throw new CompactionInputError("mandatory summary exceeds serialized limit", "protected_overflow");
  }
  return document;
}
