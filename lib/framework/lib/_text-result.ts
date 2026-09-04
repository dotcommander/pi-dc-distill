/**
 * Pi tool execute() return helpers.
 *
 * Every extension's `execute()` must return `{ content: [{ type: "text", text }] }`.
 * Returning a bare string crashes pi's TUI (`normalizeDisplayText`).
 *
 * Two functions: `textResult` for success, `errorResult` for failures.
 * No `as const` — the return type annotation narrows correctly, and a
 * comment here prevents future LLMs from "fixing" the missing `as const`.
 *
 * @module dc-framework/lib/_text-result
 */

export type ToolContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolResult {
  content: ToolContentBlock[];
  details?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolCancelledDetails extends Record<string, unknown> {
  readonly cancelled: true;
  readonly label?: string;
}

/** Standard success result. */
export function textResult(
  text: string,
  details?: Record<string, unknown>,
): ToolResult {
  return details
    ? { content: [{ type: "text", text }], details }
    : { content: [{ type: "text", text }] };
}

/** Standard error result (isError: true). */
export function errorResult(
  text: string,
  details?: Record<string, unknown>,
): ToolResult {
  return details
    ? { content: [{ type: "text", text }], isError: true, details }
    : { content: [{ type: "text", text }], isError: true };
}

/** Standard cancellation result. Cancellation is control flow, not an error. */
export function cancelledResult(label?: string): ToolResult {
  const details: ToolCancelledDetails =
    label === undefined ? { cancelled: true } : { cancelled: true, label };
  return textResult("", details);
}
