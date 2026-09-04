/**
 * TUI render policy for registered tools — MinimalToolRow, defaultRenderCall,
 * defaultRenderResult, and all display helpers.
 *
 * Owns: display classification, arg summarization, output summarization,
 * component classes (MinimalToolRow, MinimalExpandedPanel, EmptyComponent),
 * and the two default renderer factories consumed by Tool.register.
 *
 * Contract types (ToolRegisterDef, ToolResult) live in ./tool.ts.
 *
 * @module dc-framework/lib/_tool-render
 */

import type { TObject } from "typebox";
import type {
  AgentToolResult,
  ToolRenderResultOptions,
} from "../pi/coding-agent";
import { Text, truncateToWidth, visibleWidth, type Component } from "../pi/tui";
import { Tui } from "./_tui.ts";
import { Fmt } from "./_format.ts";
import { Glyph } from "./_glyphs.ts";
import { logDiag } from "./_log.ts";
import {
  TASK_LIKE,
  AFK_PREFIX,
  COLOR_READ,
  COLOR_WRITE,
  COLOR_EDIT,
  COLOR_AFK,
  COLOR_LINK,
  DISPLAY_GREP,
  DISPLAY_READ,
  DISPLAY_WRITE,
  DISPLAY_EDIT,
  DISPLAY_WEB,
  ARGS_GREP_SEARCH,
  ARGS_GREP,
  ARGS_BASH_RUN,
  OUT_BASH_DURATION,
  OUT_READ,
  OUT_GREP,
  OUT_LIST,
  OUT_WRITE,
} from "./_tool-class.ts";
import type { ToolRegisterDef } from "./tool.ts";

interface RenderTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
  bg?(color: string, text: string): string;
}
type ToolStatus = "running" | "success" | "error";
const MINIMAL_BODY_INSET = "  ";
const MAX_MINIMAL_ARG_VALUE_CHARS = 40;
const MAX_MINIMAL_ARG_TEXT_CHARS = 64;
const MAX_MINIMAL_RESULT_TEXT_CHARS = 48;
const TOOL_RENDER_REFRESH_INTERVAL_MS = 1_000;

interface MinimalToolState {
  row?: MinimalToolRow;
  startedAt?: number;
  endedAt?: number;
  interval?: ReturnType<typeof setInterval>;
  callLine?: string;
  harnessHidden?: boolean;
}

/** Tool-name fragments the harness treats as bash-class for display + output collapse. */
export const BASH_CLASS_TOOL_PATTERN =
  /bash|exec|run|shell|tmux|test|vet|watch/;

const HARNESS_ASSIGN_TOOL_BOUND_KEY = Symbol.for(
  "dotcommander.harness.assignToolBound",
);

type HarnessToolBoundGlobal = Record<
  symbol,
  | ((state: MinimalToolState, theme: RenderTheme) => Component | undefined)
  | undefined
>;

class EmptyComponent implements Component {
  invalidate(): void {}

  render(): string[] {
    return [];
  }
}

class MinimalToolRow implements Component {
  private meta = "";
  private selectedBg?: (text: string) => string;

  constructor(private left: string) {}

  setLeft(left: string): void {
    this.left = left;
  }

  setMeta(meta: string): void {
    this.meta = meta.trimStart();
  }

  clearMeta(): void {
    this.meta = "";
  }

  setSelectedBg(selectedBg: ((text: string) => string) | undefined): void {
    this.selectedBg = selectedBg;
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (!this.meta) {
      return [this.styleLine(truncateToWidth(this.left, width), width)];
    }

    const minGap = 2;
    const metaWidth = visibleWidth(this.meta);
    const availableLeft = Math.max(1, width - metaWidth - minGap);
    const left = truncateToWidth(this.left, availableLeft);
    const gap = Math.max(minGap, width - visibleWidth(left) - metaWidth);
    return [this.styleLine(`${left}${" ".repeat(gap)}${this.meta}`, width)];
  }

  private styleLine(line: string, width: number): string {
    if (this.selectedBg) return this.selectedBg(truncateToWidth(line, width));
    const pad = Math.max(0, width - visibleWidth(line));
    const padded = line + " ".repeat(pad);
    return padded;
  }
}

class MinimalExpandedPanel implements Component {
  constructor(
    private text: string,
    private selectedBg?: (text: string) => string,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const lines = this.text.split("\n");
    if (!this.selectedBg || width <= 0) return lines;
    return lines.map(
      (line) => this.selectedBg?.(truncateToWidth(line, width)) ?? line,
    );
  }
}

