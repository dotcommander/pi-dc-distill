/**
 * Notify facade — task-shaped wrapper around pi's four output surfaces.
 *
 * Each method names its audience so callers can't confuse user-only banners
 * with LLM-visible messages.
 *
 * Surface ownership in pi:
 *   notify         — ctx.ui.notify(...)         (user-only TUI banner)
 *   setEditorText  — ctx.ui.setEditorText(...)  (user input box)
 *   sendMessage    — pi.sendMessage(...)        (LLM as assistant text)
 *   sendUserMessage— pi.sendUserMessage(...)    (LLM as fresh user turn)
 *
 * `ctx` is `ExtensionContext` (passed to handlers); `pi` is `ExtensionAPI`
 * (passed to the registration function and captured in handler closures).
 *
 * Each Notify method accepts EITHER object — we look the method up on the
 * host and on `host.ui`. Callers pass whichever they have at hand: in a
 * `registerCommand` handler that's typically `cmdCtx` for user/toEditor and
 * `pi` for toLLM/fromUser, but mixing is fine.
 *
 * Invariant: one cache entry per (host, name) pair. WeakMap key is the host
 * object so entries are GC-eligible when the host is released. Null sentinel
 * means "not a function"; avoids re-probing on miss. Host mutation post-first-
 * lookup is not detected — acceptable given framework lifecycle.
 *
 * @module dc-framework/lib/notify
 */

import {
  createSinkSlot,
  assertMatch,
  assertNone,
  type Matcher,
  type FakeRecord,
} from "./_fake.ts";
import { ctx, pi, isBooted } from "./_app.ts";
import { Glyph } from "./_glyphs.ts";

type AnyHost = any; // ExtensionContext | ExtensionAPI; typed loose so this file is non-pi-runtime importable

const sinkSlot = createSinkSlot();

export interface NotifyFake {
  assertSentToUser(m?: Matcher): void;
  assertDisplayed(m?: Matcher): void;
  assertRendererRegistered(m?: Matcher): void;
  assertSentToLLM(m?: Matcher): void;
  assertSentToEditor(m?: Matcher): void;
  assertSentFromUser(m?: Matcher): void;
  assertSentToLLMOnly(m?: Matcher): void;
  assertNothingSent(): void;
  sent(
    channel?:
      | "user"
      | "display"
      | "renderer"
      | "toLLM"
      | "toEditor"
      | "fromUser"
      | "toLLMOnly",
  ): FakeRecord[];
  restore(): void;
}

// pi's accepted set; see dist/core/extensions/types.d.ts NotificationContext.notify
export type NotifyLevel = "info" | "warning" | "error";

export interface FromUserOptions {
  deliverAs?: "followUp" | "steer";
}

export interface DisplayOptions {
  customType?: string;
  details?: unknown;
  triggerTurn?: boolean;
  deliverAs?: "followUp" | "steer" | "nextTurn";
}

export type LlmOptions = DisplayOptions;

export interface PiMessageEnvelope {
  content: string;
  display: boolean;
}

export interface PiCustomMessageEnvelope extends PiMessageEnvelope {
  customType: string;
  details?: unknown;
}

export interface PiSendMessageOptions {
  triggerTurn: boolean;
  deliverAs?: "followUp" | "steer" | "nextTurn";
}

export function llmMessageEnvelope(
  text: string,
  options: { customType?: string; details?: unknown } = {},
): PiMessageEnvelope | PiCustomMessageEnvelope {
  if (options.customType || options.details !== undefined) {
    return customMessageEnvelope(options.customType ?? "dc-llm-message", text, {
      display: false,
      details: options.details,
    });
  }
  return { content: text, display: false };
}

export function customMessageEnvelope(
  customType: string,
  content: string,
  options: { display?: boolean; details?: unknown } = {},
): PiCustomMessageEnvelope {
  return {
    customType,
    content,
    display: options.display ?? false,
    ...(options.details === undefined ? {} : { details: options.details }),
  };
}

export function messageTurnOptions(
  triggerTurn = false,
  deliverAs?: PiSendMessageOptions["deliverAs"],
): PiSendMessageOptions {
  return deliverAs === undefined ? { triggerTurn } : { triggerTurn, deliverAs };
}

// Cache: WeakMap allows GC when host is released. null = confirmed non-function.
const _hostCache = new WeakMap<
  object,
  Map<string, ((...args: any[]) => any) | null>
>();

function _resolve(
  host: object,
  name: string,
): ((...args: any[]) => any) | null {
  if ((host as any)[name] != null && typeof (host as any)[name] === "function")
    return (host as any)[name].bind(host);
  if (
    (host as any).ui?.[name] != null &&
    typeof (host as any).ui[name] === "function"
  )
    return (host as any).ui[name].bind((host as any).ui);
  return null;
}

