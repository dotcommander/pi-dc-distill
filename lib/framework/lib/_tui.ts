import {
  CURSOR_MARKER,
  type Focusable,
  type FuzzyMatch,
  fuzzyFilter,
  fuzzyMatch,
  isFocusable,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "../pi/tui";
import type { ThemeColor } from "../pi/coding-agent";
import { CLEAR_SCREEN } from "./_ansi.ts";
import { compactFooterPathLabel, formatFooterLines } from "./_tui_footer.ts";
import { truncateMiddlePath, truncateText } from "./_tui_text.ts";
import { Glyph, type GlyphName } from "./_glyphs.ts";

export type { Focusable, FuzzyMatch };
export type {
  TuiFooterChromeOptions,
  TuiFooterContextMeter,
  TuiFooterInputCursor,
  TuiFooterOptions,
} from "./_tui_footer.ts";

export type TuiTone = ThemeColor;

export type TuiVisualState =
  | "neutral"
  | "pending"
  | "running"
  | "success"
  | "warning"
  | "error"
  | "cancelled"
  | "disabled";

export interface TuiKeyHint {
  key: string;
  label: string;
  compactLabel?: string;
}

export interface TuiThemeLike {
  fg(color: string, text: string): string;
  bold?(text: string): string;
  bg?(color: string, text: string): string;
}

/**
 * Theme contract for full-screen overlay components (settings menus, command
 * palettes, questionnaires). Superset of TuiThemeLike that requires `bold`
 * (overlays always style headings/labels). `bg` stays optional.
 */
export interface OverlayTheme extends TuiThemeLike {
  bold(text: string): string;
}

export type TuiRailStatus = "running" | "success" | "error";

export type TuiMode = "tui" | "rpc" | "json" | "print";

export interface TuiCapableContext {
  mode?: TuiMode;
  hasUI?: boolean;
  ui?: unknown;
}

function contextMode(ctx: TuiCapableContext | undefined): TuiMode | undefined {
  const mode = ctx?.mode;
  return mode === "tui" || mode === "rpc" || mode === "json" || mode === "print"
    ? mode
    : undefined;
}

export interface TuiRailCallOptions {
  theme: TuiThemeLike;
  verb: string;
  arg?: string;
  status?: TuiRailStatus;
  verbColor?: string;
  inset?: string;
  maxArgChars?: number;
  /** Override the leading status dot (e.g. dotEmpty for a disabled row). */
  glyph?: GlyphName;
}

export interface TuiRailResultOptions {
  theme: TuiThemeLike;
  summary: string;
  meta?: string[];
  status?: TuiRailStatus;
}

export interface TuiRailBlockOptions {
  theme: TuiThemeLike;
  header: string;
  bodyLines: string[];
  footer: string;
  inset?: string;
  railColor?: string;
  maxBodyLines?: number;
}

export interface TuiRecordField {
  label: string;
  value: string;
  valueColor?: string;
}

export interface TuiRecordOptions {
  title: string;
  fields: TuiRecordField[];
  theme?: TuiThemeLike;
  countLabel?: string;
  labelWidth?: number;
  inset?: string;
  titleColor?: string;
  countColor?: string;
  labelColor?: string;
  valueColor?: string;
}

function statusDotColor(status: TuiRailStatus): string {
  return status === "error" ? "error" : "success";
}

function summaryColor(status: TuiRailStatus): string {
  if (status === "running") return "muted";
  if (status === "error") return "error";
  return "text";
}

const STATE_STYLE: Record<TuiVisualState, readonly [GlyphName, TuiTone]> = {
  neutral: ["dotSecondary", "muted"],
  pending: ["dotEmpty", "dim"],
  running: ["dotFilled", "accent"],
  success: ["done", "success"],
  warning: ["warning", "warning"],
  error: ["failed", "error"],
  cancelled: ["stopped", "muted"],
  disabled: ["dotEmpty", "dim"],
};

export function fitLine(
  text: string,
  width: number,
  align: "left" | "center" | "right" = "left",
): string {
  const normalizedWidth = Math.max(0, Math.floor(width));
  if (normalizedWidth === 0) return "";
  const fitted = truncateToWidth(
    text.replace(/[\r\n]+/g, " "),
    normalizedWidth,
    "…",
  );
  const remaining = Math.max(0, normalizedWidth - visibleWidth(fitted));
  if (align === "right") return `${" ".repeat(remaining)}${fitted}`;
  if (align === "center") {
    const left = Math.floor(remaining / 2);
    return `${" ".repeat(left)}${fitted}${" ".repeat(remaining - left)}`;
  }
  return `${fitted}${" ".repeat(remaining)}`;
}

export function wrapLines(
  text: string,
  width: number,
  options: { indent?: string } = {},
): string[] {
  const normalizedWidth = Number.isFinite(width)
    ? Math.max(0, Math.floor(width))
    : 0;
  if (normalizedWidth === 0) return [];

  const indent = truncateToWidth(
    options.indent ?? "",
    Math.max(0, normalizedWidth - 1),
    "",
  );
  const contentWidth = Math.max(1, normalizedWidth - visibleWidth(indent));

  return text.split(/\r?\n/).flatMap((explicitLine) => {
    const wrapped = explicitLine.length === 0
      ? [""]
      : wrapTextWithAnsi(explicitLine, contentWidth);
    return wrapped.map((line) =>
      truncateToWidth(`${indent}${line}`, normalizedWidth, "")
    );
  });
}

export function centerLine(text: string, viewportWidth: number): string {
  return fitLine(text, viewportWidth, "center");
}

export function formatStateMark(options: {
  theme: TuiThemeLike;
  state: TuiVisualState;
}): string {
  const [glyph, tone] = STATE_STYLE[options.state];
  return options.theme.fg(tone, Glyph[glyph]);
}

export function formatKeyHints(options: {
  theme: TuiThemeLike;
  hints: readonly TuiKeyHint[];
  width: number;
  separator?: string;
}): string {
  if (options.width <= 0 || options.hints.length === 0) return "";
  const separator = options.separator ?? ` ${Glyph.midDot} `;
  const render = (compact: boolean) =>
    options.hints
      .map((hint) => {
        const label = compact ? (hint.compactLabel ?? hint.label) : hint.label;
        return `${options.theme.fg("accent", hint.key)} ${options.theme.fg("muted", label)}`;
      })
      .join(options.theme.fg("dim", separator));
  const full = render(false);
  if (visibleWidth(full) <= options.width) return fitLine(full, options.width);
  const compact = render(true);
  if (visibleWidth(compact) <= options.width) return fitLine(compact, options.width);
  const keysOnly = options.hints
    .map((hint) => options.theme.fg("accent", hint.key))
    .join(options.theme.fg("dim", separator));
  if (visibleWidth(keysOnly) <= options.width) return fitLine(keysOnly, options.width);
  const essential = options.hints.length <= 3
    ? options.hints
    : [options.hints[0]!, options.hints.at(-2)!, options.hints.at(-1)!];
  return fitLine(
    essential.map((hint) => options.theme.fg("accent", hint.key)).join(" "),
    options.width,
  );
}

export function formatRailCall(options: TuiRailCallOptions): string {
  const {
    theme,
    verb,
    arg,
    status = "success",
    verbColor = "toolTitle",
    inset = "  ",
    maxArgChars = 96,
    glyph,
  } = options;
  const dot = theme.fg(statusDotColor(status), Glyph[glyph ?? "dotFilled"]);
  const label = theme.bold ? theme.bold(verb) : verb;
  const tool = theme.fg(verbColor, label);
  const argText = arg
    ? ` ${theme.fg("muted", `(${truncateText(arg, maxArgChars)})`)}`
    : "";
  return `${inset}${dot} ${tool}${argText}`;
}

export function formatRailResult(options: TuiRailResultOptions): string {
  const { theme, summary, status = "success" } = options;
  const meta = (options.meta ?? []).filter((part) => part && part !== summary);
  const metaText =
    meta.length > 0 ? ` ${theme.fg("muted", `· ${meta.join(" · ")}`)}` : "";
  return `${theme.fg(summaryColor(status), summary)}${metaText}`;
}

export function formatRailBlock(options: TuiRailBlockOptions): string {
  const {
    theme,
    header,
    footer,
    inset = "  ",
    railColor = "success",
    maxBodyLines = 80,
  } = options;
  const rail = (glyph: string) => `${inset}${theme.fg(railColor, glyph)}`;
  const shown = options.bodyLines.slice(0, maxBodyLines);
  return [
    `${rail(Glyph.railTop)} ${header}`,
    ...shown.map((line) => `${rail(Glyph.railMid)} ${line}`),
    `${rail(Glyph.railBottom)} ${footer}`,
  ].join("\n");
}

/**
 * Titled horizontal rule: `─ Title ─────…` padded to `width` with Glyph.divider.
 * The title is colored with `tone` (default "accent"); the rule glyphs use
 * "muted". A short lead segment precedes the title so it reads as a section
 * break, not a bare label.
 */
export function formatDivider(
  title: string,
  width: number,
  theme: TuiThemeLike,
  tone = "accent",
): string {
  const normalizedWidth = Number.isFinite(width)
    ? Math.max(0, Math.floor(width))
    : 0;
  if (normalizedWidth === 0) return "";
  const lead = Glyph.divider;
  const leadWidth = visibleWidth(lead);
  if (normalizedWidth <= leadWidth) {
    return theme.fg("muted", truncateToWidth(lead, normalizedWidth, ""));
  }
  if (normalizedWidth === leadWidth + 1) {
    return `${theme.fg("muted", lead)} `;
  }
  const fittedTitle = truncateToWidth(
    title,
    Math.max(0, normalizedWidth - leadWidth - 2),
    "…",
  );
  const fillCount = Math.max(
    0,
    normalizedWidth - leadWidth - visibleWidth(fittedTitle) - 2,
  );
  const fill = Glyph.divider.repeat(fillCount);
  return `${theme.fg("muted", lead)} ${theme.fg(tone, fittedTitle)} ${theme.fg("muted", fill)}`;
}

function recordCountLabel(count: number): string {
  return `${count} field${count === 1 ? "" : "s"}`;
}

export function formatRecordPlain(options: TuiRecordOptions): string {
  const { title, fields, inset = "  " } = options;
  const labelWidth =
    options.labelWidth ??
    Math.max(0, ...fields.map((field) => visibleWidth(field.label)));
  const count = options.countLabel ?? recordCountLabel(fields.length);
  const rows = fields.flatMap((field) => {
    const [first = "", ...rest] = field.value.split(/\r?\n/);
    return [
      `${inset}${field.label}${" ".repeat(Math.max(0, labelWidth - visibleWidth(field.label)))}  ${first}`,
      ...rest.map((line) => `${inset}${" ".repeat(labelWidth)}  ${line}`),
    ];
  });
  return [`${title}  ${count}`, ...rows].join("\n");
}

export function formatRecord(
  options: TuiRecordOptions & { theme: TuiThemeLike },
): string {
  const {
    theme,
    title,
    fields,
    inset = "  ",
    titleColor = "accent",
    countColor = "dim",
    labelColor = "accent",
    valueColor = "text",
  } = options;
  const labelWidth =
    options.labelWidth ??
    Math.max(0, ...fields.map((field) => visibleWidth(field.label)));
  const count = options.countLabel ?? recordCountLabel(fields.length);
  const titleText = theme.bold ? theme.bold(title) : title;
  const rows = fields.flatMap((field) => {
    const color = field.valueColor ?? valueColor;
    const [first = "", ...rest] = field.value.split(/\r?\n/);
    const label = `${field.label}${" ".repeat(Math.max(0, labelWidth - visibleWidth(field.label)))}`;
    return [
      `${inset}${theme.fg(labelColor, label)}  ${theme.fg(color, first)}`,
      ...rest.map(
        (line) => `${inset}${" ".repeat(labelWidth)}  ${theme.fg(color, line)}`,
      ),
    ];
  });
  return [
    `${theme.fg(titleColor, titleText)}  ${theme.fg(countColor, count)}`,
    ...rows,
  ].join("\n");
}

/**
 * Clear the terminal screen and move the cursor home.
 *
 * Use during full-screen state transitions where the host TUI has been
 * stopped (e.g. `tui.stop()`) and a foreign program (tmux attach, less, vim,
 * git pager) is about to take over the terminal. After the foreign program
 * exits and the TUI is restarted, the framework redraws cleanly.
 *
 * Synchronous write to stdout — safe to call from any context. No-op when
 * stdout is not a terminal (non-TTY writes still emit the escape, but most
 * pagers/pipelines ignore CSI control sequences harmlessly).
 */
export function clearScreen(): void {
  process.stdout.write(CLEAR_SCREEN);
}

/** Read the current terminal width without caching mutable process state. */
export function terminalWidth(fallback = 80): number {
  const columns = Math.floor(process.stdout.columns ?? 0);
  if (Number.isFinite(columns) && columns > 0) return columns;
  const normalizedFallback = Math.floor(fallback);
  if (Number.isFinite(normalizedFallback) && normalizedFallback > 0) {
    return normalizedFallback;
  }
  return 80;
}

export const Tui = {
  isTui(ctx: TuiCapableContext | undefined): boolean {
    const mode = contextMode(ctx);
    return mode === undefined ? ctx?.hasUI === true : mode === "tui";
  },
  truncateMiddlePath,
  compactFooterPathLabel,
  formatRailCall,
  formatRailResult,
  formatRailBlock,
  formatDivider,
  formatRecord,
  formatRecordPlain,
  formatFooterLines,
  fitLine,
  centerLine,
  formatStateMark,
  formatKeyHints,
  wrapLines,
  fuzzyMatch,
  fuzzyFilter,
  isFocusable,
  terminalWidth,
  clearScreen,
  CURSOR_MARKER,
};
