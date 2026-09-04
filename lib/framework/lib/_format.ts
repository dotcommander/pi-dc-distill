// Merged from three sources (2026-05-08):
//   dc-taskagents/index.ts fmtMs/fmtTokens: 3 duration cases (ms/s/m), " token" suffix, 2 token thresholds.
//   dc-taskagents/lib/widget.ts formatMs/formatTokens: identical to above (intra-extension dup).
//   dc-spinner/index.ts formatDuration/formatTokens: 4 duration cases (s/m:ss/h:mm), no ms bucket; 4 token
//   thresholds, no suffix, Math.round for large values. dc-spinner is the superset — chosen as canonical shape.
//   S1.2/S1.3 will migrate dc-taskagents callers that depended on the " token" suffix.

export const Fmt = {
  /**
   * Human-readable duration. Covers ms through hours.
   * <60s → "34s" | <60m → "2m 05s" | ≥60m → "1h 02m" | <1s → "123ms"
   */
  duration(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const totalSeconds = Math.floor(ms / 1000);
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${String(remainingMinutes).padStart(2, "0")}m`;
  },

  /**
   * Compact duration for tool-row display: sub-second in ms, <10s with one
   * decimal, otherwise whole seconds (never rolls up to minutes/hours).
   * 0.4s → "400ms" | 5.3s → "5.3s" | 45s → "45s"
   */
  durationShort(ms: number): string {
    if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
    if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.round(ms / 1000)}s`;
  },

  /**
   * Human-readable token count. No suffix — callers compose labels themselves.
   * <1k → "742" | <10k → "3.4k" | <1M → "12k" | <10M → "1.2M" | ≥10M → "12M"
   */
  tokens(n: number): string {
    if (n < 1000) return n.toString();
    if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
    if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
    if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    return `${Math.round(n / 1_000_000)}M`;
  },

  /**
   * XML-escape for safe interpolation into element text AND attribute values.
   * Escapes & < > " ' (attribute-safe superset of element-text-only escapers).
   */
  escapeXml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  },
} as const;
