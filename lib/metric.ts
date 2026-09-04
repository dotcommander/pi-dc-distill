/**
 * Compaction metric line — human-readable before→after token summary.
 *
 * Extracted from index.ts for testability. Pure function, no side effects.
 */

/**
 * Build a human-readable metric line showing token reduction.
 *
 * Prioritizes API-reported count when available; shows both API and
 * estimated counts when they diverge significantly (>50% difference).
 */
export function buildMetricLine(
  apiTokenCount: number,
  tokensBefore: number,
  tokensAfter: number,
): string {
  const reductionPct =
    tokensBefore > 0
      ? Math.round(((tokensBefore - tokensAfter) / tokensBefore) * 100)
      : 0;

  if (shouldShowBothCounts(apiTokenCount, tokensBefore)) {
    return `${apiTokenCount.toLocaleString()} API / ${tokensBefore.toLocaleString()} est → ${tokensAfter.toLocaleString()} tokens (${reductionPct}% reduction)`;
  }

  const effectiveBefore = apiTokenCount || tokensBefore;
  return `${effectiveBefore.toLocaleString()} → ${tokensAfter.toLocaleString()} tokens (${reductionPct}% reduction)`;
}

function shouldShowBothCounts(
  apiTokenCount: number,
  tokensBefore: number,
): boolean {
  return (
    apiTokenCount > 0 &&
    Math.abs(apiTokenCount - tokensBefore) > tokensBefore * 0.5
  );
}
