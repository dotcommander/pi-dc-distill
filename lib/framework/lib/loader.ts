/**
 * Loader facade — task-shaped wrapper around BorderedLoader.
 *
 * Renders async work through ctx.ui.custom() + BorderedLoader. Callers may use
 * the default full-width frame or the standard dc rail-block presentation. The
 * handle updates phase labels and preserves Escape cancellation in either view.
 * On abort, rejects with LoaderAbortError after the overlay is dismissed.
 *
 * @module dc-framework/lib/loader
 */

import { createSinkSlot, matchText, type Matcher } from "./_fake.ts";
import { ctx as appCtx } from "./_app.ts";
import { Tui, type TuiThemeLike } from "./_tui.ts";
import type { BorderedLoader } from "../pi/coding-agent";
import type { ExtensionContext } from "../pi/coding-agent";
import { truncateToWidth } from "../pi/tui";

// BorderedLoader exposes no public setter for its label; this poke reaches its
// private inner `.loader.message`. Isolated here so a pi rename surfaces at ONE site.
function setLoaderLabel(loader: BorderedLoader, label: string): void {
  (loader as unknown as { loader: { message: string } }).loader.message = label;
}

const sinkSlot = createSinkSlot();

/**
 * Inert signal: there is no overlay to drive Escape, so this AbortSignal never
 * fires. Callers in headless/fake mode are effectively non-cancellable. The
 * live overlay path hands back `loader.signal` instead, which Escape can abort.
 */
function inertSignal(): AbortSignal {
  return new AbortController().signal;
}

function headlessHandle(): LoaderHandle {
  return {
    phase(): void {},
    signal: inertSignal(),
  };
}

export interface LoaderFake {
  assertPhase(m?: Matcher): void;
  restore(): void;
}

export interface LoaderHandle {
  /** Update the loader's label. Useful for pipeline phases. */
  phase(label: string): void;
  /**
   * Aborts when the user presses Escape on the loader. Pass to child processes,
   * fetch calls, or any cancellable async work so cancellation propagates.
   */
  signal: AbortSignal;
}

/**
 * Structural minimum the Loader reads off a context: a UI surface exposing
 * `custom()` and an optional headless flag. Accepting this (rather than the full
 * ExtensionContext) lets command-level callers pass their own thin ctx shims.
 */
export interface LoaderContext {
  hasUI?: boolean;
  mode?: "tui" | "rpc" | "json" | "print";
  ui?: { custom?: ExtensionContext["ui"]["custom"] };
}

function canUseLoaderOverlay(
  ctx: LoaderContext | undefined,
): ctx is LoaderContext & {
  ui: { custom: ExtensionContext["ui"]["custom"] };
} {
  return (
    (ctx?.mode === undefined || ctx.mode === "tui") &&
    ctx?.hasUI !== false &&
    ctx?.ui !== undefined &&
    typeof ctx.ui.custom === "function"
  );
}

export interface LoaderFallback<T> {
  abort(): T;
  error(error: unknown): T;
}

interface LoaderRunOptions {
  presentation?: {
    kind: "standard";
    title: string;
  };
}

function formatStandardLoaderBlock(
  title: string,
  activity: string,
  theme: TuiThemeLike,
  width: number,
): string {
  const block = Tui.formatRailBlock({
    theme,
    header: Tui.formatRailCall({
      theme,
      verb: title,
      status: "running",
      verbColor: "accent",
      inset: "",
    }),
    bodyLines: [activity],
    footer: Tui.formatRailResult({
      theme,
      summary: "working",
      meta: ["esc cancel"],
      status: "running",
    }),
    railColor: "accent",
    maxBodyLines: 1,
  });
  return block
    .split("\n")
    .map((line) => truncateToWidth(line, width))
    .join("\n");
}

const SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
];

function applyStandardPresentation(
  loader: BorderedLoader,
  title: string,
  currentLabel: () => string,
  theme: TuiThemeLike,
): void {
  const component = loader as unknown as {
    render(width: number): string[];
  };
  component.render = (width) => {
    const frame =
      SPINNER_FRAMES[Math.floor(Date.now() / 80) % SPINNER_FRAMES.length];
    return formatStandardLoaderBlock(
      title,
      `${frame} ${currentLabel()}`,
      theme,
      width,
    ).split("\n");
  };
}

export class LoaderAbortError extends Error {
  readonly name = "LoaderAbortError" as const;

  constructor(public readonly label: string) {
    super(`Loader cancelled: ${label}`);
  }
}

export interface LoaderOverloads {
  isAbort(error: unknown): error is LoaderAbortError;
  run<T>(
    initialLabel: string,
    fn: (l: LoaderHandle) => Promise<T>,
    options?: LoaderRunOptions,
  ): Promise<T>;
  run<T>(
    ctx: LoaderContext,
    initialLabel: string,
    fn: (l: LoaderHandle) => Promise<T>,
    options?: LoaderRunOptions,
  ): Promise<T>;
  runPhased<T>(
    ctx: LoaderContext,
    initialLabel: string,
    fn: (phase: (label: string) => void) => Promise<T>,
    fallback: LoaderFallback<T>,
  ): Promise<T>;
  fake(): LoaderFake;
}

