/**
 * defineExtension — declarative manifest contract for dc-framework extensions.
 *
 * Phase 2 decision D3 (revised): the manifest is declarative for tools, commands,
 * and hooks. A small `setup(pi)` escape hatch is permitted for pi-dependent
 * facade calls (Session.init, Status.scope, Session.onCleanup) that need pi at
 * registration time. The original "no escape hatch" form blocked every real
 * migration because the manifest is evaluated before pi exists.
 *
 * Invariants encoded structurally (cannot be bypassed by callers):
 *   1. Every tool routes through Tool.register → Guard.tool wrap is automatic.
 *   2. Every hook routes through pi.on(event, Guard.hook(handler)) → forgetting
 *      Guard is structurally impossible.
 *   3. storage:{data,cache} is a TYPE-ENFORCED permission. A manifest declared
 *      with `storage: { data: false }` (or omitted) makes `manifest.storage.data`
 *      a type error — conditional types gate the PathHandle access on the
 *      storage flag at compile time.
 *
 * @module dc-framework/lib/define-extension
 */

import type { TObject } from "typebox";
import type { ExtensionAPI, ExtensionEvent } from "../pi/coding-agent";
import {
  Tool,
  installToolErrorBridge,
  type ToolRegisterDef,
} from "./tool.ts";
import { Command, type CommandDef } from "./command.ts";
import { Guard } from "./guard.ts";
import { Path, type PathHandle } from "./path.ts";
import { boot } from "./_app.ts";
import { rawOn } from "./_pi-on.ts";

/* ────────────────────────────────────────────────────────────────────────────
 * Storage permission types
 * ──────────────────────────────────────────────────────────────────────────── */

/** Declarative storage permission. Both flags default to false (undefined). */
export interface ExtensionStorage {
  data?: boolean;
  cache?: boolean;
}

/**
 * Storage view exposed on the manifest. Conditional types gate each field on
 * the corresponding storage flag — `manifest.storage.data.read(...)` is a TS
 * error when the manifest's S["data"] is not literally `true`.
 *
 * The `never` branch means the property is structurally absent from the view,
 * not just `undefined` — direct access produces a TS error, not a runtime null.
 */
export type StorageView<S extends ExtensionStorage> = {
  data: S["data"] extends true ? PathHandle : never;
  cache: S["cache"] extends true ? PathHandle : never;
};

/* ────────────────────────────────────────────────────────────────────────────
 * Hook map — derived from ExtensionEvent discriminated union
 *
 * pi exposes ExtensionAPI["on"] as 29 overloaded signatures (one per event).
 * TypeScript's Parameters<F> on an overloaded function picks only the LAST
 * overload, so derivation from Parameters<ExtensionAPI["on"]>[0] collapses to
 * the literal "input" alone. We instead distribute over ExtensionEvent — every
 * event interface in that union carries a `type` literal that matches the
 * corresponding on() event-name overload.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Union of allowed pi hook event names, derived from ExtensionEvent["type"]. */
export type ExtensionHookEvent = ExtensionEvent extends { type: infer N }
  ? N extends string
    ? N
    : never
  : never;

/** The event payload type associated with a given hook event name. */
export type ExtensionEventForName<E extends ExtensionHookEvent> = Extract<
  ExtensionEvent,
  { type: E }
>;

/**
 * Handler type for a given hook event. The result type is intentionally loose
 * (`any`) — pi's per-event result types are encoded in the overloaded `on()`
 * signature, which is not reachable via Parameters<F>. Tight per-event result
 * typing would require hand-mirroring every overload here; that duplication is
 * a maintenance hazard. Handlers may return any pi-acceptable shape.
 */
export type ExtensionHookHandler<E extends ExtensionHookEvent> = (
  event: ExtensionEventForName<E>,
  ctx: Parameters<
    Extract<
      Parameters<ExtensionAPI["on"]>,
      [string, (...args: any[]) => any]
    >[1]
  >[1],
) => Promise<any> | any;

/**
 * Mapped hooks object keyed by pi event name. Every value, if present, is the
 * handler signature pi.on(event, …) expects for that event.
 */
export type ExtensionHookMap = {
  [E in ExtensionHookEvent]?: ExtensionHookHandler<E>;
};

/* ────────────────────────────────────────────────────────────────────────────
 * Tools / commands maps
 * ──────────────────────────────────────────────────────────────────────────── */

export type ExtensionTools = Record<string, ToolRegisterDef<TObject>>;
export type ExtensionCommands = Record<string, CommandDef>;
export type ExtensionFeature = (pi: ExtensionAPI) => void;

