import { describe, expect, test } from "bun:test";
import {
  resolveTriggerThresholds,
  shouldCompact,
  validateTriggerGeometry,
} from "./trigger.ts";
import type { CompactState } from "./types.ts";
import { Tier } from "./types.ts";

const freshState = (overrides: Partial<CompactState> = {}): CompactState => {
  const now = Date.now();
  return {
    tokenEstimate: 0,
    toolTokens: 0,
    lastUserMessageTime: now,
    lastCompactionTime: now - 300_000,
    repeatBaselineTokens: null,
    awaitingPostCompactionSample: false,
    callCount: 0,
    exchangeCount: 0,
    compactionCount: 0,
    apiTokenCount: 0,
    ...overrides,
  };
};

const atTokens = (tokens: number, extra: Partial<CompactState> = {}): CompactState =>
  freshState({ tokenEstimate: tokens, ...extra });

const pi = {
  enabled: true,
  reserveTokens: 16_384,
};

describe("resolveTriggerThresholds", () => {
  test("compacts 20k before Pi's reserve-derived trigger", () => {
    expect(resolveTriggerThresholds({ contextWindow: 200_000, compaction: pi })).toEqual({
      auto: { effective: 163_616, source: "pi-derived" },
      warn: { effective: 183_616, source: "pi-derived" },
      emergency: { effective: 200_000, source: "pi-derived" },
    });
  });

  test("keeps the fixed 20k lead when Pi's reserve changes", () => {
    const thresholds = resolveTriggerThresholds({
      contextWindow: 200_000,
      compaction: { ...pi, reserveTokens: 24_000 },
    });
    expect(thresholds.auto.effective).toBe(156_000);
    expect(thresholds.warn.effective).toBe(176_000);
  });

  test("uses Pi geometry for a 128k context", () => {
    const thresholds = resolveTriggerThresholds({ contextWindow: 128_000, compaction: pi });
    expect(thresholds.auto.effective).toBe(91_616);
    expect(thresholds.warn.effective).toBe(111_616);
    expect(thresholds.emergency.effective).toBe(128_000);
  });

  test("keeps ordered small-window thresholds with fixed safety floors", () => {
    const thresholds = resolveTriggerThresholds({ contextWindow: 32_000, compaction: pi });
    expect(thresholds.auto.effective).toBe(8_000);
    expect(thresholds.warn.effective).toBe(15_616);
    expect(thresholds.emergency.effective).toBe(32_000);
    expect(validateTriggerGeometry({ contextWindow: 32_000, compaction: pi })).toEqual([]);
  });

  test("uses safe legacy fallbacks without a Pi context window", () => {
    expect(resolveTriggerThresholds({ compaction: pi })).toEqual({
      auto: { effective: 100_000, source: "fallback" },
      warn: { effective: 140_000, source: "fallback" },
      emergency: { effective: 160_000, source: "fallback" },
    });
  });
});

describe("shouldCompact", () => {
  test("uses fallback auto and warn bands when Pi cannot report a window", () => {
    expect(shouldCompact(atTokens(99_999))).toBeNull();
    expect(shouldCompact(atTokens(100_000))?.tier).toBe(Tier.Mechanical);
    expect(shouldCompact(atTokens(140_000))?.tier).toBe(Tier.Warn);
  });

  test("fires mechanical at the Pi-derived auto threshold", () => {
    const options = { contextWindow: 200_000, compaction: pi };
    expect(shouldCompact(atTokens(163_615), true, options)).toBeNull();
    expect(shouldCompact(atTokens(163_616), true, options)?.tier).toBe(Tier.Mechanical);
  });

  test("warns at Pi's own native trigger line", () => {
    const options = { contextWindow: 200_000, compaction: pi };
    expect(shouldCompact(atTokens(183_616), true, options)?.tier).toBe(Tier.Warn);
  });

  test("fires at the hard context limit regardless of cooldown or Pi sync", () => {
    const state = atTokens(200_000, { lastCompactionTime: Date.now() });
    expect(shouldCompact(state, false, { contextWindow: 200_000, compaction: pi })?.tier)
      .toBe(Tier.Mechanical);
  });

  test("stands down completely when Pi auto-compaction is disabled", () => {
    const disabled = { ...pi, enabled: false };
    expect(shouldCompact(atTokens(250_000), true, {
      contextWindow: 200_000,
      compaction: disabled,
    })).toBeNull();
  });

  test("does not fire before Pi sync outside the emergency band", () => {
    expect(shouldCompact(atTokens(170_000), false, {
      contextWindow: 200_000,
      compaction: pi,
    })).toBeNull();
  });

  test("honors cooldown before warning or mechanical compaction", () => {
    const options = { contextWindow: 200_000, compaction: pi };
    expect(shouldCompact(atTokens(170_000, { lastCompactionTime: Date.now() }), true, options))
      .toBeNull();
  });

  test("requires new growth after a post-compaction sample", () => {
    const options = { contextWindow: 200_000, compaction: pi };
    const state = atTokens(170_000, {
      awaitingPostCompactionSample: true,
      repeatBaselineTokens: null,
    });
    expect(shouldCompact(state, true, options)).toBeNull();
    expect(state.repeatBaselineTokens).toBe(170_000);
    expect(shouldCompact(state, true, options)).toBeNull();
    state.tokenEstimate += 4_000;
    expect(shouldCompact(state, true, options)?.tier).toBe(Tier.Mechanical);
  });
});

describe("validateTriggerGeometry", () => {
  test("reports invalid cooldown and context window inputs", () => {
    const violations = validateTriggerGeometry({ cooldownMs: -1, contextWindow: -128_000 });
    expect(violations.map((violation) => violation.field)).toContain("cooldownMs");
    expect(violations.map((violation) => violation.field)).toContain("contextWindow");
  });
});
