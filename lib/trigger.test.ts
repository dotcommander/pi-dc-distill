// Tests for dc-shrink/lib/trigger.ts — shouldCompact determination logic
// Run: bun test extensions/dc-app/lib/knowledge/features/shrink/lib/trigger.test.ts

import { describe, test, expect } from "bun:test";
import {
  resolveTriggerThresholds,
  shouldCompact,
  validateTriggerGeometry,
} from "./trigger.ts";
import type { CompactState } from "./types.ts";
import { Tier } from "./types.ts";

// --- Test fixture helpers ---

const freshState = (overrides: Partial<CompactState> = {}): CompactState => {
  const now = Date.now();
  return {
    tokenEstimate: 0,
    toolTokens: 0,
    lastUserMessageTime: now,
    lastCompactionTime: now - 300_000, // 5 min ago — past cooldown
    repeatBaselineTokens: null,
    awaitingPostCompactionSample: false,
    callCount: 0,
    exchangeCount: 0,
    compactionCount: 0,
    apiTokenCount: 0,
    ...overrides,
  };
};

// State at exactly N tokens, cooldown expired
const atTokens = (n: number, extra: Partial<CompactState> = {}): CompactState =>
  freshState({ tokenEstimate: n, ...extra });

// --- Tests ---

describe("shouldCompact", () => {
  // ── Below threshold: no compaction ──────────────────────────────────────

  test("returns null when tokenEstimate is 0", () => {
    expect(shouldCompact(freshState({ tokenEstimate: 0 }))).toBeNull();
  });

  test("returns null well below threshold (50k)", () => {
    expect(shouldCompact(atTokens(50_000))).toBeNull();
  });

  test("returns null just below threshold (99,999)", () => {
    expect(shouldCompact(atTokens(99_999))).toBeNull();
  });

  test("returns null at threshold - 1", () => {
    expect(shouldCompact(atTokens(99_999))).toBeNull();
  });

  // ── Auto threshold (100k): Mechanical tier ────────────────────────────────

  test("fires Mechanical at exactly 100,000 tokens", () => {
    const result = shouldCompact(atTokens(100_000));
    expect(result).not.toBeNull();
    expect(result!.tier).toBe(Tier.Mechanical);
    expect(result!.reason).toContain("auto");
  });

  test("fires Mechanical at 120,000 tokens", () => {
    const result = shouldCompact(atTokens(120_000));
    expect(result).not.toBeNull();
    expect(result!.tier).toBe(Tier.Mechanical);
  });

  test("fires Warn at 159,999 tokens (just below emergency)", () => {
    const result = shouldCompact(atTokens(159_999));
    expect(result).not.toBeNull();
    expect(result!.tier).toBe(Tier.Warn);
  });

  test("respects configured auto threshold", () => {
    expect(
      shouldCompact(atTokens(159_999), true, {
        autoThresholdTokens: 160_000,
        warnThresholdTokens: 200_000,
        emergencyThresholdTokens: 300_000,
      }),
    ).toBeNull();

    const result = shouldCompact(atTokens(160_000), true, {
      autoThresholdTokens: 160_000,
      warnThresholdTokens: 200_000,
      emergencyThresholdTokens: 300_000,
    });
    expect(result).not.toBeNull();
    expect(result!.tier).toBe(Tier.Mechanical);
  });

  // ── Emergency threshold (160k): Mechanical tier ─────────────────────────

  test("fires Mechanical at 160,000 tokens (emergency)", () => {
    const result = shouldCompact(atTokens(160_000));
    expect(result).not.toBeNull();
    expect(result!.tier).toBe(Tier.Mechanical);
    expect(result!.reason).toContain("emergency");
  });

  test("fires Mechanical at 200,000 tokens", () => {
    const result = shouldCompact(atTokens(200_000));
    expect(result).not.toBeNull();
    expect(result!.tier).toBe(Tier.Mechanical);
  });

  test("fires Mechanical at 500,000 tokens", () => {
    const result = shouldCompact(atTokens(500_000));
    expect(result).not.toBeNull();
    expect(result!.tier).toBe(Tier.Mechanical);
  });

  // ── Cooldown guard ──────────────────────────────────────────────────────

  test("returns null when within cooldown period after last compaction", () => {
    const now = Date.now();
    const state = freshState({
      tokenEstimate: 120_000,
      lastCompactionTime: now - 60_000, // 1 min ago — within 2 min cooldown
    });
    expect(shouldCompact(state)).toBeNull();
  });

  test("fires after cooldown expires (exactly COOLDOWN_MS ago)", () => {
    const now = Date.now();
    const state = freshState({
      tokenEstimate: 120_000,
      lastCompactionTime: now - 120_000, // exactly at boundary
    });
    // Date.now() - state.lastCompactionTime === 120_000 which is NOT < 120_000
    // so cooldown has expired
    const result = shouldCompact(state);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe(Tier.Mechanical);
  });

  test("fires after cooldown expires (well past)", () => {
    const state = freshState({
      tokenEstimate: 120_000,
      lastCompactionTime: Date.now() - 300_000, // 5 min ago
    });
    const result = shouldCompact(state);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe(Tier.Mechanical);
  });

  test("respects custom cooldown option", () => {
    const state = freshState({
      tokenEstimate: 120_000,
      lastCompactionTime: Date.now() - 180_000,
    });

    expect(shouldCompact(state, true, { cooldownMs: 300_000 })).toBeNull();
    expect(shouldCompact(state, true, { cooldownMs: 120_000 })).not.toBeNull();
  });

  // ── Emergency bypasses cooldown ─────────────────────────────────────────

  test("emergency fires even within cooldown period", () => {
    const now = Date.now();
    const state = freshState({
      tokenEstimate: 170_000,
      lastCompactionTime: now - 10_000, // 10s ago — well within cooldown
    });
    const result = shouldCompact(state);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe(Tier.Mechanical);
    expect(result!.reason).toContain("emergency");
  });

  test("emergency fires when compaction just happened", () => {
    const now = Date.now();
    const state = freshState({
      tokenEstimate: 200_000,
      lastCompactionTime: now, // compaction happened this instant
    });
    // Emergency check is BEFORE cooldown check
    const result = shouldCompact(state);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe(Tier.Mechanical);
  });

  // ── Boundary conditions ─────────────────────────────────────────────────

  test("AUTO_THRESHOLD boundary: 99,999 is null, 100,000 fires", () => {
    expect(shouldCompact(atTokens(99_999))).toBeNull();
    expect(shouldCompact(atTokens(100_000))).not.toBeNull();
  });

  test("EMERGENCY boundary: 159,999 is warn, 160,000 is emergency-Mechanical", () => {
    const at = shouldCompact(atTokens(159_999));
    expect(at).not.toBeNull();
    expect(at!.tier).toBe(Tier.Warn);

    const above = shouldCompact(atTokens(160_000));
    expect(above).not.toBeNull();
    expect(above!.tier).toBe(Tier.Mechanical);
  });

  // ── Result shape ────────────────────────────────────────────────────────

  test("auto-threshold decision has non-empty reason string", () => {
    const result = shouldCompact(atTokens(110_000));
    expect(result).not.toBeNull();
    expect(typeof result!.reason).toBe("string");
    expect(result!.reason.length).toBeGreaterThan(0);
  });

  test("Mechanical decision has non-empty reason string", () => {
    const result = shouldCompact(atTokens(180_000));
    expect(result).not.toBeNull();
    expect(typeof result!.reason).toBe("string");
    expect(result!.reason.length).toBeGreaterThan(0);
  });

  // ── piSynced=false guard: inflated estimate ─────────────────────────────

  test("returns null at 120k when piSynced=false (inflated estimate)", () => {
    // Monitor estimates 120k but pi's real count is unknown — skip compaction
    expect(shouldCompact(atTokens(120_000), false)).toBeNull();
  });

  test("returns null at 100k when piSynced=false", () => {
    expect(shouldCompact(atTokens(100_000), false)).toBeNull();
  });

  test("returns null at 159,999 when piSynced=false (below emergency)", () => {
    expect(shouldCompact(atTokens(159_999), false)).toBeNull();
  });

  test("emergency still fires at 160,001 when piSynced=false", () => {
    // Emergency is the safety net — fires regardless of sync status
    const result = shouldCompact(atTokens(160_001), false);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe(Tier.Mechanical);
    expect(result!.reason).toContain("emergency");
  });

  test("piSynced=true allows normal auto-threshold compaction", () => {
    const result = shouldCompact(atTokens(110_000), true);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe(Tier.Mechanical);
  });

  // ── Post-compaction repeat growth guard ────────────────────────────────

  test("first post-compaction sample becomes baseline and does not trigger", () => {
    const state = atTokens(120_000, {
      awaitingPostCompactionSample: true,
      lastCompactionTime: Date.now() - 300_000,
    });
    const result = shouldCompact(state, true);

    expect(result).toBeNull();
    expect(state.awaitingPostCompactionSample).toBe(false);
    expect(state.repeatBaselineTokens).toBe(120_000);
  });

  test("first post-compaction sample below threshold clears repeat baseline", () => {
    const state = atTokens(80_000, {
      awaitingPostCompactionSample: true,
      repeatBaselineTokens: 110_000,
      lastCompactionTime: Date.now() - 300_000,
    });
    const result = shouldCompact(state, true);

    expect(result).toBeNull();
    expect(state.awaitingPostCompactionSample).toBe(false);
    expect(state.repeatBaselineTokens).toBeNull();
  });

  test("does not consume post-compaction baseline when pi token sync is missing", () => {
    const state = atTokens(120_000, {
      awaitingPostCompactionSample: true,
      lastCompactionTime: Date.now() - 300_000,
    });
    const result = shouldCompact(state, false);

    expect(result).toBeNull();
    expect(state.awaitingPostCompactionSample).toBe(true);
    expect(state.repeatBaselineTokens).toBeNull();
  });

  test("does not repeat after cooldown without enough token growth", () => {
    const state = atTokens(123_999, {
      repeatBaselineTokens: 120_000,
      lastCompactionTime: Date.now() - 300_000,
    });
    expect(shouldCompact(state, true)).toBeNull();
  });

  test("repeats after cooldown with enough token growth", () => {
    const state = atTokens(124_000, {
      repeatBaselineTokens: 120_000,
      lastCompactionTime: Date.now() - 300_000,
    });
    const result = shouldCompact(state, true);

    expect(result).not.toBeNull();
    expect(result!.tier).toBe(Tier.Mechanical);
  });

  test("emergency bypasses pending post-compaction baseline", () => {
    const state = atTokens(170_000, {
      awaitingPostCompactionSample: true,
      lastCompactionTime: Date.now(),
    });
    const result = shouldCompact(state, false);

    expect(result).not.toBeNull();
    expect(result!.reason).toContain("emergency");
    expect(state.awaitingPostCompactionSample).toBe(true);
  });

  // ── Model-relative thresholds (contextWindow) ───────────────────────────
  // 128K window: effectiveAuto = round(0.75*128000) = 96000,
  //              effectiveEmergency = round(0.92*128000) = 117760
  const pct = {
    autoThresholdPct: 0.75,
    warnThresholdPct: 0.85,
    emergencyThresholdPct: 0.92,
  };

  test("128K window: normal fires at >=96k (below absolute 100k cap)", () => {
    const result = shouldCompact(atTokens(96_000), true, {
      contextWindow: 128_000,
      ...pct,
    });
    expect(result).not.toBeNull();
    expect(result!.tier).toBe(Tier.Mechanical);
  });

  test("128K window: returns null just below 96k", () => {
    expect(
      shouldCompact(atTokens(95_999), true, { contextWindow: 128_000, ...pct }),
    ).toBeNull();
  });

  test("128K window: warn steer fires in [108800, 117760) band, not compact", () => {
    // effectiveAuto=96000, effectiveWarn=round(0.85*128000)=108800,
    // effectiveEmergency=round(0.92*128000)=117760
    const result = shouldCompact(atTokens(110_000), true, {
      contextWindow: 128_000,
      ...pct,
      warnThresholdPct: 0.85,
    });
    expect(result).not.toBeNull();
    expect(result!.tier).toBe(Tier.Warn);
    expect(result!.reason).toContain("warn");
  });

  test("128K window: emergency still forces Mechanical at >=117760", () => {
    const result = shouldCompact(atTokens(118_000), false, {
      contextWindow: 128_000,
      ...pct,
      warnThresholdPct: 0.85,
    });
    expect(result).not.toBeNull();
    expect(result!.tier).toBe(Tier.Mechanical);
    expect(result!.reason).toContain("emergency");
  });

  test("128K window: emergency fires at >=118k, not 160k", () => {
    const result = shouldCompact(atTokens(118_000), false, {
      contextWindow: 128_000,
      ...pct,
    });
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("emergency");
  });

  test("128K window: 117k does NOT trip emergency (just below effective emergency)", () => {
    expect(
      shouldCompact(atTokens(117_000), false, {
        contextWindow: 128_000,
        ...pct,
      }),
    ).toBeNull();
  });

  test("200K window: absolute caps win — normal still 100k, emergency still 160k", () => {
    expect(
      shouldCompact(atTokens(99_999), true, { contextWindow: 200_000, ...pct }),
    ).toBeNull();
    expect(
      shouldCompact(atTokens(100_000), true, {
        contextWindow: 200_000,
        ...pct,
      }),
    ).not.toBeNull();
    expect(
      shouldCompact(atTokens(160_001), false, {
        contextWindow: 200_000,
        ...pct,
      }),
    ).not.toBeNull();
    expect(
      shouldCompact(atTokens(159_999), false, {
        contextWindow: 200_000,
        ...pct,
      }),
    ).toBeNull();
  });

  test("contextWindow undefined falls back to absolute 100k/160k", () => {
    expect(shouldCompact(atTokens(99_999), true, pct)).toBeNull();
    expect(shouldCompact(atTokens(100_000), true, pct)).not.toBeNull();
    expect(shouldCompact(atTokens(160_001), false, pct)!.reason).toContain(
      "emergency",
    );
  });

  test("contextWindow 0 falls back to absolute 100k/160k", () => {
    expect(
      shouldCompact(atTokens(99_999), true, { contextWindow: 0, ...pct }),
    ).toBeNull();
    expect(
      shouldCompact(atTokens(160_001), false, { contextWindow: 0, ...pct })!
        .reason,
    ).toContain("emergency");
  });
});

