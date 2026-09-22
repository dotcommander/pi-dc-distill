import { describe, expect, test } from "bun:test";
import { recoverContinuation, type RecoveryEntryLike } from "./continuation-recovery.ts";

function autonomousCompaction(overrides: Record<string, unknown> = {}): RecoveryEntryLike {
  return {
    type: "compaction",
    details: { compactor: "dc-shrink", version: 8, autonomous: true, attemptId: "a-1", ...overrides },
  };
}

function continuation(overrides: Record<string, unknown> = {}): RecoveryEntryLike {
  return {
    type: "custom_message",
    customType: "dc-shrink-continuation",
    details: { reason: "autonomous_compaction", attemptId: "a-1", ...overrides },
  };
}

function message(role: string): RecoveryEntryLike {
  return { type: "message", message: { role } };
}

describe("recoverContinuation", () => {
  test("returns none without an autonomous dc-shrink compaction", () => {
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

  test("delivered but unanswered wants exactly one resume nudge", () => {
    expect(
      recoverContinuation([autonomousCompaction(), continuation(), message("user")]),
    ).toEqual({ phase: "delivered", action: "resume", attemptId: "a-1" });
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

  test("ignores unrelated custom messages", () => {
    expect(
      recoverContinuation([
        autonomousCompaction(),
        { type: "custom_message", customType: "dc-shrink-handoff", details: {} },
      ]),
    ).toEqual({ phase: "committed", action: "deliver", attemptId: "a-1" });
  });

  test("tolerates malformed details payloads", () => {
    expect(
      recoverContinuation([
        { type: "compaction", details: "corrupt" },
        autonomousCompaction(),
        { type: "custom_message", customType: "dc-shrink-continuation", details: null },
      ]),
    ).toEqual({ phase: "delivered", action: "resume", attemptId: "a-1" });
  });
});
