import { truncateToWidth, visibleWidth } from "../pi/tui";
import type { TuiThemeLike } from "./_tui.ts";
import { collapseWhitespace, truncateMiddlePath } from "./_tui_text.ts";
import { Glyph } from "./_glyphs.ts";

export interface TuiFooterOptions {
  theme: TuiThemeLike;
  width: number;
  previousInput?: string;
  activeInput?: string;
  activeInputCursor?: TuiFooterInputCursor;
  activityText?: string;
  projectDir?: string;
  modelLabel: string;
  context?: TuiFooterContextMeter;
  branch?: string | null;
  inset?: string;
  backgroundColor?: string;
  chrome?: TuiFooterChromeOptions;
}

export interface TuiFooterContextMeter {
  used?: number;
  limit?: number;
  usedLabel?: string;
  limitLabel?: string;
  label?: string;
}

export interface TuiFooterInputCursor {
  line: number;
  col: number;
}

export interface TuiFooterChromeOptions {
  segmentSeparator?: string;
  contextBarWidth?: number;
  contextBarFilled?: string;
  contextBarEmpty?: string;
  piGlyph?: string;
  piColor?: string;
  modelColor?: string;
  contextUsedColor?: string;
  contextBarColor?: string;
  contextBarWarningColor?: string;
  contextBarErrorColor?: string;
  contextWarningThreshold?: number;
  contextErrorThreshold?: number;
  contextBarEmptyColor?: string;
  pathColor?: string;
  branchColor?: string;
  inputColor?: string;
  inputRowBackgroundColor?: string;
  cursorColor?: string;
  footerTopBorder?: boolean;
  footerTopBorderGlyph?: string;
  footerTopBorderColor?: string;
  previousInputPrefix?: string;
  previousInputColor?: string;
  activityColor?: string;
  activityDotColor?: string;
  inputBox?: boolean;
  inputBoxBorderColor?: string;
  inputBoxFillColor?: string;
  inputBoxHorizontalGlyph?: string;
  inputBoxVerticalGlyph?: string;
  inputBoxTopLeftGlyph?: string;
  inputBoxTopRightGlyph?: string;
  inputBoxBottomLeftGlyph?: string;
  inputBoxBottomRightGlyph?: string;
  inputTopBorder?: boolean;
  inputTopBorderGlyph?: string;
  inputTopBorderColor?: string;
  maxInputRows?: number;
  inputPaddingTop?: number;
  inputPaddingBottom?: number;
  inputPrefix?: string;
  inputContinuationPrefix?: string;
  inputCursor?: string;
  inputPlaceholder?: string;
  inputPlaceholderColor?: string;
  inputPlaceholderCursorOverlay?: boolean;
}

const MAX_FOOTER_INPUT_ROWS = 3;
const FOOTER_CONTEXT_BAR_WIDTH = 10;

function normalizeFooterInput(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\t/g, " ");
}

function joinFooterSegments(
  parts: Array<string | undefined | null>,
  separator: string,
): string {
  return parts.filter((part): part is string => Boolean(part)).join(separator);
}

function trimStartToWidth(input: string, width: number): string {
  if (width <= 0) return "";
  const chars = [...input];
  let output = "";
  let outputWidth = 0;
  for (let index = chars.length - 1; index >= 0; index--) {
    const char = chars[index] ?? "";
    const charWidth = Math.max(1, visibleWidth(char));
    if (output && outputWidth + charWidth > width) break;
    output = `${char}${output}`;
    outputWidth += charWidth;
  }
  return output;
}

interface WrappedInputLine {
  prefix: string;
  text: string;
  cursorOffset?: number;
  cursor: boolean;
  width: number;
}

interface WrappedInputChunk {
  text: string;
  start: number;
  end: number;
}