describe("three-band threshold policy", () => {
  const cases = [
    {
      name: "unknown window",
      options: {},
      expected: [100_000, 140_000, 160_000],
    },
    {
      name: "128K window",
      options: { contextWindow: 128_000 },
      expected: [96_000, 108_800, 117_760],
    },
    {
      name: "200K window",
      options: { contextWindow: 200_000 },
      expected: [100_000, 140_000, 160_000],
    },
    {
      name: "custom window and thresholds",
      options: {
        contextWindow: 100_000,
        autoThresholdTokens: 70_000,
        warnThresholdTokens: 80_000,
        emergencyThresholdTokens: 90_000,
      },
      expected: [70_000, 80_000, 90_000],
    },
  ] as const;

  for (const { name, options, expected } of cases) {
    test(`${name} resolves and applies every inclusive boundary`, () => {
      const thresholds = resolveTriggerThresholds(options);
      const [auto, warn, emergency] = expected;
      expect([
        thresholds.auto.effective,
        thresholds.warn.effective,
        thresholds.emergency.effective,
      ]).toEqual([...expected]);

      expect(shouldCompact(atTokens(auto - 1), true, options)).toBeNull();
      expect(shouldCompact(atTokens(auto), true, options)?.tier).toBe(
        Tier.Mechanical,
      );
      expect(shouldCompact(atTokens(warn - 1), true, options)?.tier).toBe(
        Tier.Mechanical,
      );
      expect(shouldCompact(atTokens(warn), true, options)?.tier).toBe(Tier.Warn);
      expect(shouldCompact(atTokens(emergency - 1), true, options)?.tier).toBe(
        Tier.Warn,
      );
      expect(shouldCompact(atTokens(emergency), true, options)?.tier).toBe(
        Tier.Mechanical,
      );
    });
  }

  test("non-default warning threshold changes the live decision", () => {
    expect(
      shouldCompact(atTokens(125_000), true, { warnThresholdTokens: 120_000 })
        ?.tier,
    ).toBe(Tier.Warn);
    expect(
      shouldCompact(atTokens(125_000), true, { warnThresholdTokens: 130_000 })
        ?.tier,
    ).toBe(Tier.Mechanical);
  });
});

