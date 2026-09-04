/**
 * Stable framework adapter for pi tool execution arguments.
 *
 * @module dc-framework/lib/_tool-execute
 */

import type { ExtensionContext } from "../pi/coding-agent";
import { textResult, type ToolResult } from "./_text-result.ts";

export type ToolCallId = string;

export type ToolUpdate =
  | {
      readonly kind: "message";
      readonly message: string;
      readonly details?: Record<string, unknown>;
    }
  | {
      readonly kind: "progress";
      readonly message?: string;
      readonly current?: number;
      readonly total?: number;
      readonly details?: Record<string, unknown>;
    };

export type ToolUpdateHandler = (update: ToolUpdate) => void;
type PiToolUpdateHandler = (update: ToolResult) => void;

export interface ToolExecutionContext {
  readonly toolCallId: ToolCallId;
  readonly signal: AbortSignal;
  readonly onUpdate: ToolUpdateHandler;
  readonly ctx: ExtensionContext;
}

export function toolExecutionContext(
  toolCallId: ToolCallId,
  signal: AbortSignal,
  onUpdate: PiToolUpdateHandler | undefined,
  ctx: ExtensionContext,
): ToolExecutionContext {
  return {
    toolCallId,
    signal,
    onUpdate: onUpdate
      ? (update) => onUpdate(toolUpdateToResult(update))
      : () => {},
    ctx,
  };
}

function toolUpdateToResult(update: ToolUpdate): ToolResult {
  if (update.kind === "message") {
    return textResult(update.message, update.details ?? {});
  }

  const count =
    update.current !== undefined && update.total !== undefined
      ? `${update.current}/${update.total}`
      : undefined;
  const text = [update.message, count].filter(Boolean).join(" ");
  return textResult(text, update.details ?? {});
}
