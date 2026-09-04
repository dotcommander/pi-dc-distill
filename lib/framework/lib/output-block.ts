/**
 * Output block — the single sanctioned constructor for dc house-style blocks.
 *
 * One API composes the existing `_tui.ts` formatters (`formatRecord`,
 * `formatRailCall`, `formatRailResult`, `formatRailBlock`, `formatDivider`)
 * plus `Glyph` + `theme.fg` and the `x/tui-components` components into every
 * output shape a dc surface emits. `BlockSpec` is a discriminated union on
 * `kind`; callers MUST go through here — no sibling extension hand-rolls ANSI,
 * gutters, truncation, or component construction.
 *
 * Two layers:
 *  - `Block.render(spec, theme, width) -> string[]` is the pure styled builder for
 *    the *text* kinds (record/rail/banner/railBlock/divider/raw). It delegates
 *    all gutter/rail/truncation work to the `_tui.ts` formatters.
 *  - `Block.node(spec, theme) -> Component` returns a renderable component for
 *    EVERY kind: text kinds wrap their string in a `Text`; `markdown`/`image`
 *    return a `Markdown`/`Image`; `stack` returns a `Container` of child nodes.
 *
 * `Block` is the emit facade that mirrors the scorecard renderer pairing
 * (`scorecard-render.ts` + `scorecard-renderer.ts`): `register` wires a custom
 * message renderer, `emit` ships the spec as JSON content so the renderer
 * re-renders it with the live theme, and `node` builds a component directly.
 *
 * @module dc-framework/lib/output-block
 */

import {
  Container,
  Image,
  Markdown,
  Text,
  getMarkdownTheme,
  type Component,
  type ImageTheme,
} from "../x/tui-components.ts";
import { Glyph, type GlyphName } from "./_glyphs.ts";
import { Notify } from "./notify.ts";
import { Diag } from "./diag.ts";
import { Tui, formatDivider, type TuiThemeLike } from "./_tui.ts";
import { visibleWidth } from "../pi/tui";
import type { ExtensionAPI, MessageRenderer } from "../pi/coding-agent";
import { renderMermaid } from "./diagram/mermaid-text/render.ts";
import type { MermaidRole } from "./diagram/mermaid-text/types.ts";

export interface BlockEmitCustomOptions<TDetails> {
  details?: TDetails;
  llm?: string;
  triggerTurn?: boolean;
  deliverAs?: "followUp" | "steer" | "nextTurn";
  content?: string;
}

export interface BlockField {
  label: string;
  value: string;
  tone?: string;
  /** Optional left-indent (spaces) for nested/two-tier rows (e.g. scorecard grades). */
  indent?: number;
}

