// Tests for dc-shrink/lib/status.ts
// Run: bun test extensions/dc-app/lib/knowledge/features/shrink/lib/status.test.ts

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

describe("formatShrinkStatus", () => {
  test("formats current monitor state and log paths", () => {
    const text = formatShrinkStatus({
      state: state(),
      inFlight: false,
      warmupTurnsRemaining: 0,
      hasPiSynced: true,
      pendingMetric: "99,000 -> 12,000 tokens",
      lastEcho: null,
      settings: {
        cacheTtlMs: 120_000,
        autoThresholdTokens: 100_000,
        warnThresholdTokens: 140_000,
        emergencyThresholdTokens: 160_000,
        autoThresholdPct: 0.75,
        warnThresholdPct: 0.85,
        emergencyThresholdPct: 0.92,
        dumpCompactions: true,
        dumpRetention: 20,
      },
      compactorAvailable: true,
      contextWindow: 128_000,
      now: 200_000,
    });

    expect(text).toContain("shrink status");
    expect(text).toContain("101,000 estimated (pi-synced)");
    expect(text).toContain("Cooldown: ready");
    expect(text).toContain("Configured cooldown: 120s");
    expect(text).toContain(
      "Auto threshold: 96,000 tokens (percentage; absolute 100,000, 75% of 128,000 = 96,000)",
    );
    expect(text).toContain(
      "Warn threshold: 108,800 tokens (percentage; absolute 140,000, 85% of 128,000 = 108,800)",
    );
    expect(text).toContain(
      "Emergency threshold: 117,760 tokens (percentage; absolute 160,000, 92% of 128,000 = 117,760)",
    );
    expect(text).toContain("Compactor: local TypeScript");
    expect(text).toContain("Dumps: enabled, retaining 20");
    expect(text).toContain("Pending metric: 99,000 -> 12,000 tokens");
    expect(text).toContain("compact-log.jsonl");
  });

  test("shows local estimate and cooldown when not synced", () => {
    const text = formatShrinkStatus({
      state: state({ lastCompactionTime: 100_000, apiTokenCount: 0 }),
      inFlight: true,
      warmupTurnsRemaining: 1,
      hasPiSynced: false,
      pendingMetric: null,
      lastEcho: "<shrink-focus-echo>\nResume index:\n- Continue",
      settings: {
        cacheTtlMs: 300_000,
        autoThresholdTokens: 160_000,
        warnThresholdTokens: 200_000,
        emergencyThresholdTokens: 300_000,
        autoThresholdPct: 0.75,
        warnThresholdPct: 0.85,
        emergencyThresholdPct: 0.92,
        dumpCompactions: false,
        dumpRetention: 0,
      },
      compactorAvailable: false,
      lastFailure: "session file unavailable",
      now: 120_000,
    });

    expect(text).toContain("101,000 estimated (local estimate)");
    expect(text).toContain("API tokens: unknown");
    expect(text).toContain("Cooldown: 280s remaining");
    expect(text).toContain(
      "Auto threshold: 160,000 tokens (absolute 160,000; 75% source unavailable without context window)",
    );
    expect(text).toContain(
      "Warn threshold: 200,000 tokens (absolute 200,000; 85% source unavailable without context window)",
    );
    expect(text).toContain(
      "Emergency threshold: 300,000 tokens (absolute 300,000; 92% source unavailable without context window)",
    );
    expect(text).toContain("Compactor: unavailable");
    expect(text).toContain("Dumps: disabled");
    expect(text).toContain("Last failure: session file unavailable");
    expect(text).toContain("In flight: yes");
    expect(text).toContain("Last focus echo:");
  });
});
