/** Typed low-level compatibility boundary over Pi's Extension UI host. */
import type {
  ExtensionUIContext,
  ExtensionWidgetOptions,
  KeybindingsManager,
  ReadonlyFooterDataProvider,
  Theme,
  WorkingIndicatorOptions,
} from "../pi/coding-agent.ts";
import type { Component, TUI } from "../pi/tui.ts";

type DisposableComponent = Component & { dispose?(): void };
type UiDone<T> = (result?: T) => void;
type UiRender<T> = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: UiDone<T>,
) => DisposableComponent | Promise<DisposableComponent>;
type UiCustomOptions = Parameters<ExtensionUIContext["custom"]>[1];
type EditorFactory = Parameters<ExtensionUIContext["setEditorComponent"]>[0];
type FooterFactory = (
  tui: TUI,
  theme: Theme,
  footerData: ReadonlyFooterDataProvider,
) => DisposableComponent;
type HeaderFactory = (tui: TUI, theme: Theme) => DisposableComponent;
type WidgetContent =
  | string[]
  | ((tui: TUI, theme: Theme) => DisposableComponent)
  | undefined;

type UiHost = Partial<ExtensionUIContext>;
type UiContext = object;

function host(ctx: UiContext): UiHost {
  const wrapped = ctx as { ui?: UiHost };
  return (wrapped.ui ?? ctx) as UiHost;
}

export const Ui = {
  custom<T = void>(
    ctx: UiContext,
    render: UiRender<T>,
    options?: UiCustomOptions,
  ): Promise<T> {
    const custom = host(ctx).custom;
    if (!custom) return Promise.reject(new Error("Pi UI custom() is unavailable"));
    return custom(render as never, options) as Promise<T>;
  },

  theme(ctx: UiContext): Theme {
    return host(ctx).theme as Theme;
  },

  setTheme(ctx: UiContext, theme: string | Theme): { success: boolean; error?: string } {
    return host(ctx).setTheme?.(theme) ?? { success: false };
  },

  setFooter(ctx: UiContext, footer: FooterFactory | undefined): void {
    host(ctx).setFooter?.(footer);
  },

  setHeader(ctx: UiContext, header: HeaderFactory | undefined): void {
    host(ctx).setHeader?.(header);
  },

  setStatus(ctx: UiContext, key: string, text: string | undefined): void {
    host(ctx).setStatus?.(key, text);
  },

  setTitle(ctx: UiContext, title: string): void {
    host(ctx).setTitle?.(title);
  },

  setWidget(
    ctx: UiContext,
    key: string,
    widget: WidgetContent,
    options?: ExtensionWidgetOptions,
  ): void {
    const setWidget = host(ctx).setWidget;
    if (setWidget) setWidget(key, widget as never, options);
  },

  setEditorComponent(ctx: UiContext, component: EditorFactory | undefined): void {
    host(ctx).setEditorComponent?.(component);
  },

  setWorkingIndicator(ctx: UiContext, indicator?: WorkingIndicatorOptions): void {
    host(ctx).setWorkingIndicator?.(indicator);
  },

  setWorkingVisible(ctx: UiContext, visible: boolean): void {
    host(ctx).setWorkingVisible?.(visible);
  },

  setToolsExpanded(ctx: UiContext, expanded: boolean): void {
    host(ctx).setToolsExpanded?.(expanded);
  },

  getToolsExpanded(ctx: UiContext): boolean {
    return Boolean(host(ctx).getToolsExpanded?.());
  },

  setHiddenThinkingLabel(ctx: UiContext, label: string): void {
    host(ctx).setHiddenThinkingLabel?.(label);
  },
};

export type { UiContext, UiRender };