/** Shared chrome present on (most) block shapes. */
interface BlockBase {
  glyph?: GlyphName;
  title: string;
  tone?: string;
  state?: import("./_tui.ts").TuiVisualState;
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

/** Boxed rail block: header + body lines + footer (delegates to formatRailBlock). */
export interface RailBlockBlock extends BlockBase {
  kind: "railBlock";
  /** Header text; falls back to `title`. */
  header?: string;
  body: string[];
  footer?: string;
  meta?: string[];
  maxBodyLines?: number;
  expandHint?: string;
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

/** Mermaid flowchart source rendered deterministically as terminal text. */
export interface MermaidBlock {
  kind: "mermaid";
  source: string;
}

/** Inline image — Block.node returns an `Image` component. */
export interface ImageBlock {
  kind: "image";
  /** Base64-encoded image data. */
  data: string;
  mimeType: string;
  maxWidthCells?: number;
  maxHeightCells?: number;
  filename?: string;
}

/** Raw positioned text — preserves the load-bearing x/y padding some chrome uses. */
export interface RawBlock {
  kind: "raw";
  text: string;
  padLeft?: number;
  padTop?: number;
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
  | RailBlockBlock
  | DividerBlock
  | MermaidBlock
  | MarkdownBlock
  | ImageBlock
  | RawBlock
  | StackBlock;

/** Custom transcript message type the house renderer registers against. */
export const HOUSE_BLOCK_TYPE = "dc-block";

function rendererErrorSpec(): BlockSpec {
  return {
    kind: "banner",
    title: "Render error",
    state: "error",
    body: ["This output could not be rendered."],
  };
}

/**
 * Pass-through theme for building the plain fallback content string of an
 * emitted block. The live theme re-renders via the registered renderer; this
 * identity theme only produces the no-renderer fallback text, so colors are
 * intentionally stripped.
 */
const IDENTITY_THEME: TuiThemeLike = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

const INSET = "  ";

/** Default width for a titled divider rule. */
const DIVIDER_WIDTH = 72;

const MERMAID_ROLE_TONES: Record<MermaidRole, string> = {
  plain: "text",
  border: "muted",
  nodeText: "accent",
  edge: "dim",
  title: "muted",
  source: "text",
};

/** Kinds whose render is a styled string (vs a component built directly). */
type TextKind =
  | RecordBlock
  | RailBlock
  | BannerBlock
  | RailBlockBlock
  | DividerBlock
  | MermaidBlock
  | RawBlock;

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

function railStatus(spec: BlockBase): "running" | "success" | "error" {
  if (spec.state === "error") return "error";
  if (spec.state === "running" || spec.state === "pending") return "running";
  return "success";
}

/** Colored gutter glyph (defaults to the section marker). */
function gutterGlyph(spec: BlockBase, theme: TuiThemeLike): string {
  if (spec.glyph) return theme.fg(statusTone(spec), Glyph[spec.glyph]);
  if (spec.state) return Tui.formatStateMark({ theme, state: spec.state });
  return theme.fg(statusTone(spec), Glyph.section);
}

function renderRecord(spec: RecordBlock, theme: TuiThemeLike, width: number): string {
  const fields = spec.fields ?? [];
  const labelWidth = Math.max(
    0,
    ...fields.map((field) => visibleWidth(`${" ".repeat(field.indent ?? 0)}${field.label}`)),
  );
  const valueWidth = Math.max(1, width - visibleWidth(INSET) - labelWidth - 2);
  const record = Tui.formatRecord({
    theme,
    title: `${gutterGlyph(spec, theme)} ${spec.title}`,
    titleColor: statusTone(spec),
    labelWidth,
    fields: fields.map((f) => ({
      label: f.indent ? `${" ".repeat(f.indent)}${f.label}` : f.label,
      value: f.value
        .split(/\r?\n/)
        .map((line) => Tui.fitLine(line, valueWidth).trimEnd())
        .join("\n"),
      ...(f.tone === undefined ? {} : { valueColor: f.tone }),
    })),
  });
  return record;
}

function renderRail(spec: RailBlock, theme: TuiThemeLike, width: number): string {
  const status = railStatus(spec);
  const mark = gutterGlyph({ ...spec, state: spec.state ?? "success" }, theme);
  const label = theme.bold ? theme.bold(spec.title) : spec.title;
  const arg = spec.arg ? ` ${theme.fg("muted", `(${spec.arg})`)}` : "";
  const call = `${INSET}${mark} ${theme.fg(statusTone(spec), label)}${arg}`;
  if (!spec.summary) return call;
  const result = Tui.formatRailResult({
    theme,
    summary: spec.summary,
    ...(spec.meta === undefined ? {} : { meta: spec.meta }),
    status,
  });
  return Tui.fitLine(`${call} ${theme.fg("muted", Glyph.arrow)} ${result}`, width).trimEnd();
}

function renderBanner(spec: BannerBlock, theme: TuiThemeLike, width: number): string {
  const head = `${gutterGlyph(spec, theme)} ${theme.fg(statusTone(spec), spec.title)}`;
  const body = (spec.body ?? []).map(
    (line) => Tui.fitLine(`${INSET}${theme.fg("text", line)}`, width).trimEnd(),
  );
  return [head, ...body].join("\n");
}

function renderRailBlock(spec: RailBlockBlock, theme: TuiThemeLike, width: number): string {
  const header = `${gutterGlyph(spec, theme)} ${theme.fg(statusTone(spec), spec.header ?? spec.title)}`;
  const footerParts = [
    ...(spec.footer ? [spec.footer] : []),
    ...(spec.meta ?? []),
    ...(spec.expandHint ? [spec.expandHint] : []),
  ];
  const footer = theme.fg("muted", footerParts.join(` ${Glyph.midDot} `));
  return Tui.formatRailBlock({
    theme,
    header,
    bodyLines: spec.body.map((line) => theme.fg("text", line)),
    footer,
    inset: INSET,
    railColor: statusTone(spec),
    ...(spec.maxBodyLines === undefined
      ? {}
      : { maxBodyLines: spec.maxBodyLines }),
  }).split("\n").map((line) => Tui.fitLine(line, width).trimEnd()).join("\n");
}

function renderDivider(spec: DividerBlock, theme: TuiThemeLike, width: number): string {
  return formatDivider(
    spec.title,
    Math.min(width, spec.width ?? width ?? DIVIDER_WIDTH),
    theme,
    spec.tone,
  );
}

function renderRaw(spec: RawBlock): string {
  return spec.text;
}

function renderMermaidBlock(spec: MermaidBlock, theme: TuiThemeLike, width: number): string {
  const art = renderMermaid(spec.source, width);
  return art.lines
    .map((line) => line.map((span) => theme.fg(MERMAID_ROLE_TONES[span.role], span.text)).join(""))
    .join("\n");
}

/**
 * Pure styled-string builder — the single source of block house style for the
 * text kinds. Delegates all gutter/truncation/ANSI work to the `_tui.ts`
 * formatters. The non-text kinds (markdown/image/stack) build components and
 * have no string form — call `Block.node` for those.
 */
function renderText(spec: TextKind, theme: TuiThemeLike, width: number): string {
  switch (spec.kind ?? "record") {
    case "rail":
      return renderRail(spec as RailBlock, theme, width);
    case "banner":
      return renderBanner(spec as BannerBlock, theme, width);
    case "railBlock":
      return renderRailBlock(spec as RailBlockBlock, theme, width);
    case "divider":
      return renderDivider(spec as DividerBlock, theme, width);
    case "mermaid":
      return renderMermaidBlock(spec as MermaidBlock, theme, width);
    case "raw":
      return renderRaw(spec as RawBlock);
    case "record":
    default:
      return renderRecord(spec as RecordBlock, theme, width);
  }
}

/** True when the spec renders as a styled string (vs a directly-built component). */
function isTextKind(spec: BlockSpec): spec is TextKind {
  const kind = spec.kind ?? "record";
  return (
    kind === "record" ||
    kind === "rail" ||
    kind === "banner" ||
    kind === "railBlock" ||
    kind === "divider" ||
    kind === "mermaid" ||
    kind === "raw"
  );
}

function specFromMessage(message: unknown): BlockSpec | null {
  if (!message || typeof message !== "object") return null;
  const details = (message as { details?: unknown }).details;
  if (details && typeof details === "object") return details as BlockSpec;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    try {
      return JSON.parse(content) as BlockSpec;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Plain fallback content string for an emitted block. Text kinds render through
 * `Block.render` with the identity theme (so the visible bytes come from the
 * house builder); non-text kinds (markdown/image/stack) have no string form and
 * fall back to the JSON spec, which the registered renderer re-renders.
 */
function plainContent(spec: BlockSpec): string {
  if (isTextKind(spec)) return renderText(spec, IDENTITY_THEME, DIVIDER_WIDTH);
  switch (spec.kind) {
    case "markdown":
      return spec.content;
    case "image":
      return `[image: ${spec.filename ?? spec.mimeType}; ${spec.mimeType}]`;
    case "stack":
      return spec.children.map(plainContent).filter(Boolean).join("\n");
  }
}

function emitCustom(
  host: unknown,
  customType: string,
  spec: BlockSpec,
  opts?: BlockEmitCustomOptions<BlockSpec>,
): void;
function emitCustom<TDetails>(
  host: unknown,
  customType: string,
  spec: BlockSpec,
  opts: BlockEmitCustomOptions<TDetails> & { details: TDetails },
): void;
function emitCustom<TDetails>(
  host: unknown,
  customType: string,
  spec: BlockSpec,
  opts?: BlockEmitCustomOptions<TDetails>,
): void {
  Notify.display(host, opts?.content ?? plainContent(spec), {
    customType,
    details: opts?.details ?? spec,
    ...(opts?.triggerTurn === undefined
      ? {}
      : { triggerTurn: opts.triggerTurn }),
    ...(opts?.deliverAs === undefined
      ? {}
      : { deliverAs: opts.deliverAs }),
  });
  if (opts?.llm !== undefined) {
    Notify.toLLM(host, opts.llm);
  }
}

export const Block = {
  render(spec: BlockSpec, theme: TuiThemeLike, width: number): string[] {
    const normalizedWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 1;
    if (normalizedWidth === 0) return [];
    if (isTextKind(spec)) {
      return renderText(spec, theme, normalizedWidth)
        .split("\n")
        .map((line) => Tui.fitLine(line, normalizedWidth).trimEnd());
    }
    if (spec.kind === "stack") {
      return spec.children.flatMap((child) =>
        Block.render(child, theme, normalizedWidth)
      );
    }
    return plainContent(spec)
      .split("\n")
      .map((line) => Tui.fitLine(line, normalizedWidth).trimEnd());
  },

  plain(spec: BlockSpec): string {
    return plainContent(spec);
  },

  /** Build a renderable component from a spec + theme (every kind). */
  node(spec: BlockSpec, theme: TuiThemeLike): Component {
    if (isTextKind(spec)) {
      const raw = spec.kind === "raw" ? (spec as RawBlock) : null;
      return {
        render(width: number): string[] {
          const inset = raw?.padLeft ?? 0;
          return [
            ...Array.from({ length: raw?.padTop ?? 0 }, () => ""),
            ...Block.render(spec, theme, Math.max(0, width - inset)).map(
              (line) => `${" ".repeat(inset)}${line}`,
            ),
          ];
        },
        invalidate(): void {},
      };
    }
    switch (spec.kind) {
      case "markdown":
        return new Markdown(spec.content, 0, 0, getMarkdownTheme());
      case "image": {
        const imageTheme: ImageTheme = {
          fallbackColor: (s: string) => theme.fg("dim", s),
        };
        return new Image(spec.data, spec.mimeType, imageTheme, {
          ...(spec.maxWidthCells === undefined
            ? {}
            : { maxWidthCells: spec.maxWidthCells }),
          ...(spec.maxHeightCells === undefined
            ? {}
            : { maxHeightCells: spec.maxHeightCells }),
          ...(spec.filename === undefined ? {} : { filename: spec.filename }),
        });
      }
      case "stack": {
        const container = new Container();
        for (const child of spec.children) {
          container.addChild(Block.node(child, theme));
        }
        return container;
      }
      default: {
        // Exhaustiveness guard — unknown kind renders an error stub.
        return new Text(theme.fg("dim", "[dc-block: unknown kind]"), 0, 0);
      }
    }
  },

  /** Register the house renderer so emitted blocks re-render with the live theme. */
  register(pi: unknown): void {
    Notify.renderer(pi, HOUSE_BLOCK_TYPE, (message, _options, theme) => {
      const spec = specFromMessage(message);
      if (!spec) {
        return new Text(theme.fg("dim", "[dc-block: render error]"), 0, 0);
      }
      return Block.node(spec, theme);
    });
  },

  /**
   * Emit a block into the transcript. The spec rides on `content` (JSON) and
   * `details`; the registered renderer themes it with the live theme. The plain
   * content string is the fallback when no renderer is installed.
   */
  emit(host: unknown, spec: BlockSpec): void {
    Notify.display(host, plainContent(spec), {
      customType: HOUSE_BLOCK_TYPE,
      details: spec,
    });
  },

  /**
   * Register a renderer for a FEATURE `customType` through the Block facade.
   *
   * Features keep their own `customType` (needed for expand-state and
   * model-facing payloads) but route renderer registration through here instead
   * of calling `Notify.renderer` directly. The renderer is expected to build its
   * visible output via `Block.node(spec, theme)` so every feature customType
   * stays covered by a typed spec.
   */
  registerCustom<TDetails = unknown>(
    pi: unknown,
    customType: string,
    renderFromMessage: MessageRenderer<TDetails>,
  ): void {
    Notify.renderer(pi, customType, renderFromMessage);
  },

  /** Register a semantic custom-message renderer backed by a BlockSpec factory. */
  registerSpec<TDetails = unknown>(
    pi: ExtensionAPI,
    customType: string,
    factory: (
      message: { content: string; details?: TDetails },
      options: { expanded?: boolean },
    ) => BlockSpec,
  ): void {
    Notify.renderer(pi, customType, (message, options, theme) => {
      try {
        return Block.node(factory(message, options), theme);
      } catch (error) {
        Diag.error(
          "block.registerSpec",
          `BlockSpec factory failed for ${customType}`,
          error,
        );
        return Block.node(rendererErrorSpec(), theme);
      }
    });
  },

  /** Return an empty no-op renderable. */
  empty(): Component {
    return new Text("", 0, 0);
  },

  /**
   * Emit a visible block under a FEATURE `customType`. Mirrors `emit` but
   * parameterizes the customType and lets a `details`/model-facing payload ride
   * along: the plain fallback content comes from `Block.plain` so
   * raw `new Text` / raw `Notify.display` calls are never needed; the registered
   * renderer re-themes the spec with the live theme.
   */
  emitCustom,
};
