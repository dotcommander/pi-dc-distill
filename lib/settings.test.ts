import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PI_COMPACTION_SETTINGS,
  dumpsEnabled,
  mergePiCompactionSettings,
  normalizePiCompactionSettings,
} from "./settings.ts";

describe("Pi compaction settings", () => {
  test("uses Pi defaults for missing values", () => {
    expect(normalizePiCompactionSettings({})).toEqual(DEFAULT_PI_COMPACTION_SETTINGS);
  });

  test("preserves Pi's effective compaction values", () => {
    expect(normalizePiCompactionSettings({
      enabled: false,
      reserveTokens: 24_000.4,
    })).toEqual({
      enabled: false,
      reserveTokens: 24_000,
    });
  });

  test("uses the prior setting for malformed values", () => {
    expect(normalizePiCompactionSettings({
      enabled: "no",
      reserveTokens: -1,
    }, {
      enabled: false,
      reserveTokens: 12_000,
    })).toEqual({
      enabled: false,
      reserveTokens: 1,
    });
  });

  test("deep-merges global and project compaction settings like Pi", () => {
    expect(mergePiCompactionSettings(
      { compaction: { enabled: false, reserveTokens: 24_000 } },
      { compaction: { enabled: true } },
    )).toEqual({
      enabled: true,
      reserveTokens: 24_000,
    });
  });

  test("enables raw dumps only through the explicit environment switch", () => {
    expect(dumpsEnabled({})).toBe(false);
    expect(dumpsEnabled({ DC_SHRINK_DUMPS: "1" })).toBe(true);
    expect(dumpsEnabled({ DC_SHRINK_DUMPS: "TRUE" })).toBe(true);
    expect(dumpsEnabled({ DC_SHRINK_DUMPS: "no" })).toBe(false);
  });
});
