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

export type ContinuationSubmission = "deferred" | "unavailable" | "submitted_unknown";

// A global symbol preserves uncertain submissions through extension module reloads.
const registryKey = Symbol.for("dc-distill.continuation-fences.v1");
interface Registry { fences: Map<string, "submitted_unknown" | "ledger_observed">; submitted: Set<string>; callbacks: Map<string, ReturnType<typeof setImmediate>> }
const globals = globalThis as unknown as Record<symbol, Registry | undefined>;
const registry = globals[registryKey] ??= { fences: new Map(), submitted: new Set(), callbacks: new Map() };
const key = (session: string, attempt: string, kind: "deliver" | "resume") => JSON.stringify([session, attempt, kind]);
export function continuationFenced(session: string, attempt: string, kind: "deliver" | "resume"): boolean {
  return registry.fences.has(key(session, attempt, kind))
    || (kind === "resume" && registry.submitted.has(key(session, attempt, "deliver")));
}
export function fenceContinuation(session: string, attempt: string, kind: "deliver" | "resume"): void {
  const id = key(session, attempt, kind);
  registry.submitted.add(id);
  registry.fences.set(id, "submitted_unknown");
}
export function observeContinuation(session: string, attempt: string): void {
  // Observation cannot authorize a same-process resume of our uncertain send.
  const id = key(session, attempt, "deliver");
  registry.fences.set(id, "ledger_observed");
}
export function cancelContinuationCallback(session: string): void {
  const handle = registry.callbacks.get(session);
  if (handle) clearImmediate(handle);
  registry.callbacks.delete(session);
}
export function scheduleContinuationCallback(session: string, callback: () => void): void {
  cancelContinuationCallback(session);
  const handle = setImmediate(() => {
    if (registry.callbacks.get(session) !== handle) return;
    registry.callbacks.delete(session);
    callback();
  });
  registry.callbacks.set(session, handle);
}

export interface AutonomousContinuationOptions {
  /** Attempt id of the autonomous compaction this continuation belongs to. */
  attemptId?: string;
  /** True when re-delivering a message that already went out unanswered. */
  resumed?: boolean;
  /** Establish the process fence before the sender can have any effect. */
  beforeSubmit?: () => void;
}

export function queueAutonomousContinuation(
  pi: ExtensionAPI | null,
  ctx: ExtensionContext,
  options: AutonomousContinuationOptions = {},
): ContinuationSubmission {
  if (!pi || typeof pi.sendMessage !== "function") return "unavailable";
  let invoked = false;
  try {
    if (!(ctx.isIdle?.() ?? true)) return "deferred";

    const details: Record<string, unknown> = { reason: "autonomous_compaction" };
    if (options.attemptId) details.attemptId = options.attemptId;
    if (options.resumed) details.resumed = true;

    options.beforeSubmit?.();
    invoked = true;
    Notify.toLLM(pi, DISTILL_CONTINUATION_PROMPT, {
      customType: DISTILL_CONTINUATION_MESSAGE_TYPE,
      details,
      triggerTurn: true,
    });
    return "submitted_unknown";
  } catch {
    // Sender invocation is uncertain even if it throws. Before invocation,
    // the captured pi/ctx can go stale when another extension replaces or
    // reloads the session (newSession, fork, switchSession, reload) between
    // the compaction event and this deferred callback — e.g. /btw forking the
    // session while the autonomous continuation is still pending. The
    // continuation belonged to the replaced session, so report it instead of
    // throwing from an unowned setImmediate callback and crashing Pi.
    return invoked ? "submitted_unknown" : "unavailable";
  }
}
