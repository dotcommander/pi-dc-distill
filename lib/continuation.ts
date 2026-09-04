import type {
  ExtensionAPI,
  ExtensionContext,
} from "#shrink-framework/pi/coding-agent";
import { Notify } from "#shrink-framework";

export const SHRINK_CONTINUATION_MESSAGE_TYPE = "dc-shrink-continuation";

export const SHRINK_CONTINUATION_PROMPT = [
  "Context was compacted to free space.",
  "Continue exactly where you left off. Pick up the task you were working on.",
].join("\n");

export function queueAutonomousContinuation(
  pi: ExtensionAPI | null,
  ctx: ExtensionContext,
): boolean {
  if (!pi) return false;
  if (!(ctx.isIdle?.() ?? true)) return false;

  Notify.toLLM(pi, SHRINK_CONTINUATION_PROMPT, {
    customType: SHRINK_CONTINUATION_MESSAGE_TYPE,
    details: { reason: "autonomous_compaction" },
    triggerTurn: true,
  });
  return true;
}