describe("validateTriggerGeometry", () => {
  test("default trigger geometry has no violations", () => {
    expect(validateTriggerGeometry()).toEqual([]);
  });

  test("reports misordered absolute auto/warn/emergency thresholds", () => {
    const violations = validateTriggerGeometry({
      autoThresholdTokens: 170_000,
      warnThresholdTokens: 180_000,
      emergencyThresholdTokens: 160_000,
    });

    expect(violations.some((violation) => violation.field === "emergencyThreshold")).toBe(true);
    expect(violations.map((violation) => violation.message).join("\n")).toContain("effective emergency threshold");
  });

  test("reports misordered context-window-derived thresholds", () => {
    const violations = validateTriggerGeometry({
      contextWindow: 80_000,
      autoThresholdPct: 0.9,
      warnThresholdPct: 0.8,
      emergencyThresholdPct: 0.7,
    });

    expect(violations.some((violation) => violation.field === "warnThreshold")).toBe(true);
    expect(violations.some((violation) => violation.field === "emergencyThreshold")).toBe(true);
  });

  test("reports negative cooldown and threshold assumptions", () => {
    const violations = validateTriggerGeometry({
      cooldownMs: -1,
      contextWindow: -128_000,
      autoThresholdPct: -0.1,
    });

    expect(violations.map((violation) => violation.field)).toContain("cooldownMs");
    expect(violations.map((violation) => violation.field)).toContain("contextWindow");
    expect(violations.map((violation) => violation.field)).toContain("autoThresholdPct");
  });
});
