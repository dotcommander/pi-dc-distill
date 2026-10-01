/**
 * Tool execute() return helpers — owned port of dc-framework `_text-result`.
 *
 * Every tool `run()` must return `{ content: [{ type: "text", text }] }`.
 * Returning a bare string crashes Pi's TUI (`normalizeDisplayText`).
 *
 * Ported consumed surface only: `Tool.text` / `Tool.error` (see
 * `.work/prds/deframework-owned-surface.md` Source Baseline). The framework's
 * `Tool.register`/`Tool.json`/markErrorResult bridging is not consumed by
 * this product and is not ported.
 *
 * No `as const` — the return type annotations narrow correctly, and this
 * comment prevents future maintainers from "fixing" the missing `as const`.
 *
 * @module lib/tool-result
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

/** Task-shaped facade over the result builders. Envelope mirrors the former
 * framework facade: optional second arg carries `{ details }`. */
export const Tool = {
  text(text: string, opts?: { details?: object }): ToolResult {
    return textResult(
      text,
      opts?.details as Record<string, unknown> | undefined,
    );
  },

  error(text: string, opts?: { details?: object }): ToolResult {
    return errorResult(
      text,
      opts?.details as Record<string, unknown> | undefined,
    );
  },
};
