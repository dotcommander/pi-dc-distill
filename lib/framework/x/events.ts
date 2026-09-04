/**
 * Events facade — task-shaped wrappers for Pi interceptor hooks.
 *
 * @module dc-framework/x/events
 */

import type { ExtensionAPI, ExtensionContext } from "../pi/coding-agent";
import { Guard } from "../lib/guard.ts";
import { rawOn } from "../lib/_pi-on.ts";

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

export type InputInterceptResult =
  | { action: "continue" }
  | { action: "transform"; text: string; images?: unknown[] }
  | { action: "handled" };

export interface ContextInterceptResult {
  messages: unknown[];
}

export interface AgentStartInterceptResult {
  message?: {
    customType: string;
    content: string;
    display?: boolean;
    details?: unknown;
  };
  systemPrompt?: string;
}

export type ToolCallInterceptResult =
  | { block: true; reason?: string }
  | { block: false };

export interface ToolResultPatch {
  content?: unknown;
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

function guardOptions(event: string, opts: EventsOptions = {}): EventsOptions {
  return {
    label: opts.label ?? event,
    onError: opts.onError,
    filter: opts.filter,
  };
}

function registerStructured<E, R>(
  pi: ExtensionAPI,
  eventName: string,
  handler: EventsHandler<E, R>,
  opts?: EventsOptions,
): void {
  rawOn(
    pi,
    eventName,
    Guard.hook(
      async (event: E, ctx: ExtensionContext, ...rest: unknown[]) => {
        return handler({
          event,
          ctx,
          addContext: rest[0],
          rest,
        });
      },
      guardOptions(eventName, opts),
    ),
  );
}

export const Events = {
  register(
    pi: ExtensionAPI,
    eventName: string,
    handler: (...args: any[]) => any,
  ): void {
    rawOn(pi, eventName, handler);
  },

  on<E = any, R = unknown>(
    pi: ExtensionAPI,
    eventName: string,
    handler: EventsHandler<E, R>,
    opts?: EventsOptions,
  ): void {
    registerStructured(pi, eventName, handler, opts);
  },

  input<E = any>(
    pi: ExtensionAPI,
    handler: EventsHandler<E, InputInterceptResult | undefined>,
    opts?: EventsOptions,
  ): void {
    registerStructured(pi, "input", handler, opts);
  },

  context<E = any>(
    pi: ExtensionAPI,
    handler: EventsHandler<E, ContextInterceptResult | undefined>,
    opts?: EventsOptions,
  ): void {
    registerStructured(pi, "context", handler, opts);
  },

  beforeAgentStart<E = any>(
    pi: ExtensionAPI,
    handler: EventsHandler<E, AgentStartInterceptResult | undefined>,
    opts?: EventsOptions,
  ): void {
    registerStructured(pi, "before_agent_start", handler, opts);
  },

  toolCall<E = any>(
    pi: ExtensionAPI,
    handler: EventsHandler<E, ToolCallInterceptResult | undefined>,
    opts?: EventsOptions,
  ): void {
    registerStructured(pi, "tool_call", handler, opts);
  },

  toolResult<E = any>(
    pi: ExtensionAPI,
    handler: EventsHandler<E, ToolResultPatch | undefined>,
    opts?: EventsOptions,
  ): void {
    registerStructured(pi, "tool_result", handler, opts);
  },

  beforeCompact<E = any>(
    pi: ExtensionAPI,
    handler: EventsHandler<E, CompactInterceptResult | undefined>,
    opts?: EventsOptions,
  ): void {
    registerStructured(pi, "session_before_compact", handler, opts);
  },

  continue(): InputInterceptResult {
    return { action: "continue" };
  },

  transform(text: string, images?: unknown[]): InputInterceptResult {
    return images === undefined
      ? { action: "transform", text }
      : { action: "transform", text, images };
  },

  handled(): InputInterceptResult {
    return { action: "handled" };
  },

  messages(messages: unknown[]): ContextInterceptResult {
    return { messages };
  },

  systemPrompt(systemPrompt: string): AgentStartInterceptResult {
    return { systemPrompt };
  },

  inject(
    customType: string,
    content: string,
    display = false,
    details?: unknown,
  ): AgentStartInterceptResult {
    return {
      message:
        details === undefined
          ? { customType, content, display }
          : { customType, content, display, details },
    };
  },

  agentStart(result: AgentStartInterceptResult): AgentStartInterceptResult {
    return result;
  },

  allow(): ToolCallInterceptResult {
    return { block: false };
  },

  block(reason?: string): ToolCallInterceptResult {
    return reason === undefined ? { block: true } : { block: true, reason };
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
