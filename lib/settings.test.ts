import { describe, expect, test } from "bun:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_PI_COMPACTION_SETTINGS,
  DEFAULT_DISTILL_FEATURE_SETTINGS,
  mergeDistillFeatureSettings,
  normalizeDistillFeatureSettings,
  dumpsEnabled,
  resolvePiCompactionSettings,
  resolveDistillFeatureSettings,
} from "./settings.ts";

describe("Pi compaction settings", () => {
  const model = { provider: "fake", id: "scripted" };
  test("matches Pi defaults, zero, and model override precedence", () => {
    for (const compaction of [undefined, {}, { reserveTokens: 0 },
      { enabled: false, reserveTokens: 24000 },
      { reserveTokens: 24000, modelOverrides: { "fake/scripted": { reserveTokens: 50000 } } },
      { modelOverrides: { "other/model": { reserveTokens: -1 } } }]) {
      const settings = { compaction };
      const host = SettingsManager.inMemory(settings as any).getCompactionSettings(model);
      expect(resolvePiCompactionSettings(settings, model)).toEqual({
        enabled: host.enabled, reserveTokens: host.reserveTokens,
      });
    }
    expect(resolvePiCompactionSettings({})).toEqual(DEFAULT_PI_COMPACTION_SETTINGS);
  });

  test("rejects the same malformed token values as Pi, even under an override", () => {
    for (const compaction of [
      { reserveTokens: -1 }, { reserveTokens: 1.5 }, { reserveTokens: "24000" },
      { reserveTokens: Number.MAX_SAFE_INTEGER + 1 }, { keepRecentTokens: -1 },
      { reserveTokens: -1, modelOverrides: { "fake/scripted": { reserveTokens: 24000 } } },
      { modelOverrides: { "fake/scripted": [] } },
      { modelOverrides: { "fake/scripted": { reserveTokens: null } } },
      { modelOverrides: { "fake/scripted": { keepRecentTokens: -1 } } },
    ]) {
      expect(() => SettingsManager.inMemory({ compaction } as any).getCompactionSettings(model)).toThrow();
      expect(() => resolvePiCompactionSettings({ compaction }, model)).toThrow();
    }
    expect(() => resolvePiCompactionSettings({ compaction: { enabled: "false" } })).toThrow();
  });

  test("enables raw dumps only through the explicit environment switch", () => {
    expect(dumpsEnabled({})).toBe(false);
    expect(dumpsEnabled({ DC_DISTILL_DUMPS: "1" })).toBe(true);
    expect(dumpsEnabled({ DC_DISTILL_DUMPS: "TRUE" })).toBe(true);
    expect(dumpsEnabled({ DC_DISTILL_DUMPS: "no" })).toBe(false);
  });
});


describe("optional distill feature settings", () => {
  const file = (features: unknown) => ({ extensionConfig: { "dc-distill": features } });

  test("defaults both features off", () => {
    expect(mergeDistillFeatureSettings({}, { extensionConfig: {} })).toEqual(DEFAULT_DISTILL_FEATURE_SETTINGS);
    expect(normalizeDistillFeatureSettings(null)).toEqual({
      toolOutput: { enabled: false }, recall: { enabled: false },
    });
  });

  test("enables each feature independently with explicit booleans", () => {
    expect(mergeDistillFeatureSettings(file({ toolOutput: { enabled: true } }))).toEqual({
      toolOutput: { enabled: true }, recall: { enabled: false },
    });
    expect(mergeDistillFeatureSettings(file({ recall: { enabled: true } }))).toEqual({
      toolOutput: { enabled: false }, recall: { enabled: true },
    });
  });

  test("merges global and project per feature leaf and preserves explicit false", () => {
    expect(mergeDistillFeatureSettings(
      file({ toolOutput: { enabled: true }, recall: { enabled: true } }),
      file({ recall: { enabled: false } }),
    )).toEqual({ toolOutput: { enabled: true }, recall: { enabled: false } });
    expect(mergeDistillFeatureSettings(
      file({ toolOutput: { enabled: true } }), file({ recall: { enabled: true } }),
    )).toEqual({ toolOutput: { enabled: true }, recall: { enabled: true } });
  });

  test("malformed booleans inherit prior leaves without enabling defaults", () => {
    for (const enabled of ["true", 1, null, [], {}]) {
      expect(mergeDistillFeatureSettings(file({ toolOutput: { enabled }, recall: { enabled } })))
        .toEqual(DEFAULT_DISTILL_FEATURE_SETTINGS);
      expect(mergeDistillFeatureSettings(
        file({ toolOutput: { enabled: true }, recall: { enabled: false } }),
        file({ toolOutput: { enabled }, recall: { enabled } }),
      )).toEqual({ toolOutput: { enabled: true }, recall: { enabled: false } });
    }
  });

  test("reads optional gates from the host merged snapshot", () => {
    const host = SettingsManager.inMemory(file({ toolOutput: { enabled: true }, recall: { enabled: false } }) as any);
    expect(resolveDistillFeatureSettings(host.getSettings())).toEqual({
      toolOutput: { enabled: true }, recall: { enabled: false },
    });
  });
});