const ARG_KEYS = [
  "path",
  "file_path",
  "url",
  "query",
  "pattern",
  "action",
  "title",
  "id",
  "command",
  "content",
] as const;

function firstText(result: AgentToolResult<unknown>): string {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n")
    .trim();
}

function compactValue(value: unknown): string {
  if (typeof value === "string") {
    const compact = value.replace(/\s+/g, " ").trim();
    const truncated = truncateArgText(compact, MAX_MINIMAL_ARG_VALUE_CHARS);
    return truncated.includes(" ") ? JSON.stringify(truncated) : truncated;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.length}]`;
  if (value && typeof value === "object") return "{...}";
  return String(value);
}

function compactText(value: unknown): string {
  return typeof value === "string"
    ? truncateArgText(value.replace(/\s+/g, " ").trim())
    : compactValue(value);
}

function truncateArgText(
  value: string,
  maxChars = MAX_MINIMAL_ARG_TEXT_CHARS,
): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}${Glyph.ellipsis}`;
}

function compactPathText(value: string): string {
  return Tui.truncateMiddlePath(value, MAX_MINIMAL_ARG_TEXT_CHARS);
}

function summarizeArgs(name: string, args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const record = args as Record<string, unknown>;
  const lower = name.toLowerCase();
  if (isAfkTool(name)) {
    const subcommand = afkSubcommand(name, record);
    const argText = Object.entries(record)
      .filter(
        ([key, value]) =>
          key !== "action" && value !== undefined && value !== null,
      )
      .slice(0, 4)
      .map(([key, value]) => `${key}=${compactValue(value)}`)
      .join(" ");
    return truncateArgText([subcommand, argText].filter(Boolean).join(" "));
  }
  if (TASK_LIKE.test(lower)) {
    const taskText =
      record.description ??
      record.task ??
      record.task_id ??
      record.title ??
      record.prompt ??
      record.objective ??
      record.type;
    const taskKind = record.type ?? record.agent ?? record.name;
    const main = taskText !== undefined ? compactValue(taskText) : "";
    return taskKind !== undefined && main
      ? `${main} ${compactValue(taskKind)}`
      : main || (taskKind !== undefined ? compactValue(taskKind) : "");
  }
  const primarySearch = record.pattern ?? record.query;
  const searchScope = record.path ?? record.url ?? record.file_path;
  if (ARGS_GREP_SEARCH.test(lower) && primarySearch !== undefined) {
    const base =
      typeof primarySearch === "string"
        ? JSON.stringify(primarySearch.replace(/\s+/g, " ").trim())
        : compactValue(primarySearch);
    return searchScope !== undefined
      ? `${base} in ${compactValue(searchScope)}`
      : base;
  }
  if (ARGS_BASH_RUN.test(lower) && record.command !== undefined) {
    return `$ ${compactText(record.command)}`;
  }
  const preferred = ARGS_GREP.test(lower)
    ? [
        "pattern",
        "query",
        "path",
        "url",
        "file_path",
        "glob",
        "command",
        "title",
        "id",
        "action",
        "content",
      ]
    : ARGS_BASH_RUN.test(lower)
      ? [
          "command",
          "path",
          "action",
          "query",
          "pattern",
          "url",
          "file_path",
          "title",
          "id",
          "content",
        ]
      : ARG_KEYS;
  const ordered = [
    ...preferred
      .filter((key) => record[key] !== undefined)
      .map((key) => [key, record[key]] as const),
    ...Object.entries(record).filter(
      ([key, value]) =>
        value !== undefined && !(preferred as readonly string[]).includes(key),
    ),
  ];
  const summary = ordered
    .slice(0, 3)
    .map(([key, value], index) => {
      const compact = compactValue(value);
      if (
        index === 0 &&
        [
          "path",
          "file_path",
          "url",
          "query",
          "command",
          "title",
          "pattern",
        ].includes(key)
      ) {
        return ["path", "file_path", "url"].includes(key) &&
          typeof value === "string"
          ? compactPathText(value)
          : compact;
      }
      return `${key}=${compact}`;
    })
    .join(" ");
  return truncateArgText(summary);
}

function toolColor(name: string): string {
  if (TASK_LIKE.test(name)) return "toolTitle";
  if (BASH_CLASS_TOOL_PATTERN.test(name)) return "bashMode";
  if (COLOR_READ.test(name)) return "accent";
  if (COLOR_WRITE.test(name)) return "warning";
  if (COLOR_EDIT.test(name)) return "warning";
  if (COLOR_AFK.test(name)) return "toolTitle";
  if (COLOR_LINK.test(name)) return "mdLink";
  return "toolTitle";
}

