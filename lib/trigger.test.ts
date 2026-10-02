import { describe, expect, test } from "bun:test";
import {
  assessCompaction,
  evaluateCompaction,
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
  test("uses the fixed 120k target when Pi's safety geometry allows it", () => {
    expect(resolveTriggerThresholds({ contextWindow: 200_000, compaction: pi })).toEqual({
      auto: { effective: 120_000, source: "policy-capped" },
      warn: { effective: 183_616, source: "pi-derived" },
      emergency: { effective: 200_000, source: "pi-derived" },
    });
  });

  test("keeps the fixed target when Pi's reserve changes without constraining it", () => {
    const thresholds = resolveTriggerThresholds({
      contextWindow: 200_000,
      compaction: { ...pi, reserveTokens: 24_000 },
    });
    expect(thresholds.auto).toEqual({ effective: 120_000, source: "policy-capped" });
    expect(thresholds.warn.effective).toBe(176_000);
  });

  test("uses Pi geometry for a 128k context", () => {
    const thresholds = resolveTriggerThresholds({ contextWindow: 128_000, compaction: pi });
    expect(thresholds.auto).toEqual({ effective: 91_616, source: "pi-derived" });
    expect(thresholds.warn.effective).toBe(111_616);
    expect(thresholds.emergency.effective).toBe(128_000);
  });

  test("keeps a 128k model safe with the global 50k reserve", () => {
    const thresholds = resolveTriggerThresholds({
      contextWindow: 128_000,
      compaction: { ...pi, reserveTokens: 50_000 },
    });
    expect(thresholds.auto).toEqual({ effective: 58_000, source: "pi-derived" });
    expect(thresholds.warn.effective).toBe(78_000);
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

  test("fires mechanical at the fixed auto target", () => {
    const options = { contextWindow: 200_000, compaction: pi };
    expect(shouldCompact(atTokens(119_999), true, options)).toBeNull();
    expect(shouldCompact(atTokens(120_000), true, options)?.tier).toBe(Tier.Mechanical);
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

  test("reports missing Pi sync when an auto-threshold trigger is blocked", () => {
    const evaluation = evaluateCompaction(atTokens(170_000), false, {
      contextWindow: 200_000,
      compaction: pi,
    });
    expect(evaluation.decision).toBeNull();
    expect(evaluation.blockedBy).toBe("missing-pi-sync");
    expect(evaluation.thresholds.auto.effective).toBe(120_000);
  });

  test("reports cooldown when an auto-threshold trigger is blocked", () => {
    const options = { contextWindow: 200_000, compaction: pi };
    const evaluation = evaluateCompaction(
      atTokens(170_000, { lastCompactionTime: Date.now() }),
      true,
      options,
    );
    expect(evaluation.decision).toBeNull();
    expect(evaluation.blockedBy).toBe("cooldown");
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

describe("pure compaction assessment", () => {
  test("returns post-compaction updates without mutating frozen input", () => {
    const state = Object.freeze(atTokens(170_000, { awaitingPostCompactionSample: true }));
    const assessment = assessCompaction(state, true, { contextWindow: 200_000, compaction: pi }, 1_000_000);
    expect(assessment.blockedBy).toBe("post-compaction-sample");
    expect(assessment.updates).toEqual({ awaitingPostCompactionSample: false, repeatBaselineTokens: 170_000 });
    expect(state.awaitingPostCompactionSample).toBe(true);
    expect(state.repeatBaselineTokens).toBeNull();
  });
  test("uses supplied time and rejects nonfinite estimates", () => {
    const state = atTokens(130_000, { lastCompactionTime: 1_000_000 });
    expect(assessCompaction(state, true, {}, 1_000_001).blockedBy).toBe("cooldown");
    expect(assessCompaction(state, true, {}, 1_120_000).decision?.tier).toBe(Tier.Mechanical);
    for (const tokens of [NaN, Infinity, -Infinity]) {
      expect(assessCompaction(atTokens(tokens), true, {}, 1_000_000).blockedBy).toBe("invalid-estimate");
    }
  });
});

test("windows below three tokens disable even emergency autonomous admission", () => {
  for (const contextWindow of [0, 1, 2, 2.5]) {
    const state = { tokenEstimate: 200_000, lastCompactionTime: 0, repeatBaselineTokens: null,
      awaitingPostCompactionSample: false } as any;
    expect(evaluateCompaction(state, true, { contextWindow }).blockedBy).toBe("invalid-geometry");
  }
});
