/** Registration and synchronous preparation-hook harness; no fake host operations. */
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "../../lib/sdk.ts";

type Hook = (event: any, ctx: ExtensionContext) => unknown;
export function createPreparationHarness() {
  const hooks = new Map<string, Hook>();
  let session = "primary";
  let branch: SessionEntry[] = [];
  const ctx = {
    cwd: "/tmp/distill-preparation-test",
    model: { provider: "test", id: "model", contextWindow: 200000 },
    sessionManager: {
      getSessionId: () => session,
      getBranch: () => branch,
    },
  } as unknown as ExtensionContext;
  const pi = { on: (name: string, hook: Hook) => {
    if (hooks.has(name)) throw new Error(`Duplicate hook: ${name}`);
    hooks.set(name, hook);
  } } as unknown as ExtensionAPI;
  return {
    pi, ctx, hooks,
    setSession(id: string) { session = id; },
    setBranch(entries: SessionEntry[]) { branch = entries; },
    emit(name: string, event: any = {}) { return hooks.get(name)?.(event, ctx); },
  };
}
