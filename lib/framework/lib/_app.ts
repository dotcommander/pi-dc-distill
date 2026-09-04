/**
 * _app — ambient per-extension container (private engine).
 *
 * App context (pi + extName) is a module singleton: each pi extension loads
 * dc-framework as its own module instance, so the singleton is naturally
 * per-extension. Request context (ctx) is AsyncLocalStorage, set by the Guard
 * funnels around each handler invocation.
 *
 * Private: only lib/define-extension.ts drives boot(); only lib/guard.ts drives
 * runWith(). Public read-only accessors live in x/app.ts.
 *
 * @module dc-framework/lib/_app
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { ExtensionAPI, ExtensionContext } from "../pi/coding-agent";

interface AppState {
  pi: ExtensionAPI;
  name: string;
}

let _app: AppState | undefined;
const _ctxStore = new AsyncLocalStorage<ExtensionContext>();

const UNBOOTED =
  "App not booted — call inside defineExtension or pass the argument explicitly.";

/** Idempotent, first-wins. Re-boot with a different name is ignored (warns only under DC_GUARD_VERBOSE=1). */
export function boot(pi: ExtensionAPI, name: string): void {
  if (!name || !name.trim()) throw new TypeError("App.boot: name is required");
  if (_app) {
    if (_app.name !== name && process.env.DC_GUARD_VERBOSE === "1") {
      console.error(
        `[dc-framework _app] re-boot with different name ignored: have "${_app.name}", got "${name}"`,
      );
    }
    return; // first wins for both pi and name
  }
  _app = { pi, name };
}

/** Run fn with ctx bound to the request-scope AsyncLocalStorage. */
export function runWith<T>(ctx: ExtensionContext, fn: () => T): T {
  return _ctxStore.run(ctx, fn);
}

/** Live ExtensionAPI. Throws when unbooted. */
export function pi(): ExtensionAPI {
  if (!_app) throw new Error(UNBOOTED);
  return _app.pi;
}

/** Booted extension name. Throws when unbooted. */
export function name(): string {
  if (!_app) throw new Error(UNBOOTED);
  return _app.name;
}

/** Current request ctx, or undefined outside a handler scope. Never throws. */
export function ctx(): ExtensionContext | undefined {
  return _ctxStore.getStore();
}

/** Non-throwing booted check so facades branch without try/catch. */
export function isBooted(): boolean {
  return _app !== undefined;
}

/** Test-only reset. NOT re-exported via x/app (surface unaffected). */
export function __resetForTest(): void {
  _app = undefined;
}
