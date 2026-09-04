import { isDistillCompactor, LEGACY_CONTINUATION_MESSAGE_TYPE } from "./legacy.ts";
import { DISTILL_CONTINUATION_MESSAGE_TYPE } from "./continuation.ts";

/**
 * Pure recovery reducer for durable autonomous continuation.
 *
 * Derives the continuation state of the latest autonomous dc-distill
 * compaction from active-branch session entries, so a restart, reload, or
 * tree switch can redeliver or suppress the continuation without trusting
 * process memory. Journaling comes from the ledger itself: the autonomous
 * compaction entry's details and the persisted `dc-distill-continuation`
 * custom message. No I/O, no clock, deterministic.
 */

export type ContinuationPhase = "none" | "committed" | "delivered" | "answered";

export type ContinuationAction = "none" | "deliver" | "resume";

export interface ContinuationRecovery {
  phase: ContinuationPhase;
  action: ContinuationAction;
  attemptId?: string;
}

/**
 * Structural entry view. Accepts real `SessionEntry` values without coupling
 * this module to the SDK union.
 */
export interface RecoveryEntryLike {
  type?: string;
  customType?: string;
  details?: unknown;
  message?: { role?: string };
}

const NONE: ContinuationRecovery = { phase: "none", action: "none" };

function detailsOf(entry: RecoveryEntryLike): Record<string, unknown> {
  return entry.details !== null && typeof entry.details === "object"
    ? (entry.details as Record<string, unknown>)
    : {};
}

/**
 * The latest autonomous compaction's attempt id, or null. Only v8+ entries
 * carry `details.autonomous`; v5–v7 and manual compactions never recover.
 */
function autonomousAttemptId(entry: RecoveryEntryLike): string | null {
  if (entry.type !== "compaction") return null;
  const details = detailsOf(entry);
  if (!isDistillCompactor(details.compactor)) return null;
  if (details.autonomous !== true) return null;
  const attemptId = details.attemptId;
  return typeof attemptId === "string" && attemptId.length > 0 ? attemptId : null;
}

function isContinuationMessage(entry: RecoveryEntryLike): boolean {
  return entry.type === "custom_message"
    && (entry.customType === DISTILL_CONTINUATION_MESSAGE_TYPE || entry.customType === LEGACY_CONTINUATION_MESSAGE_TYPE);
}

export function recoverContinuation(entries: RecoveryEntryLike[]): ContinuationRecovery {
  let attemptId: string | null = null;
  let compactionIndex = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const found = autonomousAttemptId(entries[i]!);
    if (found !== null) {
      attemptId = found;
      compactionIndex = i;
      break;
    }
  }
  if (attemptId === null || compactionIndex === -1) return { ...NONE };

  const afterCompaction = entries.slice(compactionIndex + 1);
  const deliveryIndex = afterCompaction.findIndex(isContinuationMessage);
  if (deliveryIndex === -1) {
    return { phase: "committed", action: "deliver", attemptId };
  }

  const afterDelivery = afterCompaction.slice(deliveryIndex + 1);
  const answered = afterDelivery.some(
    (entry) => entry.type === "message" && entry.message?.role === "assistant",
  );
  if (answered) {
    return { phase: "answered", action: "none", attemptId };
  }

  // Delivered but not answered. Any continuation message already carrying the
  // resumed marker means the nudge fired once; never nag repeatedly.
  const resumed = afterCompaction.some(
    (entry) => isContinuationMessage(entry) && detailsOf(entry).resumed === true,
  );
  return {
    phase: "delivered",
    action: resumed ? "none" : "resume",
    attemptId,
  };
}
