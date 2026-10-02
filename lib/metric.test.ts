import { describe, test, expect } from "bun:test";
import { buildMetricLine } from "./metric.ts";

describe("buildMetricLine", () => {
  test("shows pi estimate when no API count", () => {
    const line = buildMetricLine(0, 100_000, 40_000);
    expect(line).toBe("100,000 est → 40,000 tokens (60% reduction)");
  });

  test("keeps Pi estimate primary when nearby API usage is available", () => {
    const line = buildMetricLine(95_000, 100_000, 40_000);
    expect(line).toBe("100,000 est → 40,000 tokens (60% reduction)");
  });

  test("shows both counts when they diverge >50%", () => {
    const line = buildMetricLine(30_000, 100_000, 40_000);
    expect(line).toBe("100,000 est → 40,000 tokens (60% reduction) (API before: 30,000)");
  });

  test("does not show both when divergence is <=50%", () => {
    // 60k vs 100k is 40% divergence — below threshold
    const line = buildMetricLine(60_000, 100_000, 40_000);
    expect(line).toBe("100,000 est → 40,000 tokens (60% reduction)");
  });

  for (const apiCount of [50_000, 150_000]) {
    test(`omits API annotation at exactly 50% divergence (${apiCount})`, () => {
      expect(buildMetricLine(apiCount, 100_000, 40_000)).toBe(
        "100,000 est → 40,000 tokens (60% reduction)",
      );
    });
  }

  for (const apiCount of [49_999, 150_001]) {
    test(`annotates API usage just above 50% divergence (${apiCount})`, () => {
      expect(buildMetricLine(apiCount, 100_000, 40_000)).toBe(
        `100,000 est → 40,000 tokens (60% reduction) (API before: ${apiCount.toLocaleString()})`,
      );
    });
  }

  test("handles zero tokensBefore without division by zero", () => {
    const line = buildMetricLine(0, 0, 0);
    expect(line).toBe("0 est → 0 tokens (0% reduction)");
  });

  test("keeps zero preparation count primary with positive API usage", () => {
    expect(buildMetricLine(30_000, 0, 40_000)).toBe(
      "0 est → 40,000 tokens (0% reduction) (API before: 30,000)",
    );
  });

  test("shows negative reduction from the preparation estimate", () => {
    expect(buildMetricLine(95_000, 100_000, 120_000)).toBe(
      "100,000 est → 120,000 tokens (-20% reduction)",
    );
  });

  test("formats numbers with locale separators", () => {
    const line = buildMetricLine(0, 1_234_567, 500_000);
    expect(line).toContain("1,234,567");
    expect(line).toContain("500,000");
  });

  test("rounds reduction percentage", () => {
    // 100k → 33k = 67% exactly, but 100k → 34k = 66%
    const line = buildMetricLine(0, 100_000, 33_333);
    expect(line).toContain("67% reduction");
  });
});
