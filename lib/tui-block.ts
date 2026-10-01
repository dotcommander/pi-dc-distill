/**
 * TUI block spec surface — owned port of the consumed dc-framework
 * `x/output.ts` / `lib/output-block.ts` / `_tui.ts` formatter subset.
 *
 * One capability: turning BlockSpec values into styled strings and renderable
 * Pi TUI components for the spec kinds this product emits (record / rail /
 * banner / stack / markdown / divider). The framework's image / mermaid /
 * raw kinds, `emit`/`emitCustom`, and its Notify fake/sink machinery are not
 * consumed and not ported. Message-renderer registration (the framework's
 * `Block.registerSpec`) lives in `lib/notify-support.ts` as
 * `registerBlockSpec`, next to the other host-channel wiring.
 *
 * Layout byte-ports the framework sources: record/rail/banner/divider layout,
 * glyph table, state styling, and width fitting.
 *
 * @module lib/tui-block
 */

import {
  Container,
  Markdown,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";

export const Glyph = {
  done: "✓",
  failed: "✗",
  warning: "⚠",
  stopped: "■",
  dotFilled: "●",
  dotEmpty: "○",
  dotSecondary: "◦",
  midDot: "·",
  arrow: "→",
  arrowLoop: "↻",
  railTop: "╭",
  railMid: "│",
  railBottom: "╰",
  divider: "─",
  section: "▸",
} as const;

export type GlyphName = keyof typeof Glyph;

export interface BlockField {
  label: string;
  value: string;
  tone?: string;
  /** Optional left-indent (spaces) for nested/two-tier rows. */
  indent?: number;
}

export type TuiVisualState =
  | "neutral"
  | "pending"
  | "running"
  | "success"
  | "warning"
  | "error"
  | "cancelled"
  | "disabled";

export interface TuiThemeLike {
  fg(color: string, text: string): string;
  bold?(text: string): string;
  bg?(color: string, text: string): string;
}

/** Shared chrome present on block shapes. */
interface BlockBase {
  glyph?: GlyphName;
  title: string;
  tone?: string;
  state?: TuiVisualState;
}

/** Titled label/value rows under a gutter glyph. */
export interface RecordBlock extends BlockBase {
  kind?: "record";
  fields?: BlockField[];
  /** Carried for back-compat; not consumed by the record renderer. */
  summary?: string;
  body?: string[];
}

/** One-line rail row: `<glyph> verb (arg) → summary · meta`. */
export interface RailBlock extends BlockBase {
  kind: "rail";
  /** Call argument rendered as `(arg)` after the verb. */
  arg?: string;
  summary?: string;
  /** Footer meta parts joined with `·` after the summary. */
  meta?: string[];
}

/** Title line + body lines under the gutter. */
export interface BannerBlock extends BlockBase {
  kind: "banner";
  body?: string[];
}

/** Full-width titled horizontal rule: `─ Title ─────…`. */
export interface DividerBlock {
  kind: "divider";
  title: string;
  tone?: string;
  width?: number;
}

/** Markdown body — Block.node returns a `Markdown` component. */
export interface MarkdownBlock {
  kind: "markdown";
  content: string;
  expandable?: boolean;
}

/** Composite — Block.node returns a `Container` wrapping each child's node. */
export interface StackBlock {
  kind: "stack";
  children: BlockSpec[];
}

export type BlockSpec =
  | RecordBlock
  | RailBlock
  | BannerBlock
  | DividerBlock
  | MarkdownBlock
  | StackBlock;

// ── Tui formatter subset (byte-ports from `_tui.ts`) ─────────────────────

type TuiTone = string;

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

function fitLine(
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

function formatStateMark(options: {
  theme: TuiThemeLike;
  state: TuiVisualState;
}): string {
  const [glyph, tone] = STATE_STYLE[options.state];
  return options.theme.fg(tone, Glyph[glyph]);
}

interface TuiRecordField {
  label: string;
  value: string;
  valueColor?: string;
}

function recordCountLabel(count: number): string {
  return `${count} field${count === 1 ? "" : "s"}`;
}

function formatRecord(
  options: {
    title: string;
    fields: TuiRecordField[];
    countLabel?: string;
    labelWidth?: number;
    inset?: string;
    titleColor?: string;
    countColor?: string;
    labelColor?: string;
    valueColor?: string;
  } & { theme: TuiThemeLike },
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

type TuiRailStatus = "running" | "success" | "error";

function summaryColor(status: TuiRailStatus): string {
  if (status === "running") return "muted";
  if (status === "error") return "error";
  return "text";
}

function formatRailResult(options: {
  theme: TuiThemeLike;
  summary: string;
  meta?: string[];
  status?: TuiRailStatus;
}): string {
  const { theme, summary, status = "success" } = options;
  const meta = (options.meta ?? []).filter((part) => part && part !== summary);
  const metaText =
    meta.length > 0 ? ` ${theme.fg("muted", `· ${meta.join(" · ")}`)}` : "";
  return `${theme.fg(summaryColor(status), summary)}${metaText}`;
}

/** Default width for a titled divider rule. */
const DIVIDER_WIDTH = 72;

function formatDivider(
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

// ── Block builders ───────────────────────────────────────────────────────

const INSET = "  ";

function statusTone(spec: BlockBase): string {
  if (spec.tone) return spec.tone;
  if (spec.state === "error") return "error";
  if (spec.state === "warning") return "warning";
  if (spec.state === "success") return "success";
  if (spec.state === "running") return "accent";
  if (spec.state === "pending" || spec.state === "disabled") return "dim";
  if (spec.state === "neutral" || spec.state === "cancelled") return "muted";
  return "accent";
}

function railStatus(spec: BlockBase): TuiRailStatus {
  if (spec.state === "error") return "error";
  if (spec.state === "running" || spec.state === "pending") return "running";
  return "success";
}

/** Colored gutter glyph (defaults to the section marker). */
function gutterGlyph(spec: BlockBase, theme: TuiThemeLike): string {
  if (spec.glyph) return theme.fg(statusTone(spec), Glyph[spec.glyph]);
  if (spec.state) return formatStateMark({ theme, state: spec.state });
  return theme.fg(statusTone(spec), Glyph.section);
}

function renderRecord(spec: RecordBlock, theme: TuiThemeLike, width: number): string {
  const fields = spec.fields ?? [];
  const labelWidth = Math.max(
    0,
    ...fields.map((field) => visibleWidth(`${" ".repeat(field.indent ?? 0)}${field.label}`)),
  );
  const valueWidth = Math.max(1, width - visibleWidth(INSET) - labelWidth - 2);
  return formatRecord({
    theme,
    title: `${gutterGlyph(spec, theme)} ${spec.title}`,
    titleColor: statusTone(spec),
    labelWidth,
    fields: fields.map((f) => ({
      label: f.indent ? `${" ".repeat(f.indent)}${f.label}` : f.label,
      value: f.value
        .split(/\r?\n/)
        .map((line) => fitLine(line, valueWidth).trimEnd())
        .join("\n"),
      ...(f.tone === undefined ? {} : { valueColor: f.tone }),
    })),
  });
}

function renderRail(spec: RailBlock, theme: TuiThemeLike, width: number): string {
  const status = railStatus(spec);
  const mark = gutterGlyph({ ...spec, state: spec.state ?? "success" }, theme);
  const label = theme.bold ? theme.bold(spec.title) : spec.title;
  const arg = spec.arg ? ` ${theme.fg("muted", `(${spec.arg})`)}` : "";
  const call = `${INSET}${mark} ${theme.fg(statusTone(spec), label)}${arg}`;
  if (!spec.summary) return call;
  const result = formatRailResult({
    theme,
    summary: spec.summary,
    ...(spec.meta === undefined ? {} : { meta: spec.meta }),
    status,
  });
  return fitLine(`${call} ${theme.fg("muted", Glyph.arrow)} ${result}`, width).trimEnd();
}

function renderBanner(spec: BannerBlock, theme: TuiThemeLike, width: number): string {
  const head = `${gutterGlyph(spec, theme)} ${theme.fg(statusTone(spec), spec.title)}`;
  const body = (spec.body ?? []).map(
    (line) => fitLine(`${INSET}${theme.fg("text", line)}`, width).trimEnd(),
  );
  return [head, ...body].join("\n");
}

function renderDivider(spec: DividerBlock, theme: TuiThemeLike, width: number): string {
  return formatDivider(
    spec.title,
    Math.min(width, spec.width ?? width ?? DIVIDER_WIDTH),
    theme,
    spec.tone,
  );
}

type TextKind =
  | RecordBlock
  | RailBlock
  | BannerBlock
  | DividerBlock;

/** True when the spec renders as a styled string (vs a directly-built component). */
function isTextKind(spec: BlockSpec): spec is TextKind {
  const kind = spec.kind ?? "record";
  return (
    kind === "record" ||
    kind === "rail" ||
    kind === "banner" ||
    kind === "divider"
  );
}

function renderText(spec: TextKind, theme: TuiThemeLike, width: number): string {
  switch (spec.kind ?? "record") {
    case "rail":
      return renderRail(spec as RailBlock, theme, width);
    case "banner":
      return renderBanner(spec as BannerBlock, theme, width);
    case "divider":
      return renderDivider(spec as DividerBlock, theme, width);
    case "record":
    default:
      return renderRecord(spec as RecordBlock, theme, width);
  }
}

export const Block = {
  /**
   * Pure styled-string builder for the text kinds, split to width.
   * Non-text kinds render their plain content form.
   */
  render(spec: BlockSpec, theme: TuiThemeLike, width: number): string[] {
    const normalizedWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 1;
    if (normalizedWidth === 0) return [];
    if (isTextKind(spec)) {
      return renderText(spec, theme, normalizedWidth)
        .split("\n")
        .map((line) => fitLine(line, normalizedWidth).trimEnd());
    }
    if (spec.kind === "stack") {
      return spec.children.flatMap((child) =>
        Block.render(child, theme, normalizedWidth),
      );
    }
    return spec.content
      .split("\n")
      .map((line) => fitLine(line, normalizedWidth).trimEnd());
  },

  /** Build a renderable component from a spec + theme (every consumed kind). */
  node(spec: BlockSpec, theme: TuiThemeLike): Component {
    if (isTextKind(spec)) {
      return {
        render(width: number): string[] {
          const normalized = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
          if (normalized === 0) return [];
          return Block.render(spec, theme, normalized);
        },
        invalidate(): void {},
      };
    }
    switch (spec.kind) {
      case "markdown":
        return new Markdown(spec.content, 0, 0, getMarkdownTheme());
      case "stack": {
        const container = new Container();
        for (const child of spec.children) {
          container.addChild(Block.node(child, theme));
        }
        return container;
      }
    }
  },
};
