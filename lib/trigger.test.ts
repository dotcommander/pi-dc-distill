import { describe, expect, test } from "bun:test";
import {
  ANSWER_HEADROOM_TOKENS,
  AUTO_TARGET_TOKENS,
  DISTILL_LEAD_TOKENS,
  PI_AI_SAFETY_MARGIN_TOKENS,
  TRIGGER_POLICY_VERSION,
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
    missedAuto: false,
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
      headroomFloor: { effective: 183_616, source: "pi-derived" },
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
      headroomFloor: { effective: 140_000, source: "fallback" },
      emergency: { effective: 160_000, source: "fallback" },
    });
  });
});

describe("shouldCompact", () => {
  test("uses fallback auto and headroom-floor bands when Pi cannot report a window", () => {
    expect(shouldCompact(atTokens(99_999))).toBeNull();
    expect(shouldCompact(atTokens(100_000))?.tier).toBe(Tier.Mechanical);
    // v2: the fallback floor clamps to the fallback warn line, so the old
    // steer band is empty and the line itself fires the floor.
    expect(shouldCompact(atTokens(140_000))?.reason).toBe(
      "headroom-floor: answer headroom exhausted — compact now",
    );
  });

  test("fires mechanical at the fixed auto target", () => {
    const options = { contextWindow: 200_000, compaction: pi };
    expect(shouldCompact(atTokens(119_999), true, options)).toBeNull();
    expect(shouldCompact(atTokens(120_000), true, options)?.tier).toBe(Tier.Mechanical);
  });

  test("fires the headroom floor at Pi's native trigger line with the default reserve", () => {
    const options = { contextWindow: 200_000, compaction: pi };
    // v2: reserve 16,384 puts warn at 183,616, above window - 20,480, so the
    // floor clamps to warn and the steer band is empty.
    expect(shouldCompact(atTokens(183_616), true, options)?.reason).toBe(
      "headroom-floor: answer headroom exhausted — compact now",
    );
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
    expect(assessment.updates).toEqual({
      awaitingPostCompactionSample: false,
      repeatBaselineTokens: 170_000,
      missedAuto: true,
    });
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

const win200r50 = { contextWindow: 200_000, compaction: { ...pi, reserveTokens: 50_000 } };

describe("trigger policy v2 — headroom floor", () => {
  test("resolves the floor at window minus answer headroom and pi-ai safety margin", () => {
    const thresholds = resolveTriggerThresholds(win200r50);
    expect(thresholds.headroomFloor).toEqual({ effective: 179_520, source: "pi-derived" });
    expect(thresholds.warn.effective).toBe(150_000);
    expect(thresholds.auto.effective).toBe(120_000);
  });

  test("clamps the floor to warn when the reserve already exceeds the headroom margin", () => {
    const thresholds = resolveTriggerThresholds({ contextWindow: 200_000, compaction: pi });
    expect(thresholds.headroomFloor.effective).toBe(thresholds.warn.effective);
    expect(thresholds.headroomFloor.effective).toBe(183_616);
  });

  test("fires mechanically at the floor even when unsynced", () => {
    const assessment = assessCompaction(atTokens(179_520), false, win200r50, Date.now());
    expect(assessment.decision?.reason).toBe("headroom-floor: answer headroom exhausted — compact now");
    expect(assessment.decision?.tier).toBe(Tier.Mechanical);
  });

  test("fires mechanically at the floor during cooldown", () => {
    const state = atTokens(179_520, { lastCompactionTime: Date.now() });
    expect(shouldCompact(state, true, win200r50)?.tier).toBe(Tier.Mechanical);
  });

  test("fires mechanically at the floor while a post-compaction sample is pending", () => {
    const state = atTokens(190_000, { awaitingPostCompactionSample: true });
    expect(shouldCompact(state, true, win200r50)?.tier).toBe(Tier.Mechanical);
  });

  test("fires mechanically at the floor despite repeat-growth blocking", () => {
    const state = atTokens(180_000, { repeatBaselineTokens: 179_000 });
    expect(shouldCompact(state, true, win200r50)?.tier).toBe(Tier.Mechanical);
  });

  test("keeps the emergency reason at the hard context limit", () => {
    expect(shouldCompact(atTokens(200_000), true, win200r50)?.reason).toBe(
      "emergency: approaching context limit",
    );
  });

  test("still steers below the floor when unblocked and no window was missed", () => {
    const decision = shouldCompact(atTokens(160_000), true, win200r50);
    expect(decision?.tier).toBe(Tier.Warn);
    expect(decision?.reason).toContain("finish current unit");
  });
});

describe("trigger policy v2 — missed-auto pursuit", () => {
  test("a blocked at-auto observation sets the marker and pursuit compacts at warn", () => {
    const state = atTokens(130_000, { lastCompactionTime: Date.now() });
    const blocked1 = assessCompaction(state, true, win200r50, Date.now());
    expect(blocked1.blockedBy).toBe("cooldown");
    expect(blocked1.updates.missedAuto).toBe(true);
    Object.assign(state, blocked1.updates);
    state.tokenEstimate = 155_000;
    const pursued = assessCompaction(state, true, win200r50, Date.now() + 200_000);
    expect(pursued.decision?.tier).toBe(Tier.Mechanical);
    expect(pursued.decision?.reason).toBe("missed-auto-pursuit: auto window missed — compact now");
    expect(pursued.updates.missedAuto).toBe(false);
  });

  test("below-auto clears the marker", () => {
    const below = assessCompaction(atTokens(90_000, { missedAuto: true }), true, win200r50, Date.now());
    expect(below.blockedBy).toBe("below-auto");
    expect(below.updates.missedAuto).toBe(false);
  });

  test("an unblocked auto decision clears the marker", () => {
    const decision = assessCompaction(atTokens(130_000, { missedAuto: true }), true, win200r50, Date.now());
    expect(decision.decision?.tier).toBe(Tier.Mechanical);
    expect(decision.updates.missedAuto).toBe(false);
  });

  test("pursuit does not bypass cooldown", () => {
    const state = atTokens(155_000, { missedAuto: true, lastCompactionTime: Date.now() });
    const blockedWarn = assessCompaction(state, true, win200r50, Date.now());
    expect(blockedWarn.blockedBy).toBe("cooldown");
    expect(blockedWarn.decision).toBeNull();
    expect(blockedWarn.updates.missedAuto).toBe(true);
  });

  test("missing-pi-sync sets the marker at or above auto", () => {
    const unsynced = assessCompaction(atTokens(125_000), false, win200r50, Date.now());
    expect(unsynced.blockedBy).toBe("missing-pi-sync");
    expect(unsynced.updates.missedAuto).toBe(true);
  });

  test("a post-compaction sample records a still-missed window and clears below auto", () => {
    const sample = assessCompaction(atTokens(125_000, { awaitingPostCompactionSample: true }), true, win200r50, Date.now());
    expect(sample.blockedBy).toBe("post-compaction-sample");
    expect(sample.updates.missedAuto).toBe(true);
    const lowSample = assessCompaction(atTokens(90_000, { awaitingPostCompactionSample: true }), true, win200r50, Date.now());
    expect(lowSample.updates.missedAuto).toBe(false);
  });

  test("repeat-growth blocking sets the marker", () => {
    const repeat = assessCompaction(atTokens(125_000, { repeatBaselineTokens: 124_000 }), true, win200r50, Date.now());
    expect(repeat.blockedBy).toBe("repeat-growth");
    expect(repeat.updates.missedAuto).toBe(true);
  });
});

describe("trigger policy v2 — geometry", () => {
  test("keeps auto <= warn <= headroomFloor <= emergency across window and reserve sizes", () => {
    for (const contextWindow of [3, 8_000, 32_000, 128_000, 200_000, 1_000_000]) {
      for (const reserveTokens of [0, 4_000, 16_384, 50_000, 200_000]) {
        const compaction = { ...pi, reserveTokens };
        const t = resolveTriggerThresholds({ contextWindow, compaction });
        expect(t.auto.effective).toBeLessThanOrEqual(t.warn.effective);
        expect(t.warn.effective).toBeLessThanOrEqual(t.headroomFloor.effective);
        expect(t.headroomFloor.effective).toBeLessThanOrEqual(t.emergency.effective);
        if (t.warn.effective < t.emergency.effective) {
          expect(validateTriggerGeometry({ contextWindow, compaction })).toEqual([]);
        }
      }
    }
  });

  test("clamps the floor to warn when window minus the headroom margin would fall below warn", () => {
    const t = resolveTriggerThresholds({ contextWindow: 30_000, compaction: { ...pi, reserveTokens: 4_000 } });
    expect(t.warn.effective).toBe(26_000);
    expect(t.headroomFloor.effective).toBe(26_000);
  });
});

describe("trigger policy v2 — version", () => {
  test("exports policy version 2 with the frozen cap, lead, and headroom constants", () => {
    expect(TRIGGER_POLICY_VERSION).toBe(2);
    expect(AUTO_TARGET_TOKENS).toBe(120_000);
    expect(DISTILL_LEAD_TOKENS).toBe(20_000);
    expect(ANSWER_HEADROOM_TOKENS).toBe(16_384);
    expect(PI_AI_SAFETY_MARGIN_TOKENS).toBe(4_096);
  });
});
