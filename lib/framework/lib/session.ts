/**
 * Session facade — lifecycle hook registration with error gating.
 *
 * Every dc-* extension repeats the same session_start try/catch boilerplate:
 * `applyExtensionDefaults(import.meta.url, ctx)` wrapped in inconsistent error
 * logging (console.error vs process.stderr.write, three error-to-string variants).
 * Session collapses that to a single call. It also wraps session_shutdown and
 * before_agent_start handlers with the same Guard-based error boundary so a
 * forgotten catch never wedges the TUI.
 *
 * @module dc-framework/lib/session
 */

import type { ExtensionAPI } from "../pi/coding-agent";
import { applyExtensionDefaults } from "./_theme-map.ts";
import { Guard } from "./guard.ts";
import { pi as appPi } from "./_app.ts";

/**
 * Optional cleanup handler for session_shutdown.
 * Receives the ExtensionContext; runs inside a Guard boundary.
 */
export type CleanupHandler = (
  ctx: any, // ExtensionContext — typed as any for non-runtime importability
) => void | Promise<void>;

export interface SessionOverloads {
  init(metaUrl: string): void;
  init(pi: ExtensionAPI, metaUrl: string): void;
  onCleanup(pi: ExtensionAPI, handler: CleanupHandler): void;
  inject(
    pi: ExtensionAPI,
    customType: string,
    content: string,
    display?: boolean,
  ): void;
}

export const Session: SessionOverloads = {
  /**
   * Register a session_start handler that applies extension theme/title defaults
   * and logs errors consistently via Guard.
   *
   * Replaces the boilerplate in every dc-* extension:
   *   pi.on("session_start", async (_, ctx) => {
   *     try { applyExtensionDefaults(import.meta.url, ctx); }
   *     catch (err) { console.error(`[dc-xxx session_start] ${err instanceof Error ? err.message : err}\n`); }
   *   });
   *
   * With:
   *   Session.init(pi, import.meta.url);
   *
   * Omitting pi resolves it from the App container.
   *
   * @param pi     The ExtensionAPI from the default export function argument.
   * @param metaUrl Pass `import.meta.url` from the calling extension's index.ts.
   */
  init(a: ExtensionAPI | string, b?: string): void {
    const [piArg, metaUrl] =
      typeof a === "string" ? [appPi(), a] : [a, b as string];
    const label = "session_start";
    piArg.on(
      "session_start",
      Guard.hook(
        async (_event: any, ctx: any) => {
          applyExtensionDefaults(metaUrl, ctx, piArg);
        },
        { label },
      ),
    );
  },

  /**
   * Register a session_shutdown cleanup handler with error gating.
   *
   * Replaces:
   *   pi.on("session_shutdown", async (_, ctx) => {
   *     try { myMap.delete(ctx.sessionId); }
   *     catch (err) { process.stderr.write(`[dc-xxx session_shutdown] ${err}\n`); }
   *   });
   *
   * With:
   *   Session.onCleanup(pi, (ctx) => myMap.delete(ctx.sessionId));
   *
   * @param pi      The ExtensionAPI.
   * @param handler Cleanup function receiving ctx. Runs inside Guard.hook.
   */
  onCleanup(pi: ExtensionAPI, handler: CleanupHandler): void {
    const label = "session_shutdown";
    pi.on(
      "session_shutdown",
      Guard.hook(
        async (_event: any, ctx: any) => {
          await handler(ctx);
        },
        { label },
      ),
    );
  },

  /**
   * Register a before_agent_start handler that injects context into the LLM stream.
   *
   * Replaces:
   *   pi.on("before_agent_start", async () => {
   *     try {
   *       if (disabled) return;
   *       return { message: { customType: "dc-xxx-context", content: SOME_TEXT, display: false } };
   *     } catch (e: any) { process.stderr.write(`[dc-xxx before_agent_start] ${e.message}\n`); }
   *   });
   *
   * With:
   *   Session.inject(pi, "dc-xxx-context", SOME_TEXT, false);
   *
   * Note: inject does NOT handle toggling (disabled checks). Extensions that gate
   * their context injection behind a flag should use the raw pi.on("before_agent_start", ...)
   * form and Guard.hook manually. inject is for unconditional injection only.
   *
   * @param pi         The ExtensionAPI.
   * @param customType Unique identifier for this context message (e.g. "dc-memory-context").
   * @param content    The text content to inject into the LLM stream.
   * @param display    Whether the injected message is visible to the user. Default: false.
   */
  inject(
    pi: ExtensionAPI,
    customType: string,
    content: string,
    display: boolean = false,
  ): void {
    const label = "before_agent_start";
    pi.on(
      "before_agent_start",
      Guard.hook(
        async () => {
          return {
            message: { customType, content, display },
          };
        },
        { label },
      ),
    );
  },
};