function wrapTextChunksByWidth(
  input: string,
  width: number,
): WrappedInputChunk[] {
  if (width <= 0) return [{ text: "", start: 0, end: 0 }];
  if (!input) return [{ text: "", start: 0, end: 0 }];

  const chunks: WrappedInputChunk[] = [];
  const segments = [...input];
  let currentWidth = 0;
  let chunkStartSegment = 0;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index] ?? "";
    const charWidth = Math.max(1, visibleWidth(segment));
    if (index > chunkStartSegment && currentWidth + charWidth > width) {
      let breakSegment = index;
      for (
        let candidate = index - 1;
        candidate > chunkStartSegment;
        candidate--
      ) {
        if (/\s/u.test(segments[candidate] ?? "")) {
          breakSegment = candidate + 1;
          break;
        }
      }
      chunks.push(chunkFromSegments(segments, chunkStartSegment, breakSegment));
      chunkStartSegment = breakSegment;
      currentWidth = 0;
      index = chunkStartSegment - 1;
      continue;
    }
    currentWidth += charWidth;
  }
  chunks.push(chunkFromSegments(segments, chunkStartSegment, segments.length));
  return chunks;
}

function chunkFromSegments(
  segments: string[],
  startSegment: number,
  endSegment: number,
): WrappedInputChunk {
  const start = segments.slice(0, startSegment).join("").length;
  const text = segments.slice(startSegment, endSegment).join("");
  return {
    text,
    start,
    end: start + text.length,
  };
}

function normalizeInputCursor(
  input: string,
  cursor: TuiFooterInputCursor | undefined,
): TuiFooterInputCursor {
  const logicalLines = input.split("\n");
  const line = Math.max(
    0,
    Math.min(
      Math.floor(cursor?.line ?? logicalLines.length - 1),
      logicalLines.length - 1,
    ),
  );
  const text = logicalLines[line] ?? "";
  const col = Math.max(
    0,
    Math.min(Math.floor(cursor?.col ?? text.length), text.length),
  );
  return { line, col };
}

function wrapActiveInput(
  input: string,
  cursor: TuiFooterInputCursor | undefined,
  prefix: string,
  continuationPrefix: string,
  suffix: string,
  width: number,
  maxRows: number,
  styleInput: (text: string) => string = (text) => text,
): string[] {
  if (width <= 0) return [];
  const firstWidth = Math.max(
    0,
    width - visibleWidth(prefix) - visibleWidth(suffix),
  );
  const continuationWidth = Math.max(
    0,
    width - visibleWidth(continuationPrefix) - visibleWidth(suffix),
  );
  if (firstWidth <= 0) return [truncateToWidth(`${prefix}${suffix}`, width)];

  const lines = wrapInputLines(
    input,
    cursor,
    prefix,
    continuationPrefix,
    firstWidth,
    continuationWidth,
  );
  const visibleLines = applyInputWindow(lines, maxRows);
  return styleLines(visibleLines, suffix, styleInput);
}

// Per-logical-line wrap + cursor assignment, carried out as data.
// Empty-input / no-cursor fallback assigns the cursor to the last row.
function wrapInputLines(
  input: string,
  cursor: TuiFooterInputCursor | undefined,
  prefix: string,
  continuationPrefix: string,
  firstWidth: number,
  continuationWidth: number,
): WrappedInputLine[] {
  const lines: WrappedInputLine[] = [];
  const inputCursor = normalizeInputCursor(input, cursor);
  const logicalLines = input.split("\n");
  for (let lineIndex = 0; lineIndex < logicalLines.length; lineIndex++) {
    const logicalLine = logicalLines[lineIndex] ?? "";
    let cursorAssigned = false;
    const firstLine = lines.length === 0;
    const linePrefix = firstLine ? prefix : continuationPrefix;
    const lineWidth = firstLine ? firstWidth : continuationWidth;
    const [head = { text: "", start: 0, end: 0 }, ...tail] =
      wrapTextChunksByWidth(logicalLine, Math.max(1, lineWidth));
    const headHasCursor =
      lineIndex === inputCursor.line &&
      inputCursor.col >= head.start &&
      inputCursor.col <= head.end;
    cursorAssigned = headHasCursor;
    lines.push({
      prefix: linePrefix,
      text: head.text,
      cursor: headHasCursor,
      cursorOffset: inputCursor.col - head.start,
      width: lineWidth,
    });
    const continuationChunks = tail;
    for (const chunk of continuationChunks) {
      if (!chunk.text && tail.length === 0) continue;
      const chunkHasCursor =
        !cursorAssigned &&
        lineIndex === inputCursor.line &&
        inputCursor.col >= chunk.start &&
        inputCursor.col <= chunk.end;
      cursorAssigned = cursorAssigned || chunkHasCursor;
      lines.push({
        prefix: continuationPrefix,
        text: chunk.text,
        cursor: chunkHasCursor,
        cursorOffset: inputCursor.col - chunk.start,
        width: continuationWidth,
      });
    }
  }
  if (!lines.some((line) => line.cursor)) {
    const lastLine = lines.at(-1);
    if (lastLine) {
      lastLine.cursor = true;
      lastLine.cursorOffset = lastLine.text.length;
    }
  }
  return lines;
}

