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
  if (document.format !== SUMMARY_FORMAT || document.notice !== SUMMARY_NOTICE) invalid();
  if (document.focus !== null) {
    keys(document.focus, ["text", "shortened"]);
    if (!bounded(document.focus.text, MAX_TEXT_CODE_POINTS) || typeof document.focus.shortened !== "boolean") invalid();
  }
  if (document.latestRequest !== null) {
    keys(document.latestRequest, ["text", "shortened", "origin", "afterRecords"]);
    text({ text: document.latestRequest.text, shortened: document.latestRequest.shortened, origin: document.latestRequest.origin });
    if (!Number.isSafeInteger(document.latestRequest.afterRecords) || (document.latestRequest.afterRecords as number) < 0) invalid();
  }
  if (!Array.isArray(document.records)) invalid();
  for (const record of document.records) {
    keys(record, ["text", "shortened", "origin", "kind"]);
    text({ text: record.text, shortened: record.shortened, origin: record.origin });
    if (!RECORD_KINDS.includes(record.kind as typeof RECORD_KINDS[number])) invalid();
  }
  if (document.latestRequest !== null && (document.latestRequest.afterRecords as number) > document.records.length) invalid();
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
const ESCAPED_UNICODE = /[<>\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
function escapeText(value: string): string {
  return Array.from(value, char => {
    switch (char) {
      case "\\": return "\\\\";
      case '"': return '\\"';
      case "|": return "\\|";
      case "\n": return "\\n";
      case "\r": return "\\r";
      case "\t": return "\\t";
      default: return ESCAPED_UNICODE.test(char) ? `\\u{${char.codePointAt(0)!.toString(16)}}` : char;
    }
  }).join("");
}
function unescapeText(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!;
    if (char !== "\\") { out += char; continue; }
    const next = value[++index];
    switch (next) {
      case "\\": case '"': case "|": out += next; break;
      case "n": out += "\n"; break;
      case "r": out += "\r"; break;
      case "t": out += "\t"; break;
      case "u": {
        const match = value.slice(index + 1).match(/^\{([0-9a-fA-F]+)\}/);
        if (!match) invalid();
        const scalar = Number.parseInt(match[1]!, 16);
        if (!Number.isSafeInteger(scalar) || scalar > 0x10ffff || (scalar >= 0xd800 && scalar <= 0xdfff)) invalid();
        out += String.fromCodePoint(scalar);
        index += match[0].length;
        break;
      }
      default: invalid();
    }
  }
  return out;
}
const NOTICE_PREFIX = "notice: ";
const FOCUS_PREFIX = "focus: ";
const REQUEST_PREFIX = "latest-request: ";
const FILE_PREFIX = { read: "read ", modified: "modified " } as const;
const COMMAND_PREFIX = "cmd ";
const OMITTED_PREFIX = "omitted: ";
const NULL_CWD = "none";
const CWD_PREFIX = "=";
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
  `${FILE_PREFIX[section]}${row.identityDigest} | ${row.origin} | ${cut(row.shortened)} | ${yesNo(row.createCapable)} | ${escapeText(row.path)}`;
export const commandRow = (row: DcDistillSummary["commands"][number]): string =>
  `${COMMAND_PREFIX}${row.identityDigest} | ${row.origin} | ${cut(row.shortened)} | ${escapeText(row.runner)} | ${row.status} | ${row.cwd === null ? NULL_CWD : `${CWD_PREFIX}${escapeText(row.cwd)}`} | ${escapeText(row.command)} | ${escapeText(row.result)}`;
export const omittedRow = (omitted: DcDistillSummary["omitted"]): string =>
  `${OMITTED_PREFIX}input=${omitted.inputRecords} excerpts=${omitted.excerpts} reads=${omitted.readFiles} modified=${omitted.modifiedFiles} commands=${omitted.commands}`;
const originField = (value: string): "current" | "prior" => {
  if (value !== "current" && value !== "prior") invalid();
  return value;
};
const cwdField = (value: string): string | null => {
  if (value === NULL_CWD) return null;
  if (!value.startsWith(CWD_PREFIX)) invalid();
  return unescapeText(value.slice(CWD_PREFIX.length));
};

