/** Named resource and layout limits for the transcript Mermaid renderer. */
export const MERMAID_LIMITS = {
  maxNodes: 128,
  maxEdges: 512,
  maxSourceChars: 64 * 1024,
  maxFallbackSourceChars: 8 * 1024,
  maxCanvasCells: 1 << 18,
  maxLabelWidth: 24,
  rankGap: 4,
  nodeGap: 3,
  barycenterSweeps: 8,
  coordinateSweeps: 10,
} as const;
