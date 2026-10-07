import { validateCheckpoint } from "./compiler/checkpoint.ts";
import { sha256Hex } from "./sha256.ts";
import { isDistillCompactor, LEGACY_CONTINUATION_MESSAGE_TYPE } from "./legacy.ts";
import { DISTILL_CONTINUATION_MESSAGE_TYPE } from "./continuation.ts";

/**
 * Pure recovery reducer for durable autonomous continuation.
 *
 * Derives the continuation state of the latest autonomous dc-distill
 * compaction from active-branch session entries, so a restart, reload, or
 * tree switch can redeliver or suppress the continuation without trusting
 * process memory after a true process restart. Same-process uncertain submissions
 * require the separate process fence registry. Journaling comes from the ledger itself: the autonomous
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
  summary?: string;
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
  if (!isDistillCompactor(details.compactor) || ![8, 9, 10, 11, 12, 13, 14, 15].includes(details.version as number)) return null;
  if (details.autonomous !== true) return null;
  const attemptId = details.attemptId;
  return typeof attemptId === "string" && attemptId.length > 0 ? attemptId : null;
}

function isContinuationMessage(entry: RecoveryEntryLike): boolean {
  return entry.type === "custom_message"
    && (entry.customType === DISTILL_CONTINUATION_MESSAGE_TYPE || entry.customType === LEGACY_CONTINUATION_MESSAGE_TYPE);
}

function matchesContinuationAttempt(entry: RecoveryEntryLike, attemptId: string): boolean {
  if (!isContinuationMessage(entry)) return false;
  const messageAttemptId = detailsOf(entry).attemptId;
  // Historical continuation messages did not journal an attempt id.
  return messageAttemptId === undefined || messageAttemptId === attemptId;
}

export function recoverContinuation(entries: RecoveryEntryLike[]): ContinuationRecovery {
  let attemptId: string | null = null;
  let compactionIndex = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    const details = detailsOf(entry);
    if (entry.type === "compaction" && isDistillCompactor(details.compactor) && (details.version === 13 || details.version === 14 || details.version === 15)) {
      try {
        if (typeof details.checkpointDigest !== "string" || typeof entry.summary !== "string"
          || sha256Hex(entry.summary) !== details.summaryDigest) return { ...NONE };
        validateCheckpoint(details.checkpoint, details.checkpointDigest);
      } catch { return { ...NONE }; }
    }
    const found = autonomousAttemptId(entry);
    if (found !== null) {
      attemptId = found;
      compactionIndex = i;
      break;
    }
  }
  if (attemptId === null || compactionIndex === -1) return { ...NONE };

  const afterCompaction = entries.slice(compactionIndex + 1);
  // A later user objective or any later compaction replaces the older intent,
  // even when delivery had not yet been acknowledged in the journal.
  if (afterCompaction.some((entry) => entry.type === "compaction"
    || (entry.type === "message" && entry.message?.role === "user"))) {
    return { phase: "answered", action: "none", attemptId };
  }
  const deliveryIndex = afterCompaction.findIndex((entry) => matchesContinuationAttempt(entry, attemptId));
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

  // Delivered but not answered. A matching continuation message carrying the
  // resumed marker means the nudge fired once; never nag repeatedly.
  const resumed = afterCompaction.some(
    (entry) => matchesContinuationAttempt(entry, attemptId) && detailsOf(entry).resumed === true,
  );
  return {
    phase: "delivered",
    action: resumed ? "none" : "resume",
    attemptId,
  };
}