// Window selection around the cursor + "…" marker on the first visible row.
function applyInputWindow(
  lines: WrappedInputLine[],
  maxRows: number,
): WrappedInputLine[] {
  const visibleLimit = Math.max(1, maxRows);
  const cursorLineIndex = Math.max(
    0,
    lines.findIndex((line) => line.cursor),
  );
  const visibleStart =
    lines.length > visibleLimit
      ? Math.min(
          Math.max(0, cursorLineIndex - visibleLimit + 1),
          Math.max(0, lines.length - visibleLimit),
        )
      : 0;
  const visibleLines = lines.slice(visibleStart, visibleStart + visibleLimit);
  if (visibleLines.length < lines.length) {
    const marker = Glyph.ellipsis;
    const [firstVisible] = visibleLines;
    if (firstVisible && visibleStart > 0 && !firstVisible.cursor) {
      const markerWidth = visibleWidth(marker);
      firstVisible.text = `${marker}${trimStartToWidth(
        firstVisible.text,
        Math.max(0, firstVisible.width - markerWidth),
      )}`;
    }
  }
  return visibleLines;
}

// Render rows: prefix + styled text, with the cursor suffix spliced at offset.
function styleLines(
  visibleLines: WrappedInputLine[],
  suffix: string,
  styleInput: (text: string) => string,
): string[] {
  return visibleLines.map((line) => {
    if (!line.cursor) return `${line.prefix}${styleInput(line.text)}`;
    const offset = Math.max(
      0,
      Math.min(line.cursorOffset ?? line.text.length, line.text.length),
    );
    const before = line.text.slice(0, offset);
    const after = line.text.slice(offset);
    return `${line.prefix}${styleInput(before)}${suffix}${styleInput(after)}`;
  });
}

function paintBar(
  text: string,
  width: number,
  theme: TuiThemeLike,
  color: string,
): string {
  if (width <= 0) return "";
  const line =
    truncateToWidth(text, width) +
    " ".repeat(Math.max(0, width - visibleWidth(text)));
  // Empty color = no painted fill: render on the terminal's own background.
  // Guard before theme.bg() — bg("") throws "Unknown theme background color".
  return theme.bg && color ? theme.bg(color, line) : line;
}

function fitFooterLine(left: string, right: string, width: number): string {
  if (width <= 0) return "";
  if (!right) return truncateToWidth(left, width);
  if (!left) return truncateToWidth(right, width);

  const gap = "  ";
  const rightWidth = visibleWidth(right);
  if (rightWidth + gap.length >= width) return truncateToWidth(right, width);

  const leftWidth = width - rightWidth - gap.length;
  const fittedLeft = truncateToWidth(left, Math.max(1, leftWidth));
  const pad = Math.max(
    gap.length,
    width - visibleWidth(fittedLeft) - rightWidth,
  );
  return `${fittedLeft}${" ".repeat(pad)}${right}`;
}

