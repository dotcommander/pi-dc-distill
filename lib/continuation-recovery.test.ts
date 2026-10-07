import { describe, expect, test } from "bun:test";
import { emptyCheckpoint, checkpointDigest } from "./compiler/checkpoint.ts";
import { sha256Hex } from "./sha256.ts";
import { recoverContinuation, type ContinuationRecovery, type RecoveryEntryLike } from "./continuation-recovery.ts";

function autonomousCompaction(overrides: Record<string, unknown> = {}): RecoveryEntryLike {
  const checkpoint = emptyCheckpoint();
  return {
    type: "compaction", summary: "wire",
    details: { compactor: "dc-distill", version: 8, autonomous: true, attemptId: "a-1", checkpoint, checkpointDigest: checkpointDigest(checkpoint), summaryDigest: sha256Hex("wire"), ...overrides },
  };
}

function continuation(
  overrides: Record<string, unknown> = {},
  customType = "dc-distill-continuation",
): RecoveryEntryLike {
  return {
    type: "custom_message",
    customType,
    details: { reason: "autonomous_compaction", attemptId: "a-1", ...overrides },
  };
}

function message(role: string): RecoveryEntryLike {
  return { type: "message", message: { role } };
}

describe("recoverContinuation", () => {
  test("returns none without an autonomous dc-distill compaction", () => {
    expect(recoverContinuation([])).toEqual({ phase: "none", action: "none" });
    expect(recoverContinuation([message("user")])).toEqual({ phase: "none", action: "none" });
    expect(
      recoverContinuation([autonomousCompaction({ compactor: "builtin" })]),
    ).toEqual({ phase: "none", action: "none" });
    expect(
      recoverContinuation([autonomousCompaction({ autonomous: false })]),
    ).toEqual({ phase: "none", action: "none" });
    expect(
      recoverContinuation([autonomousCompaction({ autonomous: undefined, attemptId: "a-9" })]),
    ).toEqual({ phase: "none", action: "none" });
  });

  test("returns none for an autonomous compaction without an attempt id", () => {
    expect(
      recoverContinuation([autonomousCompaction({ attemptId: undefined })]),
    ).toEqual({ phase: "none", action: "none" });
  });

  test("committed compaction with no delivery wants delivery", () => {
    expect(recoverContinuation([message("user"), autonomousCompaction()])).toEqual({
      phase: "committed",
      action: "deliver",
      attemptId: "a-1",
    });
  });

  test("a later genuine user supersedes an unanswered continuation", () => {
    expect(
      recoverContinuation([autonomousCompaction(), continuation(), message("user")]),
    ).toEqual({ phase: "answered", action: "none", attemptId: "a-1" });
  });

  test("delivered with the resumed marker stands down", () => {
    expect(
      recoverContinuation([autonomousCompaction(), continuation({ resumed: true })]),
    ).toEqual({ phase: "delivered", action: "none", attemptId: "a-1" });
    expect(
      recoverContinuation([
        autonomousCompaction(),
        continuation(),
        continuation({ resumed: true, attemptId: "a-1" }),
      ]),
    ).toEqual({ phase: "delivered", action: "none", attemptId: "a-1" });
  });

  test("an assistant answer after delivery completes the cycle", () => {
    expect(
      recoverContinuation([autonomousCompaction(), continuation(), message("assistant")]),
    ).toEqual({ phase: "answered", action: "none", attemptId: "a-1" });
  });

  test("an assistant answer before the delivery does not count", () => {
    expect(
      recoverContinuation([autonomousCompaction(), message("assistant"), continuation()]),
    ).toEqual({ phase: "delivered", action: "resume", attemptId: "a-1" });
  });

  test("ignores a continuation message that predates the compaction", () => {
    expect(
      recoverContinuation([continuation({ attemptId: "older" }), autonomousCompaction()]),
    ).toEqual({ phase: "committed", action: "deliver", attemptId: "a-1" });
  });

  test("only the latest autonomous compaction counts", () => {
    expect(
      recoverContinuation([
        autonomousCompaction({ attemptId: "a-0" }),
        continuation({ attemptId: "a-0" }),
        autonomousCompaction({ attemptId: "a-1" }),
      ]),
    ).toEqual({ phase: "committed", action: "deliver", attemptId: "a-1" });
  });

  test("a legacy continuation without an attempt id still counts as delivery", () => {
    expect(
      recoverContinuation([
        autonomousCompaction(),
        continuation({ attemptId: undefined }),
      ]),
    ).toEqual({ phase: "delivered", action: "resume", attemptId: "a-1" });
  });

  for (const version of [8, 9, 10, 11, 12, 13, 14, 15]) {
    test(`v${version} delivery and resume journal each suppress repeated recovery`, () => {
      const committed = [autonomousCompaction({ version })];
      const originalCompaction = JSON.stringify(committed);
      expect(recoverContinuation(committed)).toEqual({ phase: "committed", action: "deliver", attemptId: "a-1" });
      const delivered = [...committed, continuation()];
      expect(recoverContinuation(delivered)).toEqual({ phase: "delivered", action: "resume", attemptId: "a-1" });
      const resumed = [...delivered, continuation({ resumed: true })];
      expect(recoverContinuation(resumed)).toEqual({ phase: "delivered", action: "none", attemptId: "a-1" });
      expect(recoverContinuation(resumed)).toEqual({ phase: "delivered", action: "none", attemptId: "a-1" });
      expect(recoverContinuation([...delivered, message("assistant")])).toEqual({ phase: "answered", action: "none", attemptId: "a-1" });
      // Recovery must leave historical and current persisted entries untouched.
      expect(JSON.stringify(committed)).toBe(originalCompaction);
    });
  }

  for (const version of [8, 9, 10, 11, 12, 13, 14, 15]) {
    for (const customType of ["dc-distill-continuation", "dc-shrink-continuation"]) {
      describe(`v${version} ${customType} attempt matching`, () => {
        const compaction = () => autonomousCompaction({ version });
        const delivery = (overrides: Record<string, unknown> = {}) => continuation(overrides, customType);
        const committed: ContinuationRecovery = { phase: "committed", action: "deliver", attemptId: "a-1" };
        const delivered: ContinuationRecovery = { phase: "delivered", action: "resume", attemptId: "a-1" };

        test("another attempt cannot mark delivery", () => {
          expect(recoverContinuation([compaction(), delivery({ attemptId: "other" })])).toEqual(committed);
        });

        test("an answer to another attempt does not answer a later matching delivery", () => {
          const entries = [compaction(), delivery({ attemptId: "other" }), message("assistant")];
          expect(recoverContinuation(entries)).toEqual(committed);
          expect(recoverContinuation([...entries, delivery()])).toEqual(delivered);
        });

        test("only a matching resumed marker suppresses recovery", () => {
          const wrongMarker = delivery({ attemptId: "other", resumed: true });
          expect(recoverContinuation([compaction(), wrongMarker])).toEqual(committed);
          expect(recoverContinuation([compaction(), delivery(), wrongMarker])).toEqual(delivered);
          expect(recoverContinuation([compaction(), wrongMarker, delivery()])).toEqual(delivered);
          expect(recoverContinuation([compaction(), delivery(), delivery({ resumed: true })])).toEqual({
            phase: "delivered", action: "none", attemptId: "a-1",
          });
        });

        test("missing legacy ids retain delivery and resume behavior", () => {
          const legacyDelivery = delivery();
          delete (legacyDelivery.details as Record<string, unknown>).attemptId;
          expect(recoverContinuation([compaction(), legacyDelivery])).toEqual(delivered);
          expect(recoverContinuation([compaction(), delivery({ attemptId: undefined })])).toEqual(delivered);
          expect(recoverContinuation([compaction(), legacyDelivery, message("assistant")])).toEqual({
            phase: "answered", action: "none", attemptId: "a-1",
          });
          expect(recoverContinuation([compaction(), delivery(), {
            ...legacyDelivery, details: { resumed: true },
          }])).toEqual({ phase: "delivered", action: "none", attemptId: "a-1" });
        });

        test("explicit invalid ids are never trimmed or coerced into a match", () => {
          for (const attemptId of [null, false, true, 1, "", " a-1", "a-1 ", "A-1", {}, ["a-1"]]) {
            const invalidDelivery = delivery({ attemptId });
            expect(recoverContinuation([compaction(), invalidDelivery])).toEqual(committed);
            expect(recoverContinuation([
              compaction(), delivery(), delivery({ attemptId, resumed: true }),
            ])).toEqual(delivered);
          }
        });

        test("an assistant answer after matching delivery completes the attempt", () => {
          expect(recoverContinuation([compaction(), delivery(), message("assistant")])).toEqual({
            phase: "answered", action: "none", attemptId: "a-1",
          });
        });
      });
    }
  }

  test("ignores unrelated custom messages", () => {
    expect(
      recoverContinuation([
        autonomousCompaction(),
        { type: "custom_message", customType: "dc-distill-handoff", details: {} },
      ]),
    ).toEqual({ phase: "committed", action: "deliver", attemptId: "a-1" });
  });

  test("tolerates malformed details payloads", () => {
    expect(
      recoverContinuation([
        { type: "compaction", details: "corrupt" },
        autonomousCompaction(),
        { type: "custom_message", customType: "dc-distill-continuation", details: null },
      ]),
    ).toEqual({ phase: "delivered", action: "resume", attemptId: "a-1" });
  });
});