function renderSummary(document: DcDistillSummary): string {
  return [
    `<${SUMMARY_FORMAT}>`,
    `${NOTICE_PREFIX}${document.notice}`,
    SUMMARY_COLUMNS,
    ...(document.focus === null ? [] : [`${FOCUS_PREFIX}${cut(document.focus.shortened)} "${escapeText(document.focus.text)}"`]),
    ...(document.latestRequest === null ? [] : [`${REQUEST_PREFIX}${document.latestRequest.origin} ${cut(document.latestRequest.shortened)} after=${document.latestRequest.afterRecords} "${escapeText(document.latestRequest.text)}"`]),
    "records:",
    ...document.records.map(recordRow),
    "files:",
    ...document.files.read.map(row => fileRow("read", row)),
    ...document.files.modified.map(row => fileRow("modified", row)),
    "commands:",
    ...document.commands.map(commandRow),
    omittedRow(document.omitted),
    `</${SUMMARY_FORMAT}>`,
  ].join("\n");
}
export function encodeSummary(document: DcDistillSummary): string {
  validate(document);
  const serialized = renderSummary(document);
  if (codePointLength(serialized) > MAX_STRUCTURED_SUMMARY_CODE_POINTS) {
    throw new CompactionInputError("summary exceeds serialized limit", "protected_overflow");
  }
  return serialized;
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
  if (take() !== `${NOTICE_PREFIX}${SUMMARY_NOTICE}`) invalid();
  if (take() !== SUMMARY_COLUMNS) invalid();
  let focus: DcDistillSummary["focus"] = null;
  if (lines[index]?.startsWith(FOCUS_PREFIX)) {
    const match = take().slice(FOCUS_PREFIX.length).match(/^(full|cut) "([\s\S]*)"$/);
    if (!match) invalid();
    focus = { shortened: cutField(match[1]!), text: unescapeText(match[2]!) };
  }
  let latestRequest: DcDistillSummary["latestRequest"] = null;
  if (lines[index]?.startsWith(REQUEST_PREFIX)) {
    const match = take().slice(REQUEST_PREFIX.length).match(/^(current|prior) (full|cut) after=(0|[1-9][0-9]*) "([\s\S]*)"$/);
    if (!match) invalid();
    latestRequest = { origin: originField(match[1]!), shortened: cutField(match[2]!), afterRecords: Number(match[3]), text: unescapeText(match[4]!) };
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
    const section = line.startsWith(FILE_PREFIX.read) ? "read" : line.startsWith(FILE_PREFIX.modified) ? "modified" : invalid();
    const fields = line.slice(FILE_PREFIX[section].length).split(" | ");
    if (fields.length !== 5 || !IDENTITY.test(fields[0]!)) invalid();
    files[section].push({ identityDigest: fields[0]!, origin: originField(fields[1]!), shortened: cutField(fields[2]!), createCapable: createField(fields[3]!), path: unescapeText(fields[4]!) });
  }
  take();
  const commands: DcDistillSummary["commands"] = [];
  while (!lines[index]?.startsWith(OMITTED_PREFIX)) {
    const line = take();
    if (!line.startsWith(COMMAND_PREFIX)) invalid();
    const fields = line.slice(COMMAND_PREFIX.length).split(" | ");
    if (fields.length !== 8 || !IDENTITY.test(fields[0]!) || !COMMAND_STATUSES.some(status => status === fields[4])) invalid();
    commands.push({ identityDigest: fields[0]!, origin: originField(fields[1]!), shortened: cutField(fields[2]!), runner: unescapeText(fields[3]!), status: fields[4] as DcDistillSummary["commands"][number]["status"], cwd: cwdField(fields[5]!), command: unescapeText(fields[6]!), result: unescapeText(fields[7]!) });
  }
  const omitted = take().slice(OMITTED_PREFIX.length).match(/^input=(\d+) excerpts=(\d+) reads=(\d+) modified=(\d+) commands=(\d+)$/);
  if (!omitted) invalid();
  if (take() !== `</${SUMMARY_FORMAT}>` || index !== lines.length) invalid();
  const document = { format: SUMMARY_FORMAT, notice: SUMMARY_NOTICE, focus, latestRequest, records, files, commands,
    omitted: { inputRecords: Number(omitted[1]), excerpts: Number(omitted[2]), readFiles: Number(omitted[3]), modifiedFiles: Number(omitted[4]), commands: Number(omitted[5]) } };
  validate(document);
  if (renderSummary(document) !== serialized) invalid();
  return document;
}

/** All admission costs come from the same escaped renderers as the public codec. */
export function serializedRowCost(row: string): number { return codePointLength(row); }
export function summaryCost(document: DcDistillSummary): number {
  validate(document);
  return codePointLength(renderSummary(document));
}
