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
  try {
    if (!(ctx.isIdle?.() ?? true)) return false;

    Notify.toLLM(pi, SHRINK_CONTINUATION_PROMPT, {
      customType: SHRINK_CONTINUATION_MESSAGE_TYPE,
      details: { reason: "autonomous_compaction" },
      triggerTurn: true,
    });
    return true;
  } catch {
    // The captured pi/ctx can go stale when another extension replaces or
    // reloads the session (newSession, fork, switchSession, reload) between
    // the compaction event and this deferred callback — e.g. /btw forking the
    // session while the autonomous continuation is still pending. The
    // continuation belonged to the replaced session, so drop it instead of
    // throwing from an unowned setImmediate callback and crashing Pi.
    return false;
  }
}
