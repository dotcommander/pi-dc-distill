/**
 * TUI — opt-in terminal rendering primitives for shared rail/footer chrome.
 *
 * @module dc-framework/x/tui
 */

export { Tui } from "../lib/_tui.ts";
export type {
  Focusable,
  FuzzyMatch,
  TuiFooterContextMeter,
  TuiFooterInputCursor,
  TuiFooterChromeOptions,
  TuiFooterOptions,
  TuiRailBlockOptions,
  TuiRailCallOptions,
  TuiRailResultOptions,
  TuiRailStatus,
  TuiRecordField,
  TuiRecordOptions,
  TuiCapableContext,
  TuiMode,
  TuiThemeLike,
  OverlayTheme,
  TuiTone,
  TuiVisualState,
  TuiKeyHint,
} from "../lib/_tui.ts";

// Width-aware string primitives — re-exported from pi-tui to provide a single
// dc-framework chokepoint over the underlying SDK surface.
export {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "../pi/tui.ts";
