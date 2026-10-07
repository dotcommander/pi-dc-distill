/** Independent acceptance oracle: no compiler, codec, or shared contract imports. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const SUMMARY_FORMAT = "dc-distill-summary";
const SUMMARY_NOTICE = "Selected conversation excerpts and observations; incomplete.";
const SUMMARY_COLUMNS = "columns: records=kind|origin|cut|text ; files=section id|origin|cut|create|path ; commands=cmd id|origin|cut|runner|status|cwd|command|result";
const RECORD_KINDS = ["user", "assistant", "tool-call", "tool-result", "bash", "custom", "branch-summary", "native-summary"];

function object(value: unknown): Record<string, any> {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, any>;
}
function keys(value: Record<string, any>, expected: string[]): void {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}
function text(value: unknown, maximum: number): void {
  assert.equal(typeof value, "string");
  assert(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value as string), "malformed Unicode");
  assert(Array.from(value as string).length <= maximum, "display exceeds bound");
}
function originField(value: string): string {
  assert(["current", "prior"].includes(value), "bad origin");
  return value;
}
function cut(value: string): boolean {
  assert(value === "full" || value === "cut", "bad shortened keyword");
  return value === "cut";
}
function createCapable(value: string): boolean {
  assert(value === "yes" || value === "no", "bad create keyword");
  return value === "yes";
}
function digestField(value: string): string {
  assert(/^[A-Za-z0-9_-]{22}$/.test(value), "bad identity digest");
  return value;
}
function unescape(value: string): string {
  assert(!value.endsWith("\\") || /\\\\$/.test(value), "dangling escape");
  let out = "";
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!;
    if (char !== "\\") { out += char; continue; }
    const next = value[++index];
    if (next === "\\" || next === "|") out += next;
    else if (next === "r") out += "\r";
    else if (next === "n") out += "\n";
    else assert.fail("unknown escape");
  }
  return out;
}

export function assertCurrentCompaction(summary: unknown, details: unknown): Record<string, any> {
  text(summary, 65536);
  const d = object(details);
  keys(d, ["compactor", "summaryDigest", "tokensAfter", "tokensAfterSource", "capacityStatus",
    ...(d.contextWindow === undefined ? [] : ["contextWindow"])]);
  assert.equal(d.compactor, "dc-distill");
  assert.equal(d.summaryDigest, createHash("sha256").update(summary as string).digest("hex"));
  assert(Number.isFinite(d.tokensAfter) && d.tokensAfter >= 0);
  assert.equal(d.tokensAfterSource, "pi-rebuilt-message-estimate");
  assert(["unknown", "within-window"].includes(d.capacityStatus));
  if (d.contextWindow !== undefined) assert(Number.isFinite(d.contextWindow) && d.contextWindow > 0);
  if (d.capacityStatus === "within-window") assert(d.contextWindow !== undefined && d.tokensAfter <= d.contextWindow);

  const lines = (summary as string).split("\n");
  let index = 0;
  const take = (): string => {
    assert.ok(index < lines.length, "truncated summary");
    return lines[index++]!;
  };
  assert.equal(take(), `<${SUMMARY_FORMAT}>`, "missing opening tag");
  assert.equal(take(), `notice: ${SUMMARY_NOTICE}`, "wrong notice constant");
  assert.equal(take(), SUMMARY_COLUMNS, "wrong columns legend");
  const document: Record<string, any> = { format: SUMMARY_FORMAT, notice: SUMMARY_NOTICE, focus: null, latestRequest: null,
    records: [], files: { read: [], modified: [] }, commands: [], omitted: null };
  if (lines[index]?.startsWith("focus: ")) text(document.focus = unescape(take().slice(7)), 2048);
  if (lines[index]?.startsWith("latest-request: ")) {
    const line = take().slice(16);
    const first = line.indexOf(" ");
    const second = first < 0 ? -1 : line.indexOf(" ", first + 1);
    assert(second >= 0, "short latest-request");
    const quoted = line.slice(second + 1);
    assert(quoted.startsWith('"') && quoted.endsWith('"') && quoted.length >= 2, "unquoted latest-request text");
    const request = { origin: originField(line.slice(0, first)), shortened: cut(line.slice(first + 1, second)), text: unescape(quoted.slice(1, -1)) };
    text(request.text, 2048);
    document.latestRequest = request;
  }
  assert.equal(take(), "records:", "missing records section");
  while (lines[index] !== "files:") {
    const fields = take().split(" | ");
    assert.equal(fields.length, 4, "bad record row");
    assert(RECORD_KINDS.includes(fields[0]!), "bad record kind");
    const row = { kind: fields[0], origin: originField(fields[1]!), shortened: cut(fields[2]!), text: unescape(fields[3]!) };
    text(row.text, 2048);
    document.records.push(row);
  }
  take();
  while (lines[index] !== "commands:") {
    const line = take();
    let section: "read" | "modified";
    if (line.startsWith("read ")) section = "read";
    else { assert(line.startsWith("modified "), "bad files row"); section = "modified"; }
    const fields = line.slice(section === "read" ? 5 : 9).split(" | ");
    assert.equal(fields.length, 5, "bad file row");
    const row = { identityDigest: digestField(fields[0]!), origin: originField(fields[1]!), shortened: cut(fields[2]!),
      createCapable: createCapable(fields[3]!), path: unescape(fields[4]!) };
    text(row.path, 512);
    document.files[section].push(row);
  }
  take();
  while (!lines[index]?.startsWith("omitted: ")) {
    const line = take();
    assert(line.startsWith("cmd "), "bad command row prefix");
    const fields = line.slice(4).split(" | ");
    assert.equal(fields.length, 8, "bad command row");
    assert(fields[5] === "none" || fields[5]!.startsWith("="), "bad cwd field");
    const row = { identityDigest: digestField(fields[0]!), origin: originField(fields[1]!), shortened: cut(fields[2]!),
      runner: unescape(fields[3]!), status: fields[4]!, cwd: fields[5] === "none" ? null : unescape(fields[5]!.slice(1)),
      command: unescape(fields[6]!), result: unescape(fields[7]!) };
    assert(["success", "error", "unknown"].includes(row.status), "bad command status");
    text(row.runner, 128); text(row.command, 512); text(row.result, 300);
    if (row.cwd !== null) text(row.cwd, 512);
    document.commands.push(row);
  }
  const omitted = take().slice(9).match(/^input=(\d+) excerpts=(\d+) reads=(\d+) modified=(\d+) commands=(\d+)$/);
  assert(omitted, "bad omitted counters");
  document.omitted = { inputRecords: Number(omitted[1]), excerpts: Number(omitted[2]), readFiles: Number(omitted[3]),
    modifiedFiles: Number(omitted[4]), commands: Number(omitted[5]) };
  assert.equal(take(), `</${SUMMARY_FORMAT}>`, "missing closing tag");
  assert.equal(index, lines.length, "trailing content after summary");
  assert(document.records.length <= 400 && document.files.read.length <= 50
    && document.files.modified.length <= 50 && document.commands.length <= 10, "section size bound");
  return document;
}
