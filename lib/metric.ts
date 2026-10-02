import { formatInteger } from "./wire-format.ts";
/**
 * Compaction metric line — human-readable before→after token summary.
 *
 * Extracted from index.ts for testability. Pure function, no side effects.
 */

/**
 * Build a human-readable metric line showing token reduction.
 *
 * Uses Pi's preparation estimate for both the before-count and reduction.
 * Adds API usage separately when the counts diverge by more than 50%.
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

  const metric = `${formatInteger(tokensBefore)} est → ${formatInteger(tokensAfter)} tokens (${reductionPct}% reduction)`;
  return shouldShowBothCounts(apiTokenCount, tokensBefore)
    ? `${metric} (API before: ${formatInteger(apiTokenCount)})`
    : metric;
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
