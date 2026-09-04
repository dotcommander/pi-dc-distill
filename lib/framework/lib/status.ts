/**
 * Status facade — keyed status/widget helpers with scoped cleanup.
 *
 * @module dc-framework/lib/status
 */

import type { ExtensionAPI, ExtensionContext } from "../pi/coding-agent";
import { Guard } from "./guard.ts";
import { createSinkSlot, matchText, type Matcher } from "./_fake.ts";
import { ctx as appCtx } from "./_app.ts";

const sinkSlot = createSinkSlot();

export interface StatusFake {
  assertSet(id: string, m?: Matcher): void;
  assertCleared(id: string): void;
  assertWorking(m?: Matcher): void;
  restore(): void;
}

type WidgetContent = string[] | ((...args: any[]) => any) | undefined;
type WidgetOptions = unknown;

export interface StatusAttachOptions {
  clearOnShutdown?: boolean;
  clearOnSessionStart?: boolean;
}

export interface StatusScope {
  readonly id: string;
  set(ctx: ExtensionContext, text: string | undefined): StatusScope;
  clear(ctx?: ExtensionContext): StatusScope;
  widget(
    ctx: ExtensionContext,
    content: WidgetContent,
    opts?: WidgetOptions,
  ): StatusScope;
  clearWidget(ctx?: ExtensionContext): StatusScope;
  workingMessage(ctx: ExtensionContext, text?: string): StatusScope;
  workingVisible(ctx: ExtensionContext, visible: boolean): StatusScope;
  title(ctx: ExtensionContext, title: string | undefined): StatusScope;
  clearAll(ctx?: ExtensionContext): StatusScope;
}

const scopes = new WeakMap<ExtensionAPI, Map<string, StatusScope>>();

function hasUi(ctx: ExtensionContext | undefined): ctx is ExtensionContext {
  return ctx?.hasUI === true && ctx.ui !== undefined;
}

function makeScope(
  pi: ExtensionAPI,
  id: string,
  opts: StatusAttachOptions,
): StatusScope {
  let lastCtx: ExtensionContext | undefined;

  const remember = (ctx: ExtensionContext): boolean => {
    if (!hasUi(ctx)) return false;
    lastCtx = ctx;
    return true;
  };

  const target = (ctx?: ExtensionContext): ExtensionContext | undefined => {
    const candidate = ctx ?? lastCtx;
    return hasUi(candidate) ? candidate : undefined;
  };

  const scope: StatusScope = {
    id,
    set(ctx, text) {
      if (sinkSlot.tap(text === undefined ? "cleared" : "set", [id, text]))
        return scope;
      if (!remember(ctx)) return scope;
      ctx.ui.setStatus(id, text);
      return scope;
    },
    clear(ctx) {
      if (sinkSlot.tap("cleared", [id])) return scope;
      target(ctx)?.ui.setStatus(id, undefined);
      return scope;
    },
    widget(ctx, content, widgetOpts) {
      if (sinkSlot.tap("widget", [id, content, widgetOpts])) return scope;
      if (!remember(ctx)) return scope;
      ctx.ui.setWidget(id, content as any, widgetOpts as any);
      return scope;
    },
    clearWidget(ctx) {
      if (sinkSlot.tap("widget", [id, undefined])) return scope;
      target(ctx)?.ui.setWidget(id, undefined);
      return scope;
    },
    workingMessage(ctx, text) {
      if (sinkSlot.tap("working", [text])) return scope;
      if (!remember(ctx)) return scope;
      ctx.ui.setWorkingMessage(text);
      return scope;
    },
    workingVisible(ctx, visible) {
      if (sinkSlot.tap("workingVisible", [visible])) return scope;
      if (!remember(ctx)) return scope;
      ctx.ui.setWorkingVisible(visible);
      return scope;
    },
    title(ctx, title) {
      if (sinkSlot.tap("title", [title])) return scope;
      if (!remember(ctx) || title === undefined) return scope;
      ctx.ui.setTitle(title);
      return scope;
    },
    clearAll(ctx) {
      if (sinkSlot.tap("cleared", [id])) return scope;
      const t = target(ctx);
      if (!t) return scope;
      t.ui.setStatus(id, undefined);
      t.ui.setWidget(id, undefined);
      return scope;
    },
  };

  if (opts.clearOnShutdown ?? true) {
    pi.on(
      "session_shutdown",
      Guard.hook(
        async (_event: unknown, ctx: ExtensionContext) => {
          scope.clearAll(ctx);
        },
        { label: `status:${id}:shutdown` },
      ),
    );
  }

  if (opts.clearOnSessionStart ?? false) {
    pi.on(
      "session_start",
      Guard.hook(
        async (_event: unknown, ctx: ExtensionContext) => {
          scope.clearAll(ctx);
        },
        { label: `status:${id}:session_start` },
      ),
    );
  }

  return scope;
}

export interface StatusOverloads {
  scope(pi: ExtensionAPI, id: string, opts?: StatusAttachOptions): StatusScope;
  set(id: string, text: string | undefined): void;
  set(ctx: ExtensionContext, id: string, text: string | undefined): void;
  widget(
    ctx: ExtensionContext,
    id: string,
    content: WidgetContent,
    opts?: WidgetOptions,
  ): void;
  fake(): StatusFake;
}

export const Status: StatusOverloads = {
  scope(
    pi: ExtensionAPI,
    id: string,
    opts: StatusAttachOptions = {},
  ): StatusScope {
    let byId = scopes.get(pi);
    if (!byId) {
      byId = new Map();
      scopes.set(pi, byId);
    }
    const existing = byId.get(id);
    if (existing) return existing;
    const scope = makeScope(pi, id, opts);
    byId.set(id, scope);
    return scope;
  },

  /**
   * Set or clear a status by id.
   * Omitting ctx resolves it from the App container.
   */
  set(
    a: ExtensionContext | string,
    b: string | undefined,
    c?: string | undefined,
  ): void {
    const ambient = typeof a === "string";
    const id = (ambient ? a : b) as string;
    const text = (ambient ? b : c) as string | undefined;
    if (sinkSlot.tap(text === undefined ? "cleared" : "set", [id, text]))
      return;
    const c2 = ambient ? appCtx() : (a as ExtensionContext);
    if (!hasUi(c2)) return;
    c2.ui.setStatus(id, text);
  },

  widget(
    ctx: ExtensionContext,
    id: string,
    content: WidgetContent,
    opts?: WidgetOptions,
  ): void {
    if (sinkSlot.tap("widget", [id, content, opts])) return;
    if (!hasUi(ctx)) return;
    ctx.ui.setWidget(id, content as any, opts as any);
  },

  fake(): StatusFake {
    const { sink, restore } = sinkSlot.install();
    const handle: StatusFake = {
      assertSet: (id, m) => {
        const hit = sink
          .byMethod("set")
          .some((r) => r.args[0] === id && matchText(String(r.args[1]), m));
        if (!hit)
          throw new Error(
            `Expected a status set on ${JSON.stringify(id)} matching ${m ?? "anything"}`,
          );
      },
      assertCleared: (id) => {
        const hit = sink.byMethod("cleared").some((r) => r.args[0] === id);
        if (!hit)
          throw new Error(
            `Expected status ${JSON.stringify(id)} to be cleared`,
          );
      },
      assertWorking: (m) => {
        const hit = sink
          .byMethod("working")
          .some((r) => matchText(String(r.args[0] ?? ""), m));
        if (!hit)
          throw new Error(
            `Expected a working message matching ${m ?? "anything"}`,
          );
      },
      restore,
    };
    return handle;
  },
};
