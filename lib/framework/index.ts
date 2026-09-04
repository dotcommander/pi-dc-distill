/**
 * dc-framework — frozen kernel barrel.
 *
 * 9 facades + defineExtension. Phase 2 decision D1 (.work/phase2-decisions-2026-05-18.md)
 * froze the kernel at these names; promotion of additional facades requires
 * ≥5 consumers + 60-day soak + unanimous test gate.
 *
 * Convenience facades (Cache, Cmd, Args, Prompt, Entries, Events) live in
 * `dc-framework/x/<name>` — explicit-opt-in, not re-exported here.
 * The pi/* adapter is the framework-owned compatibility boundary against
 * @earendil-works/*; sibling extensions use it only for raw Pi types/primitives
 * that have no kernel facade or x/ helper.
 *
 * @module dc-framework
 */

export * from "./lib/tool.ts";
export * from "./lib/command.ts";
export * from "./lib/session.ts";
export * from "./lib/path.ts";
export * from "./lib/notify.ts";
export * from "./lib/diag.ts";
export * from "./lib/guard.ts";
export * from "./lib/status.ts";
export * from "./lib/loader.ts";
export * from "./lib/define-extension.ts";
export * from "./lib/errors.ts";

// dc-framework is a library, not a pi extension. pi discovers this package
// via `keywords: ["pi-package"]` and calls the default export when loading.
// The no-op factory satisfies the loader without registering any tools,
// commands, or hooks of its own — extensions that consume this library carry
// their own real default factories.
export default function dcFramework(): void {}
