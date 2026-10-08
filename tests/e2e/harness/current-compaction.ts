/** Independent acceptance oracle: no compiler, codec, or shared contract imports. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const SUMMARY_FORMAT = "dc-distill-summary";
const SUMMARY_NOTICE = "Selected conversation excerpts and observations; incomplete.";
const SUMMARY_COLUMNS = "columns: records=kind|origin|cut|text ; files=section id|origin|cut|create|path ; commands=cmd id|origin|cut|runner|status|cwd|command|result ; current=selected input, prior=carried context; full/cut=no known text clipping/clipped; create=yes means capable, not created; command id=runner/command/cwd tuple, not execution; cwd: leading = marks recorded text; none means unrecorded; observations are not present truth, readiness, verification or authorization; omissions=count dropped candidates, not text cuts; 9007199254740991 means at least that many; request after=N counts preceding retained records; text uses literal backslash escapes";
const RECORD_KINDS = ["user", "assistant", "tool-call", "tool-result", "bash", "custom", "branch-summary", "native-summary"];

function object(value: unknown): Record<string, unknown> {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]): void {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}
function text(value: unknown, maximum: number): asserts value is string {
  assert(typeof value === "string");
  assert(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value), "malformed Unicode");
  assert(Array.from(value).length <= maximum, "display exceeds bound");
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
function omissionCounter(value: string): number {
  assert(/^(0|[1-9][0-9]*)$/.test(value), "noncanonical omitted counter");
  const counter = Number(value);
  assert(Number.isSafeInteger(counter), "unsafe omitted counter");
  return counter;
}
function unescape(value: string): string {
  let out = "";
  let canonical = "";
  for (let index = 0; index < value.length; index++) {
    let char = value[index]!;
    if (char === "\\") {
      const next = value[++index];
      if (next === "\\" || next === "|" || next === '"') char = next;
      else if (next === "r") char = "\r";
      else if (next === "n") char = "\n";
      else if (next === "t") char = "\t";
      else if (next === "u") {
        const match = value.slice(index + 1).match(/^\{([0-9a-fA-F]+)\}/);
        assert(match, "bad Unicode escape");
        const scalar = Number.parseInt(match[1]!, 16);
        assert(Number.isSafeInteger(scalar) && scalar <= 0x10ffff && !(scalar >= 0xd800 && scalar <= 0xdfff), "bad Unicode scalar");
        char = String.fromCodePoint(scalar);
        index += match[0].length;
      } else assert.fail("unknown escape");
    } else if (/[\uD800-\uDBFF]/.test(char) && index + 1 < value.length) {
      char += value[++index]!;
    }
    out += char;
    const special: Record<string, string> = { "\\": "\\\\", '"': '\\"', "|": "\\|", "\n": "\\n", "\r": "\\r", "\t": "\\t" };
    canonical += special[char] ?? (/[<>\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(char) ? `\\u{${char.codePointAt(0)!.toString(16)}}` : char);
  }
  assert.equal(value, canonical, "noncanonical escaped text");
  return out;
}

interface Observation { origin: string; shortened: boolean; text: string }
interface FileObservation { identityDigest: string; origin: string; shortened: boolean; createCapable: boolean; path: string }
interface CommandObservation { identityDigest: string; origin: string; shortened: boolean; runner: string; status: string; cwd: string | null; command: string; result: string }
export interface AcceptedSummary {
  format: string; notice: string; focus: { text: string; shortened: boolean } | null; latestRequest: (Observation & { afterRecords: number }) | null;
  records: Array<Observation & { kind: string }>;
  files: { read: FileObservation[]; modified: FileObservation[] };
  commands: CommandObservation[];
  omitted: { inputRecords: number; excerpts: number; readFiles: number; modifiedFiles: number; commands: number } | null;
}
export function assertCurrentCompaction(summary: unknown, details: unknown): AcceptedSummary {
  text(summary, 65536);
  const d = object(details);
  keys(d, ["compactor", "summaryDigest", "tokensAfter", "tokensAfterSource", "capacityStatus",
    ...(d.contextWindow === undefined ? [] : ["contextWindow"])]);
  assert.equal(d.compactor, "dc-distill");
  assert.equal(d.summaryDigest, createHash("sha256").update(summary).digest("hex"));
  assert(typeof d.tokensAfter === "number" && Number.isFinite(d.tokensAfter) && d.tokensAfter >= 0);
  assert.equal(d.tokensAfterSource, "pi-rebuilt-message-estimate");
  assert(d.capacityStatus === "unknown" || d.capacityStatus === "within-window");
  if (d.contextWindow !== undefined) assert(typeof d.contextWindow === "number" && Number.isFinite(d.contextWindow) && d.contextWindow > 0);
  if (d.capacityStatus === "within-window") assert(typeof d.contextWindow === "number" && d.tokensAfter <= d.contextWindow);

  const lines = summary.split("\n");
  let index = 0;
  const take = (): string => {
    assert.ok(index < lines.length, "truncated summary");
    return lines[index++]!;
  };
  assert.equal(take(), `<${SUMMARY_FORMAT}>`, "missing opening tag");
  assert.equal(take(), `notice: ${SUMMARY_NOTICE}`, "wrong notice constant");
  assert.equal(take(), SUMMARY_COLUMNS, "wrong columns legend");
  const document: AcceptedSummary = { format: SUMMARY_FORMAT, notice: SUMMARY_NOTICE, focus: null, latestRequest: null,
    records: [], files: { read: [], modified: [] }, commands: [], omitted: null };
  if (lines[index]?.startsWith("focus: ")) {
    const fields = take().slice(7).match(/^(full|cut) "([\s\S]*)"$/);
    assert(fields, "bad focus field");
    document.focus = { shortened: cut(fields[1]!), text: unescape(fields[2]!) };
    text(document.focus.text, 2048);
  }
  if (lines[index]?.startsWith("latest-request: ")) {
    const fields = take().slice(16).match(/^(current|prior) (full|cut) after=(0|[1-9][0-9]*) "([\s\S]*)"$/);
    assert(fields, "bad latest request field");
    const request = { origin: originField(fields[1]!), shortened: cut(fields[2]!), afterRecords: omissionCounter(fields[3]!), text: unescape(fields[4]!) };
    text(request.text, 2048);
    document.latestRequest = request;
  }
  assert.equal(take(), "records:", "missing records section");
  while (lines[index] !== "files:") {
    const fields = take().split(" | ");
    assert.equal(fields.length, 4, "bad record row");
    assert(RECORD_KINDS.includes(fields[0]!), "bad record kind");
    const row = { kind: fields[0]!, origin: originField(fields[1]!), shortened: cut(fields[2]!), text: unescape(fields[3]!) };
    text(row.text, 2048);
    document.records.push(row);
  }
  if (document.latestRequest) assert(document.latestRequest.afterRecords <= document.records.length, "request anchor out of bounds");
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
  document.omitted = { inputRecords: omissionCounter(omitted[1]!), excerpts: omissionCounter(omitted[2]!), readFiles: omissionCounter(omitted[3]!),
    modifiedFiles: omissionCounter(omitted[4]!), commands: omissionCounter(omitted[5]!) };
  assert.equal(take(), `</${SUMMARY_FORMAT}>`, "missing closing tag");
  assert.equal(index, lines.length, "trailing content after summary");
  assert(document.records.length <= 400 && document.files.read.length <= 50
    && document.files.modified.length <= 50 && document.commands.length <= 10, "section size bound");
  return document;
}
