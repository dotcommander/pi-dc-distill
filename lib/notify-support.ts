/**
 * Notify — owned port of the consumed dc-framework host-channel surface
 * (`lib/notify.ts`): task-shaped wrappers over Pi's user banners, LLM message
 * injection, user-turn injection, and message-renderer registration.
 *
 * One capability: sending transcript/host messages. The TUI block spec
 * surface it formerly carried now lives in `lib/tui-block.ts`; the framework
 * `Block.registerSpec` composition (renderer registration + Block.node) is
 * ported here as `registerBlockSpec`, next to the other renderer wiring.
 *
 * Host-first signatures only: every product call site passes `ctx` or `pi`
 * explicitly (the framework's App-container ambient resolution is not ported;
 * see ADR 0002's Source Baseline).
 *
 * Wire compatibility: notify envelope shapes, turn options, and glyph
 * prefixes are byte-ports of the framework sources.
 *
 * @module lib/notify-support
 */

import { type ExtensionAPI, type MessageRenderer } from "@earendil-works/pi-coding-agent";
import { Block, Glyph, type BlockSpec, type TuiThemeLike } from "./tui-block.ts";

type AnyHost = any; // ExtensionContext | ExtensionAPI; typed loose for lookup probing

// ── Envelope shapes ──────────────────────────────────────────────────────

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

// ── Host method resolution ───────────────────────────────────────────────

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

// ── Notify facade ────────────────────────────────────────────────────────

export const Notify = {
  /**
   * Show a transient banner on the TUI. User-only — the LLM never sees it.
   * Use for status, confirmations, errors that shouldn't pollute model context.
   */
  user(host: AnyHost, message: string, level: NotifyLevel = "info"): void {
    lookup(host, "notify")?.(message, level);
  },

  /** Success confirmation banner: `✓ <message>` (user-only, level "info"). */
  ok(host: AnyHost, message: string): void {
    Notify.user(host, `${Glyph.done} ${message}`, "info");
  },

  /** Failure banner: `✗ <message>` (user-only, level "error"). */
  fail(host: AnyHost, message: string): void {
    Notify.user(host, `${Glyph.failed} ${message}`, "error");
  },

  /** Warning banner: `⚠ <message>` (user-only, level "warning"). */
  warn(host: AnyHost, message: string): void {
    Notify.user(host, `${Glyph.warning} ${message}`, "warning");
  },

  /**
   * Inject text into the conversation as if the assistant wrote it.
   * The LLM sees it on the next turn. Use for tool-result-adjacent context.
   */
  toLLM(host: AnyHost, text: string, options?: LlmOptions): void {
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
   */
  fromUser(host: AnyHost, text: string, options?: FromUserOptions): void {
    lookup(host, "sendUserMessage")?.(text, options);
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
    lookup(host, "registerMessageRenderer")?.(customType, render);
  },
};

// ── Block-spec renderer registration ─────────────────────────────────────

function rendererErrorSpec() {
  return {
    kind: "banner" as const,
    title: "Render error",
    state: "error" as const,
    body: ["This output could not be rendered."],
  };
}

/**
 * Register a renderer for a FEATURE `customType` backed by a BlockSpec
 * factory. A failing factory renders the error banner instead of wedging
 * the TUI. Port of `Block.registerSpec` from the framework output facade.
 */
export function registerBlockSpec<TDetails = unknown>(
  pi: ExtensionAPI,
  customType: string,
  factory: (
    message: { content: string; details?: TDetails },
    options: { expanded?: boolean },
  ) => BlockSpec,
): void {
  Notify.renderer(pi, customType, ((
    message: { content: string; details?: TDetails },
    options: { expanded?: boolean },
    theme: TuiThemeLike,
  ) => {
    try {
      return Block.node(factory(message, options), theme);
    } catch (error) {
      if (process.env.PI_DEBUG) {
        try {
          const msg = error instanceof Error ? error.message : String(error);
          process.stderr.write(
            `[block.registerSpec] BlockSpec factory failed for ${customType}: ${msg}\n`,
          );
        } catch {
          // Swallowed: stderr writes must never poison rendering.
        }
      }
      return Block.node(rendererErrorSpec(), theme);
    }
  }) as unknown as MessageRenderer<TDetails>);
}