for (const version of [5, 6, 7, 16]) test(`v${version} cannot authorize autonomous continuation recovery`, () => {
  expect(recoverContinuation([autonomousCompaction({ version })])).toEqual({ phase: "none", action: "none" });
});

test("v13 intent is superseded before or after delivery by genuine user/manual/foreign compaction", () => {
  for (const later of [message("user"), { type: "compaction", details: { compactor: "dc-distill", version: 13, autonomous: false } },
    { type: "compaction", details: { compactor: "builtin" } }]) {
    for (const delivered of [[], [continuation()]]) {
      expect(recoverContinuation([autonomousCompaction({ version: 13 }), ...delivered, later]).action).toBe("none");
    }
  }
  expect(recoverContinuation([autonomousCompaction({ version: 13 })]).action).toBe("deliver");
});

for (const version of [13, 14, 15]) test(`corrupt v${version} does not recover an earlier automatic intent`, () => {
  expect(recoverContinuation([autonomousCompaction(),autonomousCompaction({version,checkpointDigest:"f".repeat(64)})]).action).toBe("none");
  expect(recoverContinuation([autonomousCompaction(),autonomousCompaction({version,summaryDigest:"f".repeat(64)})]).action).toBe("none");
  expect(recoverContinuation([autonomousCompaction(),autonomousCompaction({version,checkpoint:undefined})]).action).toBe("none");
});
