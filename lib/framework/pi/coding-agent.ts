// Adapter: @earendil-works/pi-coding-agent → dc-framework consumers.
// Drift probe: tests/adapter-coding-agent.test.ts.
export * from "@earendil-works/pi-coding-agent";

import type {
  ModelRegistry,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";

/**
 * Recover the active runtime behind Pi's synchronous ModelRegistry facade.
 *
 * Pi 0.82 moved completion and child-session APIs onto ModelRuntime without
 * exposing that runtime on ExtensionContext. Keep this compatibility access in
 * the framework adapter so extensions preserve session-registered providers.
 */
export function activeModelRuntime(registry: ModelRegistry): ModelRuntime {
  const runtime = (registry as unknown as { runtime?: ModelRuntime }).runtime;
  if (!runtime) {
    throw new Error("Active Pi model runtime is unavailable");
  }
  return runtime;
}
