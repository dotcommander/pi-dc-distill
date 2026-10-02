/**
 * Events facade — owned port of the consumed dc-framework interceptor-hook
 * surface (`x/events.ts`).
 *
 * Consumed set only (Source Baseline): `Events.{beforeCompact, context,
 * toolResult}` registrations plus the `{cancelCompact, compact, messages,
 * toolPatch}` result factories and their payload types. The framework's
 * `input` / `beforeAgentStart` / `toolCall` registrations and `register` /
 * `on` escape hatches are not consumed and not ported.
 *
 * Guard semantics are inlined from dc-framework `lib/guard.ts` (hook mode):
 *   • `context` / `toolResult`: a handler throw is reported and recovers to
 *     `undefined` (Pi keeps its default behavior).
 *   • `beforeCompact`: recovery rethrows, and the registration wrapper
 *     converts any failure into `{ cancel: true }` so a compiler failure
 *     never falls through to Pi's default LLM compactor.
 *
 * Deviation (recorded): the framework Guard appended failures to
 * `~/.pi/data/dc-framework/guard-errors.log`. That namespace is deleted with
 * the framework; owned recovery reports through `opts.onError` when provided
 * and otherwise mirrors to stderr only under `PI_DEBUG`. Handler outcomes are
 * wire-identical.
 *
 * @module lib/events-support
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface EventsOptions {
  label?: string;
  onError?: (err: unknown) => void;
  filter?: (err: Error) => boolean;
}

export interface EventsHandlerArgs<E = any> {
  event: E;
  ctx: ExtensionContext;
  addContext?: unknown;
  rest: unknown[];
}

export type EventsHandler<E = any, R = unknown> = (
  args: EventsHandlerArgs<E>,
) => R | Promise<R>;

export interface ContextInterceptResult {
  messages: unknown[];
}

export interface ToolResultPatch {
  content?: unknown;
  structuredContent?: unknown;
  details?: unknown;
  isError?: boolean;
}

export interface CompactSummary {
  summary: string;
  firstKeptEntryId?: string;
  tokensBefore?: number;
  details?: unknown;
}

export type CompactInterceptResult =
  | { cancel: true }
  | { compaction: CompactSummary };

function guardOptions(
  event: string,
  opts: EventsOptions = {},
): { label: string; onError?: (err: unknown) => void; filter?: (err: Error) => boolean } {
  return {
    label: opts.label ?? event,
    onError: opts.onError,
    filter: opts.filter,
  };
}

function report(
  label: string,
  err: unknown,
  opts: { onError?: (err: unknown) => void; filter?: (err: Error) => boolean },
): void {
  if (opts.filter && err instanceof Error && opts.filter(err)) return;
  if (opts.onError) {
    opts.onError(err);
    return;
  }
  if (process.env.PI_DEBUG) {
    try {
      const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
      process.stderr.write(`[Guard:hook:${label}] ${msg}\n`);
    } catch {
      // Swallowed: stderr writes must never poison recovery.
    }
  }
}

function rawOn(
  pi: ExtensionAPI,
  event: string,
  handler: (...args: any[]) => any,
): void {
  (pi as unknown as { on(event: string, handler: (...args: any[]) => any): void }).on(event, handler);
}

function registerStructured<E, R>(
  pi: ExtensionAPI,
  eventName: string,
  handler: EventsHandler<E, R>,
  opts: EventsOptions | undefined,
): void {
  const { label, onError, filter } = guardOptions(eventName, opts);
  rawOn(pi, eventName, async (event: E, ctx: ExtensionContext, ...rest: unknown[]) => {
    try {
      return await handler({ event, ctx, addContext: rest[0], rest });
    } catch (err) {
      report(label, err, { onError, filter });
      return undefined;
    }
  });
}

export const Events = {
  /**
   * Register the `session_before_compact` interceptor.
   *
   * A missing result permits Pi's default LLM compactor. Keep recovery
   * outside the swallow path so handler, ambient-context, and diagnostic
   * failures cancel: any throw becomes `{ cancel: true }`.
   */
  beforeCompact<E = any>(
    pi: ExtensionAPI,
    handler: EventsHandler<E, CompactInterceptResult | undefined>,
    opts?: EventsOptions,
  ): void {
    const { label, onError, filter } = guardOptions("session_before_compact", opts);
    rawOn(pi, "session_before_compact", async (...args: unknown[]) => {
      try {
        const [event, ctx, ...rest] = args as [E, ExtensionContext, ...unknown[]];
        try {
          return await handler({ event, ctx, addContext: rest[0], rest });
        } catch (err) {
          report(label, err, { onError, filter });
          throw err;
        }
      } catch {
        return { cancel: true };
      }
    });
  },

  /** Register the `context` interceptor (message-list patching). */
  context<E = any>(
    pi: ExtensionAPI,
    handler: EventsHandler<E, ContextInterceptResult | undefined>,
    opts?: EventsOptions,
  ): void {
    registerStructured(pi, "context", handler, opts);
  },

  /** Register the `tool_result` interceptor (result patching). */
  toolResult<E = any>(
    pi: ExtensionAPI,
    handler: EventsHandler<E, ToolResultPatch | undefined>,
    opts?: EventsOptions,
  ): void {
    registerStructured(pi, "tool_result", handler, opts);
  },

  // ── Result factories ──────────────────────────────────────────────────

  messages(messages: unknown[]): ContextInterceptResult {
    return { messages };
  },

  toolPatch(patch: ToolResultPatch): ToolResultPatch {
    return patch;
  },

  cancelCompact(): CompactInterceptResult {
    return { cancel: true };
  },

  compact(compaction: CompactSummary): CompactInterceptResult {
    return { compaction };
  },
};
