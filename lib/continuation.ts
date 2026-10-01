import type {
  ExtensionAPI,
  ExtensionContext,
} from "./sdk.ts";
import { Notify } from "./notify-support.ts";

export const DISTILL_CONTINUATION_MESSAGE_TYPE = "dc-distill-continuation";

export const DISTILL_CONTINUATION_PROMPT = [
  "Context was compacted to free space.",
  "Continue exactly where you left off. Pick up the task you were working on.",
].join("\n");

export interface AutonomousContinuationOptions {
  /** Attempt id of the autonomous compaction this continuation belongs to. */
  attemptId?: string;
  /** True when re-delivering a message that already went out unanswered. */
  resumed?: boolean;
}

export function queueAutonomousContinuation(
  pi: ExtensionAPI | null,
  ctx: ExtensionContext,
  options: AutonomousContinuationOptions = {},
): boolean {
  if (!pi) return false;
  try {
    if (!(ctx.isIdle?.() ?? true)) return false;

    const details: Record<string, unknown> = { reason: "autonomous_compaction" };
    if (options.attemptId) details.attemptId = options.attemptId;
    if (options.resumed) details.resumed = true;

    Notify.toLLM(pi, DISTILL_CONTINUATION_PROMPT, {
      customType: DISTILL_CONTINUATION_MESSAGE_TYPE,
      details,
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
