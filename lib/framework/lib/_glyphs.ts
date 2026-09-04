/**
 * Glyph — single source of truth for terminal glyphs used across dc-framework
 * renderers and dc-app features. These are the raw characters only; color is
 * applied by the caller via `theme.fg(semanticToken, Glyph.x)`. Add new glyphs
 * here rather than inlining literals at call sites so the look stays consistent.
 *
 * Private module — consume via `dc-framework/x/glyphs`.
 */
export const Glyph = {
  // Status marks
  done: "✓",
  failed: "✗",
  warning: "⚠",
  stopped: "■",
  // Status dots: filled = active/current, empty = pending/inactive, secondary = muted
  dotFilled: "●",
  dotEmpty: "○",
  dotSecondary: "◦",
  // Running / in-flight
  hourglass: "⏳",
  // Inline punctuation / separators
  midDot: "·",
  bullet: "•",
  ellipsis: "…",
  arrow: "→",
  arrowLoop: "↻",
  scale: "⚖",
  // Rail / box drawing
  railTop: "╭",
  railMid: "│",
  railBottom: "╰",
  treeBranch: "├",
  treeLast: "└",
  outputBranch: "┆",
  divider: "─",
  // Context / progress bars
  barFilled: "━",
  barEmpty: "─",
  // Section / phase marker
  section: "▸",
  // Cursors
  cursorBlock: "█",
  cursorThin: "▏",
  // Prompt glyphs
  promptPi: "π",
  promptInput: "›",
  // Diff markers
  diffAdd: "+",
  diffRemove: "−",
} as const;

export type GlyphName = keyof typeof Glyph;