function lookup(
  host: AnyHost,
  name: string,
): ((...args: any[]) => any) | undefined {
  // Null/primitive hosts can't be WeakMap keys — fall through to direct probe.
  if (host == null || typeof host !== "object") {
    if (typeof host?.[name] === "function") return host[name].bind(host);
    if (typeof host?.ui?.[name] === "function")
      return host.ui[name].bind(host.ui);
    return undefined;
  }
  let names = _hostCache.get(host);
  if (names === undefined) {
    names = new Map();
    _hostCache.set(host, names);
  }
  if (!names.has(name)) names.set(name, _resolve(host, name));
  return names.get(name) ?? undefined;
}

const bootedPi = (): AnyHost | undefined => (isBooted() ? pi() : undefined);
// user-facing: request-scope ctx wins over the booted pi host
const ambientUserHost = (): AnyHost | undefined => ctx() ?? bootedPi();
// LLM-facing: booted pi host wins over request-scope ctx
const ambientLlmHost = (): AnyHost | undefined => bootedPi() ?? ctx();

export interface NotifyOverloads {
  user(message: string, level?: NotifyLevel): void;
  user(host: AnyHost, message: string, level?: NotifyLevel): void;
  ok(message: string): void;
  ok(host: AnyHost, message: string): void;
  fail(message: string): void;
  fail(host: AnyHost, message: string): void;
  warn(message: string): void;
  warn(host: AnyHost, message: string): void;
  display(text: string, options?: DisplayOptions): void;
  display(host: AnyHost, text: string, options?: DisplayOptions): void;
  renderer(
    host: AnyHost,
    customType: string,
    render: (...args: any[]) => unknown,
  ): void;
  toLLM(text: string, options?: LlmOptions): void;
  toLLM(host: AnyHost, text: string, options?: LlmOptions): void;
  fromUser(text: string, options?: FromUserOptions): void;
  fromUser(host: AnyHost, text: string, options?: FromUserOptions): void;
  toEditor(text: string): void;
  toEditor(host: AnyHost, text: string): void;
  toLLMOnly(addContext: unknown, text: string): void;
  fake(): NotifyFake;
}