function formatCompactCount(value: number): string {
  if (!Number.isFinite(value)) return "";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1)}m`;
  }
  if (absolute >= 1_000) return `${Math.round(value / 1_000)}k`;
  return `${Math.round(value)}`;
}

function formatContextBar(
  context: TuiFooterContextMeter | undefined,
  theme: TuiThemeLike,
  width: number,
  filledGlyph: string,
  emptyGlyph: string,
  usedColor: string,
  filledColor: string,
  emptyColor: string,
): string | undefined {
  if (!context) return undefined;
  if (
    context.used === undefined ||
    context.limit === undefined ||
    context.limit <= 0
  ) {
    const label = collapseWhitespace(context.label ?? context.limitLabel ?? "");
    return label ? theme.fg("muted", label) : undefined;
  }

  const barWidth = Math.max(1, width);
  const ratio = Math.max(0, Math.min(1, context.used / context.limit));
  const filled = Math.max(1, Math.min(barWidth, Math.round(ratio * barWidth)));
  const empty = barWidth - filled;
  const bar = `${theme.fg(filledColor, filledGlyph.repeat(filled))}${theme.fg(
    emptyColor,
    emptyGlyph.repeat(empty),
  )}`;
  const used = context.usedLabel ?? formatCompactCount(context.used);
  const limit = context.limitLabel ?? formatCompactCount(context.limit);
  const usedText = theme.fg(
    usedColor,
    theme.bold ? theme.bold(`${used}/`) : `${used}/`,
  );
  return `${usedText} ${bar} ${theme.fg("muted", limit)}`;
}

function contextBarFilledColor(
  context: TuiFooterContextMeter | undefined,
  chrome: TuiFooterChromeOptions | undefined,
): string {
  const used = context?.used;
  if (used === undefined || !Number.isFinite(used)) {
    return chrome?.contextBarColor ?? "accent";
  }

  const warningThreshold = chrome?.contextWarningThreshold ?? 60_000;
  const errorThreshold = chrome?.contextErrorThreshold ?? 120_000;
  if (used >= errorThreshold) {
    return chrome?.contextBarErrorColor ?? "error";
  }
  if (used >= warningThreshold) {
    return chrome?.contextBarWarningColor ?? "warning";
  }
  return chrome?.contextBarColor ?? "accent";
}

// Used-number color: base text color below the warning threshold, then amber /
// red as the context fills. Same thresholds as the bar, but defaults to the
// base color (not "accent") below warning so low-usage output is unchanged.
function contextUsedFgColor(
  context: TuiFooterContextMeter | undefined,
  chrome: TuiFooterChromeOptions | undefined,
): string {
  const base = chrome?.contextUsedColor ?? "text";
  const used = context?.used;
  if (used === undefined || !Number.isFinite(used)) {
    return base;
  }
  if (used >= (chrome?.contextErrorThreshold ?? 120_000)) {
    return chrome?.contextBarErrorColor ?? "error";
  }
  if (used >= (chrome?.contextWarningThreshold ?? 60_000)) {
    return chrome?.contextBarWarningColor ?? "warning";
  }
  return base;
}

export function compactFooterPathLabel(value: string, maxChars = 30): string {
  const compact = collapseWhitespace(value);
  if (visibleWidth(compact) <= maxChars) return compact;

  const separator =
    compact.includes("\\") && !compact.includes("/") ? "\\" : "/";
  const parts = compact.split(separator);
  const prefixLength =
    parts[0] === "~"
      ? Math.min(2, parts.length)
      : compact.startsWith(separator)
        ? Math.min(2, parts.length)
        : 1;

  if (parts.length > prefixLength + 2) {
    const prefix = parts.slice(0, prefixLength);
    const candidates = [
      [...prefix, "...", ...parts.slice(-2)].join(separator),
      [...prefix, "...", ...parts.slice(-1)].join(separator),
      ["...", ...parts.slice(-1)].join(separator),
    ];
    const candidate = candidates.find((item) => visibleWidth(item) <= maxChars);
    if (candidate) return candidate;
  }

  return truncateMiddlePath(compact, maxChars);
}

// Resolved footer chrome — every TuiFooterChromeOptions field the assembly body
// reads, collapsed to its default. Fields consumed only inside formatContextBar /
// contextBarFilledColor stay on the raw `chrome` and are passed through unchanged.
interface FooterChromeConfig {
  separator: string;
  inputPrefix: string;
  inputContinuationPrefix: string;
  inputCursor: string;
  inputRowBackgroundColor: string;
  contextBarWidth: number;
  contextBarFilled: string;
  contextBarEmpty: string;
  maxInputRows: number;
  footerTopBorder: boolean;
  footerTopBorderGlyph: string;
  footerTopBorderColor: string;
  inputTopBorder: boolean;
  inputTopBorderGlyph: string;
  inputTopBorderColor: string;
  inputPaddingTop: number;
  inputPaddingBottom: number;
  inputBox: boolean;
  inputBoxBorderColor: string;
  inputBoxFillColor: string;
  inputBoxHorizontalGlyph: string;
  inputBoxVerticalGlyph: string;
  inputBoxTopLeftGlyph: string;
  inputBoxTopRightGlyph: string;
  inputBoxBottomLeftGlyph: string;
  inputBoxBottomRightGlyph: string;
  inputPlaceholder: string;
  inputPlaceholderColor: string;
  inputPlaceholderCursorOverlay: boolean;
}

function defaultChrome(
  theme: TuiThemeLike,
  inset: string,
  chrome: TuiFooterChromeOptions | undefined,
): FooterChromeConfig {
  const inputInset = inset.startsWith(" ") ? inset.slice(1) : inset;
  return {
    separator: chrome?.segmentSeparator ?? ` ${Glyph.bullet} `,
    inputPrefix:
      chrome?.inputPrefix ??
      `${inputInset}${theme.fg("muted", Glyph.promptInput)} `,
    inputContinuationPrefix:
      chrome?.inputContinuationPrefix ?? `${inputInset}  `,
    inputCursor:
      chrome?.inputCursor ??
      theme.fg(chrome?.cursorColor ?? "text", Glyph.cursorThin),
    inputRowBackgroundColor: chrome?.inputRowBackgroundColor ?? "",
    contextBarWidth: chrome?.contextBarWidth ?? FOOTER_CONTEXT_BAR_WIDTH,
    contextBarFilled: chrome?.contextBarFilled ?? Glyph.barFilled,
    contextBarEmpty: chrome?.contextBarEmpty ?? Glyph.barEmpty,
    maxInputRows: chrome?.maxInputRows ?? MAX_FOOTER_INPUT_ROWS,
    footerTopBorder: chrome?.footerTopBorder ?? false,
    footerTopBorderGlyph: chrome?.footerTopBorderGlyph ?? Glyph.divider,
    footerTopBorderColor: chrome?.footerTopBorderColor ?? "success",
    inputTopBorder: chrome?.inputTopBorder ?? false,
    inputTopBorderGlyph: chrome?.inputTopBorderGlyph ?? Glyph.divider,
    inputTopBorderColor: chrome?.inputTopBorderColor ?? "success",
    inputPaddingTop: Math.max(0, chrome?.inputPaddingTop ?? 0),
    inputPaddingBottom: Math.max(0, chrome?.inputPaddingBottom ?? 0),
    inputBox: chrome?.inputBox ?? false,
    inputBoxBorderColor: chrome?.inputBoxBorderColor ?? "border",
    inputBoxFillColor: chrome?.inputBoxFillColor ?? "",
    inputBoxHorizontalGlyph: chrome?.inputBoxHorizontalGlyph ?? Glyph.divider,
    inputBoxVerticalGlyph: chrome?.inputBoxVerticalGlyph ?? "│",
    inputBoxTopLeftGlyph: chrome?.inputBoxTopLeftGlyph ?? "┌",
    inputBoxTopRightGlyph: chrome?.inputBoxTopRightGlyph ?? "┐",
    inputBoxBottomLeftGlyph: chrome?.inputBoxBottomLeftGlyph ?? "└",
    inputBoxBottomRightGlyph: chrome?.inputBoxBottomRightGlyph ?? "┘",
    inputPlaceholder: chrome?.inputPlaceholder ?? "",
    inputPlaceholderColor: chrome?.inputPlaceholderColor ?? "muted",
    inputPlaceholderCursorOverlay: chrome?.inputPlaceholderCursorOverlay ?? false,
  };
}

// G4 source: the wrapped active-input rows (styling + cursor handled by wrapActiveInput).
function buildEditorRows(
  options: TuiFooterOptions,
  theme: TuiThemeLike,
  width: number,
  chrome: TuiFooterChromeOptions | undefined,
  config: FooterChromeConfig,
): string[] {
  const input = normalizeFooterInput(options.activeInput ?? "");
  if (!input && config.inputPlaceholder) {
    const placeholderTail = [...config.inputPlaceholder].slice(1).join("");
    const placeholder = config.inputPlaceholderCursorOverlay
      ? `${config.inputCursor}${theme.fg(
          config.inputPlaceholderColor,
          placeholderTail,
        )}`
      : `${config.inputCursor}${theme.fg(
          config.inputPlaceholderColor,
          config.inputPlaceholder,
        )}`;
    return [`${config.inputPrefix}${placeholder}`];
  }

  return wrapActiveInput(
    input,
    options.activeInputCursor,
    config.inputPrefix,
    config.inputContinuationPrefix,
    config.inputCursor,
    width,
    config.maxInputRows,
    (text) => theme.fg(chrome?.inputColor ?? "accent", text),
  );
}

// Left footer segment (G7): π glyph • model label • context bar.
function buildLeftSegment(
  theme: TuiThemeLike,
  modelLabel: string,
  context: TuiFooterContextMeter | undefined,
  chrome: TuiFooterChromeOptions | undefined,
  config: FooterChromeConfig,
): string {
  const usedColor = contextUsedFgColor(context, chrome);
  return joinFooterSegments(
    [
      chrome?.piGlyph === ""
        ? undefined
        : theme.fg(
            chrome?.piColor ?? "success",
            chrome?.piGlyph ?? Glyph.promptPi,
          ),
      theme.fg(chrome?.modelColor ?? "muted", modelLabel || "model"),
      formatContextBar(
        context,
        theme,
        config.contextBarWidth,
        config.contextBarFilled,
        config.contextBarEmpty,
        usedColor,
        contextBarFilledColor(context, chrome),
        chrome?.contextBarEmptyColor ?? "dim",
      ),
    ],
    config.separator,
  );
}

// Right footer segment (G7): projectDir • branch (each omitted when falsy).
function buildRightSegment(
  theme: TuiThemeLike,
  projectDir: string | undefined,
  branch: string | null | undefined,
  chrome: TuiFooterChromeOptions | undefined,
  config: FooterChromeConfig,
): string {
  const pathLabel = projectDir ? compactFooterPathLabel(projectDir) : undefined;
  return joinFooterSegments(
    [
      pathLabel ? theme.fg(chrome?.pathColor ?? "muted", pathLabel) : undefined,
      branch
        ? theme.fg(chrome?.branchColor ?? chrome?.pathColor ?? "muted", branch)
        : undefined,
    ],
    config.separator,
  );
}

// G1: previousInput / activity line, or undefined when both are empty.
function buildPreviousInputLine(
  options: TuiFooterOptions,
  theme: TuiThemeLike,
  width: number,
  inset: string,
  backgroundColor: string,
  chrome: TuiFooterChromeOptions | undefined,
): string | undefined {
  const previousInput = collapseWhitespace(options.previousInput ?? "");
  const activity = collapseWhitespace(options.activityText ?? "");
  if (!(previousInput || activity)) return undefined;
  return paintBar(
    fitFooterLine(
      `${inset}${theme.fg("dim", chrome?.previousInputPrefix ?? "sent")} ${
        previousInput
          ? theme.fg(chrome?.previousInputColor ?? "muted", previousInput)
          : ""
      }`.trimEnd(),
      activity
        ? `${theme.fg(chrome?.activityDotColor ?? "success", Glyph.dotFilled)} ${theme.fg(
            chrome?.activityColor ?? "success",
            activity,
          )}`
        : "",
      width,
    ),
    width,
    theme,
    backgroundColor,
  );
}

// A border row (G2/G6): full-width glyph painted bar, or [] when disabled.
function buildBorderRows(
  enabled: boolean,
  glyph: string,
  color: string,
  theme: TuiThemeLike,
  width: number,
  backgroundColor: string,
): string[] {
  return enabled
    ? [
        paintBar(
          theme.fg(color, glyph.repeat(width)),
          width,
          theme,
          backgroundColor,
        ),
      ]
    : [];
}

// Blank padding rows (G3/G5): `count` empty painted bars.
function buildPaddingRows(
  count: number,
  theme: TuiThemeLike,
  width: number,
  backgroundColor: string,
): string[] {
  return Array.from({ length: count }, () =>
    paintBar("", width, theme, backgroundColor),
  );
}

function buildInputBoxRows(
  editorLines: string[],
  config: FooterChromeConfig,
  theme: TuiThemeLike,
  width: number,
): string[] {
  if (!config.inputBox) return editorLines;
  if (width <= 2) {
    return editorLines.map((line) => truncateToWidth(line, width));
  }

  const innerWidth = width - 2;
  const border = (value: string) => theme.fg(config.inputBoxBorderColor, value);
  const top = `${border(config.inputBoxTopLeftGlyph)}${border(
    config.inputBoxHorizontalGlyph.repeat(innerWidth),
  )}${border(config.inputBoxTopRightGlyph)}`;
  const bottom = `${border(config.inputBoxBottomLeftGlyph)}${border(
    config.inputBoxHorizontalGlyph.repeat(innerWidth),
  )}${border(config.inputBoxBottomRightGlyph)}`;
  const body = editorLines.map((line) => {
    const inner = paintBar(
      truncateToWidth(line, innerWidth),
      innerWidth,
      theme,
      config.inputBoxFillColor,
    );
    return `${border(config.inputBoxVerticalGlyph)}${inner}${border(
      config.inputBoxVerticalGlyph,
    )}`;
  });
  return [top, ...body, bottom];
}

export function formatFooterLines(options: TuiFooterOptions): string[] {
  const {
    theme,
    width,
    projectDir,
    modelLabel,
    context,
    branch,
    inset = "  ",
    backgroundColor = "customMessageBg",
    chrome,
  } = options;
  if (width <= 0) return [];

  const config = defaultChrome(theme, inset, chrome);
  const editorWidth = config.inputBox ? Math.max(0, width - 2) : width;
  const editorLines = buildEditorRows(
    options,
    theme,
    editorWidth,
    chrome,
    config,
  );
  const inputRows = buildInputBoxRows(editorLines, config, theme, width);
  const left = buildLeftSegment(theme, modelLabel, context, chrome, config);
  const right = buildRightSegment(theme, projectDir, branch, chrome, config);
  const previousInputLine = buildPreviousInputLine(
    options,
    theme,
    width,
    inset,
    backgroundColor,
    chrome,
  );

  return [
    // G1: previousInput / activity line
    ...(previousInputLine ? [previousInputLine] : []),
    // G2: input top border
    ...buildBorderRows(
      config.inputTopBorder,
      config.inputTopBorderGlyph,
      config.inputTopBorderColor,
      theme,
      width,
      backgroundColor,
    ),
    // G3: input padding top
    ...buildPaddingRows(
      config.inputPaddingTop,
      theme,
      width,
      config.inputRowBackgroundColor || backgroundColor,
    ),
    // G4: editor rows
    ...inputRows.map((line) =>
      paintBar(
        truncateToWidth(line, width),
        width,
        theme,
        config.inputRowBackgroundColor || backgroundColor,
      ),
    ),
    // G5: input padding bottom
    ...buildPaddingRows(
      config.inputPaddingBottom,
      theme,
      width,
      config.inputRowBackgroundColor || backgroundColor,
    ),
    // G6: footer top border
    ...buildBorderRows(
      config.footerTopBorder,
      config.footerTopBorderGlyph,
      config.footerTopBorderColor,
      theme,
      width,
      backgroundColor,
    ),
    // G7: footer metadata line
    paintBar(
      fitFooterLine(`${inset}${left}`, right, width),
      width,
      theme,
      backgroundColor,
    ),
  ];
}
