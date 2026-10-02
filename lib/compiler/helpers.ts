import { sha256Hex } from "../sha256.ts";
import { codePointLength, codePointPrefix } from "../unicode.ts";
import { basename } from "node:path";

export const RECALL_NOTE =
  "Use `recall_compaction` to search for prior work, decisions, and context from before this summary. Do not redo work already completed.";

export const COMPILE_SEPARATOR = "\n\n---\n\n";

export const MAX_STRUCTURED_SUMMARY_CODE_POINTS = 65_536;

export const TARGET_RESUME_SUMMARY_CODE_POINTS = 8_192;

export const RECENT_REQUEST_GROUPS_TO_KEEP = 3;

const ansiRE = /\x1b\[[0-9;]*[A-Za-z]/g;

const ctrlRE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

export function sanitize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(ansiRE, "").replace(ctrlRE, "");
}

export function sliceU16(text: string, limit: number): string {
  return codePointPrefix(text, limit);
}

// Harness-control errors with near-zero resume value: dropped from <recent-tool-results>
// even though they are errors (they still count toward edit-loop failure detection upstream).

export const HARNESS_ERROR_SKIP = ["File unchanged since last read", "BLOCKED:"];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("compaction cancelled", "AbortError");
}

export function argString(args: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = args?.[key];
  return typeof value === "string" ? value : undefined;
}

export class OrderedSet {
  private readonly set = new Set<string>();
  private readonly order: string[] = [];

  add(value: string): void {
    if (this.set.has(value)) return;
    this.set.add(value);
    this.order.push(value);
  }

  remove(value: string): void {
    if (!this.set.delete(value)) return;
    const idx = this.order.indexOf(value);
    if (idx >= 0) this.order.splice(idx, 1);
  }

  get size(): number { return this.order.length; }

  at(index: number): string | undefined { return this.order[index]; }

  slice(start = 0): string[] {
    return this.order.slice(start);
  }
}

export function addMarkerLine(set: OrderedSet, line: string): void {
  const normalized = sanitize(line).trim().split(/\s+/).filter(Boolean).join(" ");
  if (normalized) set.add(sliceU16(normalized, 180));
}

export function removeMarkerLine(set: OrderedSet, line: string): void {
  const normalized = sanitize(line).trim().split(/\s+/).filter(Boolean).join(" ");
  if (normalized) set.remove(sliceU16(normalized, 180));
}

export function removePartialEffectsRisksForPath(set: OrderedSet, path: string): void {
  const needle = ` for ${path} may have partial effects`;
  for (const line of set.slice()) {
    if (line.startsWith("Failed ") && line.includes(needle)) set.remove(line);
  }
}

export function addExactMarkerLine(set: OrderedSet, line: string, limit = 512): void {
  const sanitized = sanitize(line).trim();
  if (sanitized) set.add(sliceU16(sanitized, limit));
}

export function boundedListMarker(prefix: string, values: string[], limit = 512): string {
  let best = "";
  for (let kept = 1; kept <= values.length; kept++) {
    const omitted = values.length - kept;
    const suffix = omitted > 0 ? `, ... (${omitted} active files omitted)` : "";
    const candidate = `${prefix}${values.slice(0, kept).join(", ")}${suffix}`;
    if (codePointLength(candidate) > limit) break;
    best = candidate;
  }
  if (best) return best;
  const abbreviated = `…/${basename(values[0])}`;
  return `${prefix}${abbreviated}${values.length > 1 ? `, ... (${values.length - 1} active files omitted)` : ""}`;
}

export function limitedSetSlice(set: OrderedSet, limit: number, label: string): string[] {
  const values = set.slice();
  if (values.length <= limit) return values;
  return [...values.slice(values.length - limit), `... (${values.length - limit} ${label} omitted)`];
}

export function newestLimited<T>(values: T[], limit: number): { values: T[]; omitted: number } {
  if (values.length <= limit) return { values, omitted: 0 };
  return { values: values.slice(values.length - limit), omitted: values.length - limit };
}

export function moveKeyToEnd(order: string[], key: string): void {
  const idx = order.indexOf(key);
  if (idx >= 0) order.splice(idx, 1);
  order.push(key);
}

export function uniqueValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function boundedValues(values: string[], limit: number, label: string, keep: "newest" | "highest" = "newest"): string[] {
  const unique = uniqueValues(values);
  if (unique.length <= limit) return unique;
  const retained = keep === "highest" ? unique.slice(0, limit) : unique.slice(unique.length - limit);
  return [`... (${unique.length - limit} ${label} omitted)`, ...retained];
}

// Bare user confirmations carry no resume value — skip them so recentUserIntents
// captures the actual ask, not "ok"/"continue". Anchored + length-bounded so it
// never swallows a real instruction that merely starts with "yes,".

export function isBareConfirmation(text: string): boolean {
  if (/^\s*(y|yes|yep|yeah|ok|okay|sure|go|go ahead|do it|proceed|continue|run it|ship it|approved|thanks|ty)[.!,]?\s*$/i.test(text)) {
    return true;
  }
  return /^(?:\s*\d+[.)]\s*(?:recommended|stand down|yes|no|approve|approved|skip|stop|continue|go)[.!]?\s*)+$/i.test(text);
}

export function digest(content: string): string {
  return sha256Hex(content);
}