export const Loader: LoaderOverloads = {
  isAbort(error: unknown): error is LoaderAbortError {
    return (
      error instanceof LoaderAbortError ||
      (typeof error === "object" &&
        error !== null &&
        (error as { name?: unknown }).name === "LoaderAbortError")
    );
  },

  /**
   * Render a labelled spinner for the duration of `fn`.
   *
   * Achieves try/finally semantics through pi's overlay lifecycle:
   * `done()` dismisses the overlay on both success and error paths,
   * and `capturedError` is re-thrown after the overlay is fully disposed
   * so the TUI recovers cleanly before the error propagates.
   *
   * Uses the documented BorderedLoader API:
   *   - Phase updates via `loader.loader.message = label`
   *   - Escape abort via `loader.onAbort`
   *   - Overlay resolution via `done(value)`
   *
   * Omitting ctx resolves it from the App container.
   *
   * @param ctx pi ExtensionContext (supplies `ctx.ui.custom`)
   * @param initialLabel first label shown
   * @param fn async work; receives a LoaderHandle for label updates
   * @param options optional presentation configuration
   * @returns whatever `fn` resolves to
   * @throws LoaderAbortError on Escape abort
   * @throws re-throws whatever `fn` throws (after dismissing the loader)
   */
  async run<T>(
    a: LoaderContext | string,
    b: string | ((l: LoaderHandle) => Promise<T>),
    c?: LoaderRunOptions | ((l: LoaderHandle) => Promise<T>),
    d?: LoaderRunOptions,
  ): Promise<T> {
    const ambient = typeof a === "string";
    const ctxArg = ambient ? appCtx() : a;
    const initialLabel = (ambient ? a : b) as string;
    const fn = (ambient ? b : c) as (l: LoaderHandle) => Promise<T>;
    const options = (ambient ? c : d) as LoaderRunOptions | undefined;
    const sink = sinkSlot.active();
    if (sink) {
      sink.record("phase", [initialLabel]);
      return fn({
        phase(label: string): void {
          sink.record("phase", [label]);
        },
        signal: inertSignal(),
      });
    }

    // No usable UI overlay: run headless. This covers explicit no-UI command
    // contexts, ambient no-UI contexts, and thin test shims without ui.custom.
    if (!canUseLoaderOverlay(ctxArg)) {
      return fn(headlessHandle());
    }

    const { BorderedLoader } = await import("../pi/coding-agent");
    let settled = false;
    let started = false;
    let capturedError: unknown = undefined;
    let currentLabel = initialLabel;

    const result = await ctxArg.ui.custom<T | undefined>(
      (tui, theme, _kb, done) => {
        const loader = new BorderedLoader(tui, theme, initialLabel);
        started = true;
        if (options?.presentation?.kind === "standard") {
          applyStandardPresentation(
            loader,
            options.presentation.title,
            () => currentLabel,
            theme,
          );
        }

        const lh: LoaderHandle = {
          phase(label: string): void {
            currentLabel = label;
            // Documented update path for BorderedLoader's inner label.
            // See: docs/readme-first.md and docs/extensions/extension-guide-build-tui.md
            setLoaderLabel(loader, label);
            tui.requestRender();
          },
          signal: loader.signal,
        };

        // Escape aborts — reject after overlay dismissal so callers can catch
        // a typed cancellation error without leaving the loader mounted.
        loader.onAbort = () => {
          if (!settled) {
            settled = true;
            capturedError = new LoaderAbortError(currentLabel);
            done(undefined);
          }
        };

        // dc-analyze:ignore promise-then-instead-of-await - ui.custom callbacks must return the loader synchronously.
        fn(lh).then(
          (val) => {
            if (!settled) {
              settled = true;
              done(val);
            }
          },
          (err) => {
            if (!settled) {
              settled = true;
              capturedError = err;
              done(undefined);
            }
          },
        );

        return loader;
      },
    );

    // Unit-test stubs and headless shims may record ctx.ui.custom without
    // invoking its factory. In that case, run the work inline so command tests
    // still exercise the behavior guarded by Loader.run.
    if (!started) {
      return fn(headlessHandle());
    }

    // Re-throw after the overlay is dismissed so the TUI recovers cleanly.
    if (capturedError !== undefined) throw capturedError;
    return result as T;
  },

  async runPhased<T>(
    ctx: LoaderContext,
    initialLabel: string,
    fn: (phase: (label: string) => void) => Promise<T>,
    fallback: LoaderFallback<T>,
  ): Promise<T> {
    const sink = sinkSlot.active();
    if (sink) {
      sink.record("phase", [initialLabel]);
      try {
        return await fn((label: string) => {
          sink.record("phase", [label]);
        });
      } catch (e: unknown) {
        if (this.isAbort(e)) return fallback.abort();
        throw e;
      }
    }

    if (!canUseLoaderOverlay(ctx)) return fn(() => {});
    try {
      return await this.run(ctx, initialLabel, (handle) =>
        fn((label) => handle.phase(label)),
      );
    } catch (e: unknown) {
      return this.isAbort(e) ? fallback.abort() : fallback.error(e);
    }
  },

  fake(): LoaderFake {
    const { sink, restore } = sinkSlot.install();
    const handle: LoaderFake = {
      assertPhase: (m) => {
        if (
          !sink
            .byMethod("phase")
            .some((r) => matchText(String(r.args[0] ?? ""), m))
        )
          throw new Error(
            `Expected a loader phase matching ${m ?? "anything"}`,
          );
      },
      restore,
    };
    return handle;
  },
};