/* ────────────────────────────────────────────────────────────────────────────
 * Manifest
 * ──────────────────────────────────────────────────────────────────────────── */

/** The declarative manifest passed to defineExtension. */
export interface ExtensionManifest<S extends ExtensionStorage = {}> {
  /** Extension identifier — used as the namespace for Path.data/cache. */
  name: string;
  /**
   * Child feature registration functions. Useful for folded package manifests
   * that compose several feature-level defineExtension handles behind one Pi
   * package entry point.
   */
  features?: readonly ExtensionFeature[];
  tools?: ExtensionTools;
  commands?: ExtensionCommands;
  hooks?: ExtensionHookMap;
  /** Declarative storage permission. Omitted = no storage access. */
  storage?: S;
  /** pi-dependent registration callback. Runs inside register() with the live
   *  ExtensionAPI, BEFORE tools/commands/hooks are wired. Use for Session.init,
   *  Status.scope handle construction, and Session.onCleanup. Keep it small —
   *  this is an escape hatch for facade calls that need pi at registration
   *  time, not a general setup hook. (Phase 2 D3 revision: D3 was made before
   *  any consumer attempted migration; real extensions need pi-dependent
   *  registration calls.) */
  setup?: (pi: ExtensionAPI) => void;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Return shape
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The function pi loads as the extension's default export. Calling it is what
 * registers tools, commands, and hooks against the live pi ExtensionAPI.
 *
 * The `storage` property is the type-gated PathHandle view — accessing
 * `extension.storage.data` outside a manifest that declared `data: true` is a
 * compile-time error.
 */
export interface DefinedExtension<S extends ExtensionStorage> {
  (pi: ExtensionAPI): void;
  readonly name: string;
  readonly storage: StorageView<S>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * defineExtension
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Build a declarative extension. Returns a callable that pi invokes with its
 * ExtensionAPI. Tools route through Tool.register, commands through
 * Command.register, hooks through pi.on(event, Guard.hook(...)).
 *
 * The returned object is both the registration function and the typed handle
 * for storage access at call sites.
 */
export function defineExtension<S extends ExtensionStorage = {}>(
  manifest: ExtensionManifest<S>,
): DefinedExtension<S> {
  if (!manifest.name || !manifest.name.trim()) {
    throw new TypeError("defineExtension: manifest.name is required");
  }

  const register = (pi: ExtensionAPI): void => {
    boot(pi, manifest.name);
    installToolErrorBridge(pi);

    // pi-dependent registration calls (Session.init, Status.scope, etc.) must
    // happen before tools/commands/hooks wire up so any handles they construct
    // are observable to handlers registered below.
    if (manifest.setup) {
      manifest.setup(pi);
    }

    // Folded child features. Each child keeps its own defineExtension contract;
    // _app boot is first-wins, so the umbrella remains the ambient app owner.
    if (manifest.features) {
      for (const feature of manifest.features) {
        feature(pi);
      }
    }

    // Tools — Tool.register wraps in Guard.tool internally.
    if (manifest.tools) {
      for (const def of Object.values(manifest.tools)) {
        Tool.register(pi, def);
      }
    }

    // Commands — Command.register wraps in Guard.command internally.
    if (manifest.commands) {
      for (const def of Object.values(manifest.commands)) {
        Command.register(pi, def);
      }
    }

    // Hooks — wrap every handler in Guard.hook before passing to pi.on.
    if (manifest.hooks) {
      for (const [event, handler] of Object.entries(manifest.hooks)) {
        if (!handler) continue;
        // Cast at the boundary: per-event narrowing of pi.on overloads from a
        // dynamic Object.entries iteration is not expressible in TS. The
        // ExtensionHookMap type already constrained handler shape at the
        // manifest construction site, so this cast is safe.
        const guarded = Guard.hook(
          handler as (...args: any[]) => Promise<any>,
          {
            label: event,
          },
        );
        rawOn(pi, event, guarded);
      }
    }
  };

  // Materialize the storage view. Flags that are not literally `true` produce
  // `undefined` at runtime AND `never` in the type — call sites cannot reach
  // these properties without a type error, and the runtime undefined is the
  // safety net for any escaped `as any` casts.
  const storageDecl = manifest.storage ?? ({} as S);
  const storage = {
    data: storageDecl.data === true ? Path.data(manifest.name) : undefined,
    cache: storageDecl.cache === true ? Path.cache(manifest.name) : undefined,
  } as StorageView<S>;

  Object.defineProperty(register, "name", {
    value: manifest.name,
    writable: false,
    enumerable: true,
    configurable: true,
  });
  (register as unknown as { storage: StorageView<S> }).storage = storage;
  return register as unknown as DefinedExtension<S>;
}