export const Notify: NotifyOverloads = {
  /**
   * Show a transient banner on the TUI. User-only — the LLM never sees it.
   * Use for status, confirmations, errors that shouldn't pollute model context.
   *
   * First arg a string ⇒ ambient form (host resolved from the App container).
   */
  user(a: AnyHost | string, b?: string | NotifyLevel, c?: NotifyLevel): void {
    const ambient = typeof a === "string";
    const message = (ambient ? a : b) as string;
    const level = (ambient ? b : c) as NotifyLevel | undefined;
    if (sinkSlot.tap("user", [message, level])) return;
    const host = ambient ? ambientUserHost() : (a as AnyHost);
    lookup(host, "notify")?.(message, level ?? "info");
  },

  /**
   * Success confirmation banner: `✓ <message>` (user-only, level "info").
   * Prefer this over hand-rolling a ✓/✅ prefix so success styling is uniform.
   */
  ok(a: AnyHost | string, b?: string): void {
    const ambient = typeof a === "string";
    const message = (ambient ? a : b) as string;
    const styled = `${Glyph.done} ${message}`;
    if (ambient) Notify.user(styled, "info");
    else Notify.user(a as AnyHost, styled, "info");
  },

  /**
   * Failure banner: `✗ <message>` (user-only, level "error").
   * Prefer this over hand-rolling ✗/❌/`Error:`/`… failed:` prefixes.
   */
  fail(a: AnyHost | string, b?: string): void {
    const ambient = typeof a === "string";
    const message = (ambient ? a : b) as string;
    const styled = `${Glyph.failed} ${message}`;
    if (ambient) Notify.user(styled, "error");
    else Notify.user(a as AnyHost, styled, "error");
  },

  /**
   * Warning banner: `⚠ <message>` (user-only, level "warning").
   */
  warn(a: AnyHost | string, b?: string): void {
    const ambient = typeof a === "string";
    const message = (ambient ? a : b) as string;
    const styled = `${Glyph.warning} ${message}`;
    if (ambient) Notify.user(styled, "warning");
    else Notify.user(a as AnyHost, styled, "warning");
  },

  /**
   * Add visible transcript output without starting a new model turn.
   * Use for command/report results that should look like normal conversation
   * output instead of a transient info notification.
   */
  display(
    a: AnyHost | string,
    b?: string | DisplayOptions,
    c?: DisplayOptions,
  ): void {
    const ambient = typeof a === "string";
    const text = (ambient ? a : b) as string;
    const options = (ambient ? b : c) as DisplayOptions | undefined;
    if (sinkSlot.tap("display", [text, options])) return;
    const host = ambient ? ambientLlmHost() : (a as AnyHost);
    lookup(host, "sendMessage")?.(
      customMessageEnvelope(options?.customType ?? "dc-display-message", text, {
        display: true,
        details: options?.details,
      }),
      messageTurnOptions(options?.triggerTurn ?? false, options?.deliverAs),
    );
  },

  /**
   * Register a renderer for a custom transcript message type.
   * Use with `display`/`toLLM` customType values when default markdown
   * rendering is too dim or semantically wrong for command output.
   */
  renderer(
    host: AnyHost,
    customType: string,
    render: (...args: any[]) => unknown,
  ): void {
    if (sinkSlot.tap("renderer", [customType, render])) return;
    lookup(host, "registerMessageRenderer")?.(customType, render);
  },

  /**
   * Inject text into the conversation as if the assistant wrote it.
   * The LLM sees it on the next turn. Use for tool-result-adjacent context.
   *
   * First arg a string ⇒ ambient form (host resolved from the App container).
   */
  toLLM(a: AnyHost | string, b?: string | LlmOptions, c?: LlmOptions): void {
    const ambient = typeof a === "string";
    const text = (ambient ? a : b) as string;
    const options = (ambient ? b : c) as LlmOptions | undefined;
    if (sinkSlot.tap("toLLM", [text, options])) return;
    const host = ambient ? ambientLlmHost() : (a as AnyHost);
    lookup(host, "sendMessage")?.(
      llmMessageEnvelope(text, {
        customType: options?.customType,
        details: options?.details,
      }),
      messageTurnOptions(options?.triggerTurn ?? false, options?.deliverAs),
    );
  },

  /**
   * Inject text as a fresh user turn. Triggers a new model response.
   * Use to re-prompt the model on the user's behalf.
   *
   * First arg a string ⇒ ambient form (host resolved from the App container).
   */
  fromUser(
    a: AnyHost | string,
    b?: string | FromUserOptions,
    c?: FromUserOptions,
  ): void {
    const ambient = typeof a === "string";
    const text = (ambient ? a : b) as string;
    const options = (ambient ? b : c) as FromUserOptions | undefined;
    if (sinkSlot.tap("fromUser", [text])) return;
    const host = ambient ? ambientLlmHost() : (a as AnyHost);
    lookup(host, "sendUserMessage")?.(text, options);
  },

  /**
   * Paste text into the user's input box. The user sees it pre-filled
   * and can edit/send. Use for draft generation, error-recovery prompts.
   *
   * First arg a string ⇒ ambient form (host resolved from the App container).
   */
  toEditor(a: AnyHost | string, b?: string): void {
    const ambient = typeof a === "string";
    const text = (ambient ? a : b) as string;
    if (sinkSlot.tap("toEditor", [text])) return;
    const host = ambient ? ambientUserHost() : (a as AnyHost);
    lookup(host, "setEditorText")?.(text);
  },

  /**
   * Inject text into pi's LLM-only context channel. The user never sees it.
   *
   * Mechanism: calls pi's hook-context-adder callable (`addContext`) — the same
   * channel used by skilldex/KB auto-injection. Compare with the other surfaces:
   * `user` → TUI banner (user only), `toLLM` → assistant turn, `fromUser` →
   * fresh user turn, `toEditor` → user input box.
   *
   * The `addContext` argument is the raw callable pi passes as the second extra
   * arg to certain hook handlers, captured by `dc-framework/x/events.ts` as
   * `EventsHandlerArgs.addContext`. Passing it directly (instead of a host
   * object) is the type-level signal that this method only works inside hook
   * handlers that receive it.
   *
   * Confirmed supported events: `beforeAgentStart`, `context` (verified callers
   * include `dc-knowledge/index.ts:451`).
   * Unconfirmed but plausible: `tool_call`, `tool_result` —
   * `dc-framework/x/events.ts:83` maps `rest[0] → addContext` for every event,
   * but only the two above are verified callers.
   *
   * No-ops silently when `addContext` is not a function (event type didn't
   * expose the channel).
   */
  toLLMOnly(addContext: unknown, text: string): void {
    if (sinkSlot.tap("toLLMOnly", [addContext, text])) return;
    if (typeof addContext === "function") addContext(text);
  },

  fake(): NotifyFake {
    const { sink, restore } = sinkSlot.install();
    const handle: NotifyFake = {
      assertSentToUser: (m) =>
        assertMatch(sink.byMethod("user"), "notification to user", m),
      assertDisplayed: (m) =>
        assertMatch(sink.byMethod("display"), "display notification", m),
      assertRendererRegistered: (m) =>
        assertMatch(sink.byMethod("renderer"), "message renderer", m),
      assertSentToLLM: (m) =>
        assertMatch(sink.byMethod("toLLM"), "notification to LLM", m),
      assertSentToEditor: (m) =>
        assertMatch(sink.byMethod("toEditor"), "notification to editor", m),
      assertSentFromUser: (m) =>
        assertMatch(sink.byMethod("fromUser"), "notification from user", m),
      assertSentToLLMOnly: (m) =>
        assertMatch(sink.byMethod("toLLMOnly"), "notification to LLM-only", m),
      assertNothingSent: () => assertNone(sink.records, "notification"),
      sent: (channel) =>
        channel === undefined ? sink.records : sink.byMethod(channel),
      restore,
    };
    return handle;
  },
};
