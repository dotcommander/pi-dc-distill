import { codePointPrefix } from "../unicode.ts";
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
export function saturatingAdd(left: number, right: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}
export function emptyOmissions(): OmissionCounts {
  return { inputRecords: 0, excerpts: 0, readFiles: 0, modifiedFiles: 0, commands: 0 };
}
