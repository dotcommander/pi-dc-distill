import { codePointLength } from "../unicode.ts";
import { CompactionInputError } from "./errors.ts";
import { SUMMARY_FORMAT, SUMMARY_NOTICE, SUMMARY_COLUMNS, RECORD_KINDS, MAX_TEXT_CODE_POINTS, MAX_FILE_PATH_CODE_POINTS, MAX_READ_FILES, MAX_MODIFIED_FILES, MAX_COMMANDS, MAX_COMMAND_RUNNER_CODE_POINTS, MAX_COMMAND_CODE_POINTS, MAX_COMMAND_CWD_CODE_POINTS, MAX_COMMAND_RESULT_CODE_POINTS, MAX_STRUCTURED_SUMMARY_CODE_POINTS } from "./contract.ts";
import { isRecord } from "./helpers.ts";
import { validateStructuralInput } from "./validation.ts";
import type { DcDistillSummary } from "./types.ts";

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
export const recordRow = (row: DcDistillSummary["records"][number]): string =>
  `${row.kind} | ${row.origin} | ${cut(row.shortened)} | ${escapeText(row.text)}`;
export const fileRow = (section: "read" | "modified", row: DcDistillSummary["files"]["read"][number]): string =>
  `${section} ${row.identityDigest} | ${row.origin} | ${cut(row.shortened)} | ${yesNo(row.createCapable)} | ${escapeText(row.path)}`;
export const commandRow = (row: DcDistillSummary["commands"][number]): string =>
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
    if (fields.length !== 8 || !IDENTITY.test(fields[0]!) || !COMMAND_STATUSES.some(status => status === fields[4])) invalid();
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

/** All admission costs come from the same escaped renderers as the public codec. */
export function serializedRowCost(row: string): number { return codePointLength(row); }
export function summaryCost(document: DcDistillSummary): number { return codePointLength(encodeSummary(document)); }