function displayToolName(name: string): string {
  const lower = name.toLowerCase();
  if (isAfkTool(name)) return "afk";
  if (TASK_LIKE.test(lower)) return "task";
  if (BASH_CLASS_TOOL_PATTERN.test(lower)) return "bash";
  if (DISPLAY_GREP.test(lower)) return "grep";
  if (DISPLAY_READ.test(lower)) {
    return "read";
  }
  if (DISPLAY_WRITE.test(lower)) {
    return "write";
  }
  if (DISPLAY_EDIT.test(lower)) {
    return "edit";
  }
  if (DISPLAY_WEB.test(lower)) {
    return "web";
  }
  const firstSegment = lower.split(/[_-]/).find(Boolean) ?? lower;
  return firstSegment.slice(0, 5) || "tool";
}

function isAfkTool(name: string): boolean {
  return AFK_PREFIX.test(name.toLowerCase());
}

function afkSubcommand(
  name: string,
  args?: Record<string, unknown>,
): string {
  const lower = name.toLowerCase();
  if (lower === "afk") {
    return typeof args?.action === "string"
      ? args.action.replace(/_/g, "-")
      : "";
  }
  return lower.replace(/^afk_/, "").replace(/_/g, "-");
}

function isTaskLikeTool(name: string): boolean {
  return TASK_LIKE.test(name.toLowerCase());
}

/** Tool-name fragments that own a dedicated count summarizer; these must not be pre-empted by the task-like branch. */
const COUNT_SUMMARIZER_PATTERN =
  /read|cat|preview|grep|search|recall|find|list|ls|history|write|create|save|append/;

function renderStatus(
  status: ToolStatus,
  text: string,
  theme: RenderTheme,
): string {
  if (status === "running") {
    return `${theme.fg("accent", Glyph.midDot)} ${theme.fg("muted", text || "running")}`;
  }
  if (status === "error") {
    return `${theme.fg("error", Glyph.failed)} ${theme.fg("error", text || "failed")}`;
  }
  return `${theme.fg("success", Glyph.done)} ${theme.fg("success", text || "done")}`;
}

function countLines(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\r?\n/).length;
}

function compactResultText(text: string): string {
  return truncateArgText(
    text.replace(/\s+/g, " ").trim(),
    MAX_MINIMAL_RESULT_TEXT_CHARS,
  );
}

function isGenericTaskOutput(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "")
    .trim();
  return /^(?:task\s+)?(done|ok|okay|success|succeeded|completed|complete|finished)$/.test(
    normalized,
  );
}

function errorSummary(output: string): string {
  const lower = output.toLowerCase();
  if (lower.includes("not found") || lower.includes("no such file")) {
    return "not found";
  }
  if (lower.includes("timed out")) return "timed out";
  if (lower.includes("aborted")) return "aborted";
  const exit = output.match(/(?:exit(?:ed)?(?: with code)?|code)\s+(\d+)/i);
  return exit ? `exit ${exit[1]}` : "failed";
}

function summarizeDiff(diff: string): string {
  const lines = diff.split(/\r?\n/);
  const added = lines.filter(
    (line) => line.startsWith("+") && !line.startsWith("+++"),
  ).length;
  const removed = lines.filter(
    (line) => line.startsWith("-") && !line.startsWith("---"),
  ).length;
  return `${Glyph.diffAdd}${added} ${Glyph.diffRemove}${removed}`;
}

