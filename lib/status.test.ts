import { describe, expect, test } from "bun:test";
import { formatShrinkStatus } from "./status.ts";
import type { CompactState } from "./types.ts";

const state = (overrides: Partial<CompactState> = {}): CompactState => ({
  tokenEstimate: 101_000,
  toolTokens: 25_000,
  lastUserMessageTime: 1_000,
  lastCompactionTime: 10_000,
  repeatBaselineTokens: null,
  awaitingPostCompactionSample: false,
  callCount: 7,
  exchangeCount: 2,
  compactionCount: 1,
  apiTokenCount: 99_000,
  ...overrides,
});

const pi = {
  enabled: true,
  reserveTokens: 16_384,
};

describe("formatShrinkStatus", () => {
  test("formats Pi-derived thresholds and fixed dump policy", () => {
    const text = formatShrinkStatus({
      state: state(),
      inFlight: false,
      warmupTurnsRemaining: 0,
      hasPiSynced: true,
      pendingMetric: "99,000 -> 12,000 tokens",
      lastEcho: null,
      compaction: pi,
      dumpEnabled: true,
      compactorAvailable: true,
      contextWindow: 128_000,
      now: 200_000,
    });

    expect(text).toContain("101,000 estimated (pi-synced)");
    expect(text).toContain("Pi auto-compaction: enabled");
    expect(text).toContain("Configured cooldown: 120s fixed");
    expect(text).toContain("Auto threshold: 91,616 tokens (Pi trigger: 128,000 window − 16,384 reserve − fixed 20,000 lead)");
    expect(text).toContain("Warn threshold: 111,616 tokens (Pi: 128,000 window − 16,384 reserve)");
    expect(text).toContain("Emergency threshold: 128,000 tokens (Pi context window)");
    expect(text).toContain("Dumps: enabled, retaining 20");
    expect(text).toContain("Pending metric: 99,000 -> 12,000 tokens");
  });

  test("shows the fixed 120k target when larger Pi geometry permits it", () => {
    const text = formatShrinkStatus({
      state: state(),
      inFlight: false,
      warmupTurnsRemaining: 0,
      hasPiSynced: true,
      pendingMetric: null,
      lastEcho: null,
      compaction: { enabled: true, reserveTokens: 50_000 },
      dumpEnabled: false,
      compactorAvailable: true,
      contextWindow: 272_000,
      now: 200_000,
    });

    expect(text).toContain("Auto threshold: 120,000 tokens (fixed 120,000 target; Pi trigger: 272,000 window − 50,000 reserve − fixed 20,000 lead)");
    expect(text).toContain("Warn threshold: 222,000 tokens");
  });

  test("shows fallback geometry and Pi stand-down state", () => {
    const text = formatShrinkStatus({
      state: state({ lastCompactionTime: 100_000, apiTokenCount: 0 }),
      inFlight: true,
      warmupTurnsRemaining: 1,
      hasPiSynced: false,
      pendingMetric: null,
      lastEcho: "<shrink-focus-echo>\nResume index:\n- Continue",
      compaction: { ...pi, enabled: false },
      dumpEnabled: false,
      compactorAvailable: false,
      lastFailure: "session file unavailable",
      now: 120_000,
    });

    expect(text).toContain("101,000 estimated (local estimate)");
    expect(text).toContain("Cooldown: 100s remaining");
    expect(text).toContain("Pi auto-compaction: disabled (dc-shrink monitor standing down)");
    expect(text).toContain("Auto threshold: 100,000 tokens (fallback; Pi context window unavailable)");
    expect(text).toContain("Warn threshold: 140,000 tokens (fallback; Pi context window unavailable)");
    expect(text).toContain("Emergency threshold: 160,000 tokens (fallback; Pi context window unavailable)");
    expect(text).toContain("Dumps: disabled (set DC_SHRINK_DUMPS=1)");
    expect(text).toContain("Last failure: session file unavailable");
  });
});
