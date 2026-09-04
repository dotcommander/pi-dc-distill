// Tests for dc-shrink/lib/settings.ts
// Run: bun test extensions/dc-app/lib/knowledge/features/shrink/lib/settings.test.ts

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SHRINK_SETTINGS,
  mergeShrinkSettings,
  normalizeShrinkSettings,
} from "./settings.ts";

describe("normalizeShrinkSettings", () => {
  test("uses defaults for missing settings", () => {
    expect(normalizeShrinkSettings({})).toEqual(DEFAULT_SHRINK_SETTINGS);
  });

  test("accepts valid values", () => {
    expect(
      normalizeShrinkSettings({
        cacheTtlMs: 300_000,
        autoThresholdTokens: 160_000,
        warnThresholdTokens: 200_000,
        emergencyThresholdTokens: 300_000,
        autoThresholdPct: 0.8,
        warnThresholdPct: 0.85,
        emergencyThresholdPct: 0.95,
        dumpCompactions: false,
        dumpRetention: 5,
      }),
    ).toEqual({
      cacheTtlMs: 300_000,
      autoThresholdTokens: 160_000,
      warnThresholdTokens: 200_000,
      emergencyThresholdTokens: 300_000,
      autoThresholdPct: 0.8,
      warnThresholdPct: 0.85,
      emergencyThresholdPct: 0.95,
      dumpCompactions: false,
      dumpRetention: 5,
    });
  });

  test("normalizes invalid values", () => {
    expect(
      normalizeShrinkSettings({
        cacheTtlMs: -1,
        autoThresholdTokens: 999_999,
        warnThresholdTokens: -1,
        emergencyThresholdTokens: -1,
        autoThresholdPct: 9,
        emergencyThresholdPct: -1,
        dumpCompactions: "no",
        dumpRetention: 999_999,
      }),
    ).toEqual({
      cacheTtlMs: 10_000,
      autoThresholdTokens: 160_000,
      warnThresholdTokens: 161_000,
      emergencyThresholdTokens: 162_000,
      autoThresholdPct: 0.95,
      warnThresholdPct: 0.96,
      emergencyThresholdPct: 0.97,
      dumpCompactions: false,
      dumpRetention: 500,
    });
  });

  test("merges extension config and data settings in order", () => {
    expect(
      mergeShrinkSettings(
        { cacheTtlMs: 300_000, autoThresholdTokens: 160_000 },
        { dumpCompactions: false },
      ),
    ).toEqual({
      cacheTtlMs: 300_000,
      autoThresholdTokens: 160_000,
      warnThresholdTokens: 161_000,
      emergencyThresholdTokens: 162_000,
      autoThresholdPct: 0.75,
      warnThresholdPct: 0.85,
      emergencyThresholdPct: 0.92,
      dumpCompactions: false,
      dumpRetention: 20,
    });
  });

  test("forces emergency pct strictly above auto pct", () => {
    const s = normalizeShrinkSettings({
      autoThresholdPct: 0.9,
      emergencyThresholdPct: 0.7, // below auto — must be lifted
    });
    expect(s.autoThresholdPct).toBe(0.9);
    expect(s.emergencyThresholdPct).toBeGreaterThan(s.autoThresholdPct);
  });

  test("normalizes absolute thresholds into ordered bands", () => {
    const settings = normalizeShrinkSettings({
      autoThresholdTokens: 160_000,
      warnThresholdTokens: 11_000,
      emergencyThresholdTokens: 12_000,
    });

    expect(settings.autoThresholdTokens).toBe(160_000);
    expect(settings.warnThresholdTokens).toBe(161_000);
    expect(settings.emergencyThresholdTokens).toBe(162_000);
  });

  test("preserves explicit dump opt-in while defaulting dumps off", () => {
    expect(DEFAULT_SHRINK_SETTINGS.dumpCompactions).toBe(false);
    expect(
      normalizeShrinkSettings({ dumpCompactions: true }).dumpCompactions,
    ).toBe(true);
  });

  test("clamps warn pct into [auto, emergency) band", () => {
    // warn below auto is lifted to auto
    const lifted = normalizeShrinkSettings({
      autoThresholdPct: 0.8,
      warnThresholdPct: 0.6,
    });
    expect(lifted.warnThresholdPct).toBeCloseTo(0.81);
    expect(lifted.emergencyThresholdPct).toBeGreaterThan(lifted.warnThresholdPct);

    // emergency is forced strictly above the resolved warn pct
    const high = normalizeShrinkSettings({
      warnThresholdPct: 0.9,
      emergencyThresholdPct: 0.7, // below warn — must be lifted
    });
    expect(high.warnThresholdPct).toBe(0.9);
    expect(high.emergencyThresholdPct).toBeGreaterThan(high.warnThresholdPct);
  });
});