function summarizeOutput(
  name: string,
  output: string,
  details: Record<string, unknown> | undefined,
): string {
  const diff = details?.diff;
  if (typeof diff === "string" && diff.trim()) return summarizeDiff(diff);

  const lower = name.toLowerCase();
  const trimmed = output.trim();
  const lines = countLines(trimmed);

  const elapsedMs = details?.harnessElapsedMs;
  const durationMs = details?.durationMs ?? details?.elapsedMs;
  const displayMs =
    typeof elapsedMs === "number" && Number.isFinite(elapsedMs)
      ? elapsedMs
      : typeof durationMs === "number" && Number.isFinite(durationMs)
        ? durationMs
        : undefined;
  if (
    isTaskLikeTool(name) &&
    !COUNT_SUMMARIZER_PATTERN.test(lower) &&
    trimmed &&
    !isGenericTaskOutput(trimmed)
  ) {
    const visible = compactResultText(trimmed);
    return displayMs !== undefined
      ? `${visible} · ${Fmt.durationShort(displayMs)}`
      : visible;
  }

  if (displayMs !== undefined && OUT_BASH_DURATION.test(lower)) {
    return Fmt.durationShort(displayMs);
  }

  if (OUT_READ.test(lower)) {
    const truncation = details?.truncation as
      | { outputLines?: number; totalLines?: number }
      | undefined;
    const shown = truncation?.outputLines ?? lines;
    const total = truncation?.totalLines;
    return total && total !== shown
      ? `${shown}/${total} lines`
      : `${shown} lines`;
  }
  if (OUT_GREP.test(lower)) {
    if (/^no matches found$/i.test(trimmed)) return "0 matches";
    return `${lines} ${lines === 1 ? "match" : "matches"}`;
  }
  if (OUT_LIST.test(lower)) {
    return `${lines} ${lines === 1 ? "entry" : "entries"}`;
  }
  if (OUT_WRITE.test(lower)) {
    const lineCount = details?.harnessLineCount;
    if (typeof lineCount === "number" && Number.isFinite(lineCount)) {
      const lines = `${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
      return details?.harnessCreated === true ? `new · ${lines}` : lines;
    }
    const bytes = trimmed.match(/(?:wrote|written|saved)\s+(\d+)\s+bytes/i);
    if (bytes) return `${bytes[1]} bytes`;
    return lines > 1 ? `${lines} lines` : trimmed || "written";
  }

  if (!trimmed) return "done";
  if (lines > 1) return `${lines} lines`;
  return trimmed.length > 72
    ? `${trimmed.slice(0, 71)}${Glyph.ellipsis}`
    : trimmed;
}

function expandedToolOutput(
  output: string,
  details: Record<string, unknown>,
): string {
  const diff = details.diff;
  return typeof diff === "string" && diff.trim() ? diff : output;
}

function renderExpandedLine(line: string, theme: RenderTheme): string {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return theme.fg("toolDiffAdded", line);
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return theme.fg("toolDiffRemoved", line);
  }
  if (line.startsWith("@@")) {
    return theme.fg("accent", line);
  }
  if (line.startsWith("+++") || line.startsWith("---")) {
    return theme.fg("muted", line);
  }
  return theme.fg("toolOutput", line);
}

function lineCountFromArgs(args: unknown): number | undefined {
  if (!args || typeof args !== "object") return undefined;
  const content = (args as { content?: unknown }).content;
  if (typeof content !== "string") return undefined;
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

export function defaultRenderCall(name: string) {
  return (
    args: unknown,
    theme: RenderTheme,
    context: {
      expanded?: boolean;
      executionStarted?: boolean;
      state?: Record<string, unknown>;
    },
  ) => {
    const state = context.state as MinimalToolState | undefined;
    if (state) {
      const boundComponent = (globalThis as HarnessToolBoundGlobal)[
        HARNESS_ASSIGN_TOOL_BOUND_KEY
      ]?.(state, theme);
      if (boundComponent) return boundComponent;
      if (state.harnessHidden) return new EmptyComponent();
    }
    if (context.executionStarted && state && state.startedAt === undefined) {
      state.startedAt = Date.now();
    }
    const argText = summarizeArgs(name, args);
    const label = displayToolName(name);
    const line = Tui.formatRailCall({
      theme,
      verb: label,
      arg: argText || undefined,
      verbColor: toolColor(name),
      inset: MINIMAL_BODY_INSET,
      maxArgChars: MAX_MINIMAL_ARG_TEXT_CHARS,
    });
    const row =
      state?.row instanceof MinimalToolRow
        ? state.row
        : new MinimalToolRow(line);
    row.setLeft(line);
    row.clearMeta();
    row.setSelectedBg(
      context.expanded && theme.bg
        ? (text) => theme.bg?.("selectedBg", text) ?? text
        : undefined,
    );
    if (state) {
      state.row = row;
      state.callLine = line;
    }
    return row;
  };
}

export function defaultRenderResult(name: string) {
  return (
    result: AgentToolResult<unknown>,
    options: ToolRenderResultOptions,
    theme: RenderTheme,
    context: {
      args?: unknown;
      isError?: boolean;
      state?: Record<string, unknown>;
      invalidate?: () => void;
    },
  ) => {
    const output = firstText(result);
    const status: ToolStatus = options.isPartial
      ? "running"
      : context.isError
        ? "error"
        : "success";
    const state = context.state as MinimalToolState | undefined;

    if (options.isPartial) {
      if (context.invalidate && state && !state.interval) {
        const intervalStartedAt = Date.now();
        state.interval = setInterval(() => {
          // Self-expire: if pi never delivers a final render (abandoned
          // call), don't tick a dead component forever.
          if (
            Date.now() - intervalStartedAt > 30 * 60_000 &&
            state.interval !== undefined
          ) {
            clearInterval(state.interval);
            delete state.interval;
            return;
          }
          context.invalidate?.();
        }, TOOL_RENDER_REFRESH_INTERVAL_MS);
      }
    } else {
      if (state?.interval !== undefined) {
        clearInterval(state.interval);
        delete state.interval;
      }
      if (state && state.endedAt === undefined) {
        state.endedAt = Date.now();
      }
    }

    if (state?.harnessHidden) return new EmptyComponent();
    const details = {
      ...((result.details as Record<string, unknown> | undefined) ?? {}),
    };
    const lineCount = lineCountFromArgs(context.args);
    if (lineCount !== undefined) details.harnessLineCount = lineCount;
    if (state?.startedAt !== undefined && state.endedAt !== undefined) {
      details.harnessElapsedMs = Math.max(1, state.endedAt - state.startedAt);
    }
    const summary = summarizeOutput(
      name,
      output,
      status === "error" ? undefined : details,
    );
    const metaSummary =
      status === "running"
        ? `${Glyph.hourglass} ${
            state?.startedAt !== undefined
              ? `${Math.floor((Date.now() - state.startedAt) / 1000)}s`
              : Glyph.ellipsis
          }`
        : status === "error"
          ? errorSummary(output)
          : summary;
    const row = state?.row;
    if (row instanceof MinimalToolRow) {
      const summary = Tui.formatRailResult({
        theme,
        summary: metaSummary,
        status,
      });
      const arrowColor =
        status === "error"
          ? "error"
          : status === "running"
            ? "muted"
            : "success";
      row.setLeft(
        `${state?.callLine ?? ""} ${theme.fg(arrowColor, Glyph.arrow)} ${summary}`,
      );
      row.clearMeta();
    }
    const expandedOutput = expandedToolOutput(output, details).trim();
    if (options.expanded && expandedOutput) {
      const rail = theme.fg("borderMuted", Glyph.railMid);
      const lines = expandedOutput.split(/\r?\n/).slice(0, 80);
      return new MinimalExpandedPanel(
        [
          `   ${rail}`,
          ...lines.map(
            (line) => `   ${rail} ${renderExpandedLine(line, theme)}`,
          ),
          `   ${rail}`,
        ].join("\n"),
        theme.bg
          ? (text) => theme.bg?.("customMessageBg", text) ?? text
          : undefined,
      );
    }
    if (row instanceof MinimalToolRow) {
      return new EmptyComponent();
    }
    return new Text(
      truncateToWidth(`  ${renderStatus(status, metaSummary, theme)}`, 160),
      0,
      0,
    );
  };
}

// Warning template — built from fragments so this file does not contain
// the literal `renderStyle: "custom"` token (the tool-rendering test scans
// for that token to enumerate sanctioned opt-out sites). See docs/dc-style.md.
const CUSTOM_STYLE_OPT_IN = `renderStyle${":"} ${'"'}custom${'"'}`;

export function defaultRenderers<P extends TObject>(def: ToolRegisterDef<P>) {
  const useCustom = def.renderStyle === "custom";
  // Renderer fields are silently dropped without the custom opt-in —
  // surface dead code at registration. See docs/dc-style.md §1, §7.
  if (!useCustom) {
    const dropped: string[] = [];
    if (def.renderCall) dropped.push("renderCall");
    if (def.renderResult) dropped.push("renderResult");
    if (def.renderShell) dropped.push("renderShell");
    if (def.n) dropped.push("n");
    if (dropped.length > 0) {
      logDiag(
        `[dc-framework tool.register] "${def.name}" dead renderer field(s)`,
        `${dropped.join(", ")} ` +
          `ignored without ${CUSTOM_STYLE_OPT_IN}. ` +
          `Remove the unused field(s) or opt in with ${CUSTOM_STYLE_OPT_IN} ` +
          `plus a justification comment. See docs/dc-style.md §7.`,
      );
    }
  }
  return {
    renderCall:
      useCustom && def.renderCall
        ? def.renderCall
        : defaultRenderCall(def.name),
    renderResult:
      useCustom && def.renderResult
        ? def.renderResult
        : defaultRenderResult(def.name),
    renderShell: useCustom ? (def.renderShell ?? def.n ?? "self") : "self",
  };
}
