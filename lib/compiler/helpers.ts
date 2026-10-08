import { codePointLength, codePointPrefix } from "../unicode.ts";
import { CompactionInputError } from "./errors.ts";
import type { OmissionCounts } from "./types.ts";

export * from "./contract.ts";
export { assertValidUnicode, validateStructuralInput } from "./validation.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("compaction cancelled", "AbortError");
}
export function argString(args: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const value = args?.[key];
  return typeof value === "string" ? value : undefined;
}
export function shorten(text: string, limit: number): { text: string; shortened: boolean } {
  const prefix = codePointPrefix(text, limit);
  return { text: prefix, shortened: prefix.length !== text.length };
}
/** A visible separator describes selection gaps, never connective source prose. */
export const EXCERPT_GAP = "[... excerpt gap ...]";
type ExcerptUnit = { start: number; end: number; question: boolean };
type MarkdownBlock = ExcerptUnit & { kind: "prose" | "list" | "table" | "code" | "lead"; indent: number; attached: boolean; proseStart?: number; proseInline?: number };
const UNIT_WINDOW = 32;

/** Inline delimiters mask punctuation; they never sever the containing sentence. */
function* sentences(text: string, start: number, end: number, initialInline = 0): Generator<ExcerptUnit> {
  let inline = initialInline, from = start;
  for (let position = start; position < end; position++) {
    if (text[position] === "`") {
      let next = position + 1;
      while (next < end && text[next] === "`") next++;
      const run = next - position;
      if (inline === 0) inline = run;
      else if (inline === run) inline = 0;
      position = next - 1;
      continue;
    }
    if (inline !== 0 || !/[.!?]/.test(text[position]!) || (position + 1 < end && !/\s/.test(text[position + 1]!))) continue;
    while (from < position && /\s/.test(text[from]!)) from++;
    yield { start: from, end: position + 1, question: text[position] === "?" };
    from = position + 1;
  }
  while (from < end && /\s/.test(text[from]!)) from++;
  if (from < end) yield { start: from, end, question: false };
}
function spanLength(text: string, start: number, end: number, limit: number): number {
  let count = 0;
  for (let position = start; position < end && count <= limit; count++) position += text.codePointAt(position)! > 0xffff ? 2 : 1;
  return count;
}

/** Structural separators exclude escaped pipes and matching inline-code runs. */
function tableColumns(line: string): number {
  const value = line.trim();
  let columns = 1, inline = 0;
  for (let position = 0; position < value.length; position++) {
    if (value[position] === "\\") { position++; continue; }
    if (value[position] === "`") {
      let next = position + 1;
      while (next < value.length && value[next] === "`") next++;
      const run = next - position;
      if (inline === 0) inline = run;
      else if (inline === run) inline = 0;
      position = next - 1;
    } else if (inline === 0 && value[position] === "|" && position > 0 && position + 1 < value.length) columns++;
  }
  return columns > 1 ? columns : 0;
}
function delimiterColumns(line: string): number {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  let columns = 0, start = 0;
  for (let position = 0; position <= value.length; position++) if (position === value.length || value[position] === "|") {
    if (!/^:?-+:?$/.test(value.slice(start, position).trim())) return 0;
    columns++; start = position + 1;
  }
  return columns > 1 ? columns : 0;
}

