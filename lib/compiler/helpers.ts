import { sha256Hex } from "../sha256.ts";
import { codePointLength, codePointPrefix } from "../unicode.ts";
import { CompactionInputError } from "./errors.ts";
import type { OmissionCounts } from "./types.ts";

export const SUMMARY_FORMAT = "dc-distill-summary" as const;
export const SUMMARY_NOTICE = "Selected conversation excerpts and observations; incomplete." as const;
export const MAX_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_SOURCE_MESSAGES = 50_000;
export const MAX_STRUCTURED_SUMMARY_CODE_POINTS = 65_536;
export const TARGET_RESUME_SUMMARY_CODE_POINTS = 8_192;
export const MAX_TEXT_CODE_POINTS = 2_048;
export const MAX_FILE_PATH_CODE_POINTS = 512;
export const MAX_READ_FILES = 50;
export const MAX_MODIFIED_FILES = 50;
export const MAX_COMMANDS = 10;
export const MAX_COMMAND_RUNNER_CODE_POINTS = 128;
export const MAX_COMMAND_CODE_POINTS = 512;
export const MAX_COMMAND_CWD_CODE_POINTS = 512;
export const MAX_COMMAND_RESULT_CODE_POINTS = 300;
export const OPTIONAL_FACTS_CODE_POINTS = 2_048;
export const RECORD_KINDS = ["user", "assistant", "tool-call", "tool-result", "bash", "custom", "branch-summary", "native-summary"] as const;

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
export function digest(content: string): string { return sha256Hex(content); }
export function shorten(text: string, limit: number): { text: string; shortened: boolean } {
  return { text: codePointPrefix(text, limit), shortened: codePointLength(text) > limit };
}
export function saturatingAdd(left: number, right: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}
export function emptyOmissions(): OmissionCounts {
  return { inputRecords: 0, excerpts: 0, readFiles: 0, modifiedFiles: 0, commands: 0 };
}
/** Reject malformed decoded Unicode rather than silently encoding replacement characters. */
export function assertValidUnicode(text: string): void {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new CompactionInputError("malformed decoded Unicode");
    } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new CompactionInputError("malformed decoded Unicode");
  }
}
/** Structural checks apply before source bounding, including every omitted record. */
export function validateStructuralInput(value: unknown): void {
  let values = 0;
  let containers = 0;
  const active = new Set<object>();
  function visit(item: unknown, depth: number): void {
    if (++values > 1_000_000 || depth > 64) throw new CompactionInputError("source structural guard exceeded", "required_analysis_overflow");
    if (typeof item === "string") { assertValidUnicode(item); return; }
    if (item === null || typeof item === "boolean" || item === undefined) return;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new CompactionInputError("non-finite source number");
      return;
    }
    if (typeof item !== "object") throw new CompactionInputError("unsupported source value");
    if (++containers > 100_000) throw new CompactionInputError("source container guard exceeded", "required_analysis_overflow");
    if (active.has(item)) throw new CompactionInputError("cyclic source value");
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
      throw new CompactionInputError("non-plain source object");
    active.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const key of Object.keys(descriptors)) {
      if (Array.isArray(item) && key === "length") continue;
      assertValidUnicode(key);
      const descriptor = descriptors[key];
      if (!('value' in descriptor)) throw new CompactionInputError("source accessor rejected");
      visit(descriptor.value, depth + 1);
    }
    active.delete(item);
  }
  visit(value, 0);
}
