import type { Component } from "../pi/tui.ts";
import { visibleWidth, wrapTextWithAnsi } from "../pi/tui.ts";
import {
  Tui,
  type TuiThemeLike,
  type TuiTone,
  type TuiVisualState,
} from "./_tui.ts";

export interface PanelAction {
  key: string;
  label: string;
  compactLabel?: string;
}

export type PanelRow =
  | { kind: "section"; label: string; meta?: string }
  | {
      kind: "item";
      label: string;
      description?: string;
      trailing?: string;
      state?: TuiVisualState;
      selected?: boolean;
      indent?: number;
    }
  | { kind: "text"; text: string; tone?: TuiTone; indent?: number }
  | { kind: "spacer" };

export type PanelBody =
  | { kind: "rows"; rows: readonly PanelRow[]; minRows?: number }
  | {
      kind: "empty" | "loading" | "error";
      message: string;
      detail?: string;
      minRows?: number;
    };

export interface PanelSpec {
  title: string;
  subtitle?: string;
  body: PanelBody;
  actions?: readonly PanelAction[];
  maxWidth?: number;
  margin?: number;
}

function band(
  theme: TuiThemeLike,
  color: "customMessageBg" | "selectedBg",
  text: string,
  width: number,
): string {
  const fitted = Tui.fitLine(text, width);
  return theme.bg ? theme.bg(color, fitted) : fitted;
}

function renderItem(
  row: Extract<PanelRow, { kind: "item" }>,
  theme: TuiThemeLike,
  width: number,
): string[] {
  const indent = " ".repeat(Math.max(0, row.indent ?? 0));
  const mark = Tui.formatStateMark({ theme, state: row.state ?? "neutral" });
  const selection = row.selected ? `${theme.fg("accent", "▸")} ` : "";
  const prefix = `${indent}${mark} ${selection}`;
  const trailing = row.trailing ? `  ${theme.fg("muted", row.trailing)}` : "";
  const labelRoom = Math.max(1, width - visibleWidth(prefix));
  let primary = `${prefix}${theme.fg(row.selected ? "accent" : "text", row.label)}`;
  if (row.trailing && visibleWidth(primary) + visibleWidth(trailing) <= width) {
    const gap = " ".repeat(width - visibleWidth(primary) - visibleWidth(trailing));
    primary = `${primary}${gap}${trailing}`;
  }
  const lines = [Tui.fitLine(primary, width)];
  if (row.description && labelRoom > 0) {
    const hanging = " ".repeat(visibleWidth(prefix));
    const descriptionWidth = Math.max(1, width - visibleWidth(hanging));
    for (const line of wrapTextWithAnsi(row.description, descriptionWidth)) {
      lines.push(Tui.fitLine(`${hanging}${theme.fg("muted", line)}`, width));
    }
  }
  return row.selected
    ? lines.map((line) => band(theme, "selectedBg", line, width))
    : lines;
}

function renderRows(
  rows: readonly PanelRow[],
  theme: TuiThemeLike,
  width: number,
): string[] {
  return rows.flatMap((row) => {
    switch (row.kind) {
      case "spacer":
        return [" ".repeat(width)];
      case "section": {
        const label = theme.fg("accent", theme.bold ? theme.bold(row.label) : row.label);
        const meta = row.meta ? `  ${theme.fg("muted", row.meta)}` : "";
        return [Tui.fitLine(`${label}${meta}`, width)];
      }
      case "text": {
        const indent = " ".repeat(Math.max(0, row.indent ?? 0));
        const available = Math.max(1, width - visibleWidth(indent));
        return wrapTextWithAnsi(row.text, available).map((line) =>
          Tui.fitLine(`${indent}${theme.fg(row.tone ?? "text", line)}`, width),
        );
      }
      case "item":
        return renderItem(row, theme, width);
    }
  });
}

function bodyLines(body: PanelBody, theme: TuiThemeLike, width: number): string[] {
  if (body.kind === "rows") return renderRows(body.rows, theme, width);
  const state: TuiVisualState =
    body.kind === "loading" ? "running" : body.kind === "error" ? "error" : "neutral";
  const line = `${Tui.formatStateMark({ theme, state })} ${theme.fg(
    body.kind === "error" ? "error" : "text",
    body.message,
  )}`;
  return [
    Tui.fitLine(line, width),
    ...(body.detail
      ? wrapTextWithAnsi(body.detail, width).map((part) =>
          Tui.fitLine(theme.fg("muted", part), width),
        )
      : []),
  ];
}

function renderPanel(
  spec: PanelSpec,
  theme: TuiThemeLike,
  viewportWidth: number,
): string[] {
  const normalizedViewportWidth = Number.isFinite(viewportWidth)
    ? Math.max(0, Math.floor(viewportWidth))
    : 0;
  if (normalizedViewportWidth === 0) return [];
  const preferredMargin = Number.isFinite(spec.margin)
    ? Math.max(0, Math.floor(spec.margin ?? 4))
    : 4;
  const margin = Math.min(
    preferredMargin,
    Math.floor(Math.max(0, normalizedViewportWidth - 1) / 2),
  );
  const preferredWidth = Number.isFinite(spec.maxWidth)
    ? Math.max(1, Math.floor(spec.maxWidth ?? 84))
    : 84;
  const panelWidth = Math.max(
    1,
    Math.min(preferredWidth, normalizedViewportWidth - margin * 2),
  );
  const left = Math.floor((normalizedViewportWidth - panelWidth) / 2);
  const place = (line: string) => `${" ".repeat(left)}${Tui.fitLine(line, panelWidth)}`;
  const title = theme.fg("accent", theme.bold ? theme.bold(spec.title) : spec.title);
  const subtitle = spec.subtitle ? `  ${theme.fg("muted", spec.subtitle)}` : "";
  const lines = [place(band(theme, "customMessageBg", `${title}${subtitle}`, panelWidth))];
  const body = bodyLines(spec.body, theme, panelWidth);
  const minRows = Math.max(0, spec.body.minRows ?? 0);
  while (body.length < minRows) body.push(" ".repeat(panelWidth));
  lines.push(...body.map(place));
  if (spec.actions?.length) {
    const footer = Tui.formatKeyHints({
      theme,
      hints: spec.actions,
      width: panelWidth,
    });
    lines.push(place(band(theme, "customMessageBg", footer, panelWidth)));
  }
  return lines;
}

export const Panel = {
  render: renderPanel,
  node(spec: PanelSpec, theme: TuiThemeLike): Component {
    return {
      render(width: number): string[] {
        return renderPanel(spec, theme, width);
      },
      invalidate(): void {},
    };
  },
};