/** Whole Markdown blocks, with headings/colon lead-ins attached to what follows. */
function* markdownBlocks(text: string): Generator<MarkdownBlock> {
  let block: MarkdownBlock | undefined, fence: string | undefined, inline = 0, blankAfterBlock = false;
  for (let start = 0; start < text.length;) {
    const newline = text.indexOf("\n", start), end = newline < 0 ? text.length : newline;
    const line = text.slice(start, end), trimmed = line.trim();
    const indent = /^\s*/.exec(line)![0].length;
    const delimiter = inline === 0 ? /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1] : undefined;
    if (fence) {
      block!.end = end;
      if (delimiter && delimiter[0] === fence[0] && delimiter.length >= fence.length && /^ {0,3}(?:`+|~+)\s*$/.test(line)) fence = undefined;
    } else if (!trimmed) {
      blankAfterBlock = true;
      if (block && block.kind !== "lead" && block.kind !== "list" && inline === 0) { yield block; block = undefined; }
    } else {
      const nested = block?.kind === "list" && indent > block.indent;
      const columns = inline === 0 ? tableColumns(line) : 0;
      const nextEnd = newline < 0 ? -1 : text.indexOf("\n", end + 1);
      const nextLine = newline < 0 ? "" : text.slice(end + 1, nextEnd < 0 ? text.length : nextEnd);
      const table = columns > 0 && (block?.kind === "table" || delimiterColumns(nextLine) === columns);
      const kind = inline !== 0 ? "prose" : delimiter ? "code" : table ? "table"
        : /^ {0,3}#{1,6}\s/.test(line) || /:(?:\*\*|__)?$/.test(trimmed) || /^\s*(?:[-+*]|\d+[.)])\s*$/.test(line) ? "lead"
        : /^\s*(?:[-+*]|\d+[.)])\s/.test(line) ? "list"
        : /^(?: {4}|\t)/.test(line) ? "code" : "prose";
      const continuation = block && (nested || block.kind === "lead" ||
        (block.kind === kind && kind !== "list") || (block.kind === "list" && kind === "prose" && !blankAfterBlock));
      if (block && !continuation) { yield block; block = undefined; }
      if (!block) block = { start, end, question: false, kind, indent, attached: kind === "lead" };
      else {
        block.end = end;
        if (block.kind === "lead") {
          block.kind = kind;
          if (kind === "prose") { block.proseStart = start; block.proseInline = inline; }
        }
      }
      blankAfterBlock = false;
      if (delimiter) fence = delimiter;
      if (kind === "prose" || kind === "lead" || kind === "list") {
        for (let position = start; position < end; position++) if (text[position] === "`") {
          let next = position + 1;
          while (next < end && text[next] === "`") next++;
          const run = next - position;
          if (inline === 0) inline = run;
          else if (inline === run) inline = 0;
          position = next - 1;
        }
      }
    }
    start = end + 1;
  }
  if (block) yield block;
}
function* coherentUnits(text: string, limit: number): Generator<ExcerptUnit> {
  for (const block of markdownBlocks(text)) {
    if (block.kind === "lead") continue; // Never select an unattached heading/colon/list marker.
    if (block.kind !== "prose") { yield block; continue; }
    if (spanLength(text, block.start, block.end, limit) > limit) {
      let first = true;
      for (const sentence of sentences(text, block.proseStart ?? block.start, block.end, block.proseInline)) {
        yield { ...sentence, start: first ? block.start : sentence.start };
        first = false;
      }
    } else {
      let question = false;
      for (const sentence of sentences(text, block.start, block.end)) question ||= sentence.question;
      yield { ...block, question };
    }
  }
}
function renderExcerpt(text: string, units: readonly ExcerptUnit[], limit: number): string {
  const merged: ExcerptUnit[] = [];
  for (const unit of [...units].sort((a, b) => a.start - b.start)) {
    const previous = merged.at(-1);
    if (previous && spanLength(text, previous.end, unit.start, limit) <= limit && /^\s*$/.test(text.slice(previous.end, unit.start))) previous.end = unit.end;
    else merged.push({ ...unit });
  }
  const parts: string[] = [];
  let end = 0;
  for (const unit of merged) {
    if (unit.start > end) parts.push(EXCERPT_GAP);
    parts.push(text.slice(unit.start, unit.end)); end = unit.end;
  }
  if (end < text.length) parts.push(EXCERPT_GAP);
  return parts.join("\n");
}

/** Complete fitting units only; bounded first/last windows and last prose question. */
export function conversationalExcerpt(text: string, limit: number): { text: string; shortened: boolean } {
  if (codePointLength(text) <= limit) return { text, shortened: false };
  const first: ExcerptUnit[] = [], last: ExcerptUnit[] = [];
  let question: ExcerptUnit | undefined;
  for (const unit of coherentUnits(text, limit)) {
    const length = spanLength(text, unit.start, unit.end, limit);
    const gaps = Number(unit.start > 0) + Number(unit.end < text.length);
    if (length + gaps * (EXCERPT_GAP.length + 1) > limit) continue;
    if (first.length < UNIT_WINDOW) first.push(unit);
    last.push(unit); if (last.length > UNIT_WINDOW) last.shift();
    if (unit.question) question = unit;
  }
  const selected: ExcerptUnit[] = [];
  const admit = (unit: ExcerptUnit | undefined) => {
    if (!unit || selected.some(other => other.start === unit.start && other.end === unit.end)) return;
    if (codePointLength(renderExcerpt(text, [...selected, unit], limit)) <= limit) selected.push(unit);
  };
  admit(question); admit(first[0]); admit(last.at(-1));
  for (let offset = 1; offset < UNIT_WINDOW; offset++) { admit(first[offset]); admit(last.at(-1 - offset)); }
  if (!selected.length) return shorten(text, limit);
  const excerpt = renderExcerpt(text, selected, limit);
  return { text: String.fromCodePoint(...Array.from(excerpt, point => point.codePointAt(0)!)), shortened: true };
}

export function saturatingAdd(left: number, right: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}
export function emptyOmissions(): OmissionCounts {
  return { inputRecords: 0, excerpts: 0, readFiles: 0, modifiedFiles: 0, commands: 0 };
}
