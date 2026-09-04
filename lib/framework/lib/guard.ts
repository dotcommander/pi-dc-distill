/**
 * Guard facade — wraps async/sync callbacks in try/catch to prevent TUI wedges.
 *
 * Unguarded hook and command callbacks can freeze Pi's TUI. The pinned runtime
 * converts thrown tool executions to native failed results, so Guard.tool logs
 * and rethrows while hook/command modes retain their recovery behavior.
 *
 * Errors are appended to ~/.pi/data/dc-framework/guard-errors.log (silent by
 * default — pi's TUI captures stderr, so console.error wedges the user with a
 * stack trace). Set DC_GUARD_VERBOSE=1 to also echo to stderr while debugging.
 */

import { cancelledResult } from "./_text-result.ts";
import { runWith, isBooted } from "./_app.ts";
import { logDiag } from "./_log.ts";
import type { ExtensionContext } from "../pi/coding-agent";

type AnyAsync = (...args: any[]) => Promise<any>;

type GuardOpts = {
  rethrow?: boolean;
  label?: string;
  onError?: (err: unknown) => void;
  /**
   * Return true to suppress logging of an expected/benign error (e.g. stale
   * ctx after a taskagent session). Only invoked for Error instances; the
   * error is still swallowed/rethrown per rethrow. Does not run onError.
   */
  filter?: (err: Error) => boolean;
  /**
   * Index of the ExtensionContext argument; when set and App is booted, the
   * handler runs inside App.runWith(args[ctxArg], …) so facades resolve ctx
   * ambiently.
   */
  ctxArg?: number;
};

interface GuardFn {
  <F extends AnyAsync>(fn: F, opts?: GuardOpts): F;
  hook<F extends AnyAsync>(fn: F, opts?: GuardOpts): F;
  tool<F extends AnyAsync>(fn: F, opts?: GuardOpts): F;
  command<F extends AnyAsync>(fn: F, opts?: GuardOpts): F;
}

function makeTag(label: string | undefined): string {
  return label ? `[Guard:${label}]` : "[Guard]";
}

function reportGuardError(
  tag: string,
  err: unknown,
  onError: ((err: unknown) => void) | undefined,
  filter: ((err: Error) => boolean) | undefined,
): void {
  if (filter && err instanceof Error && filter(err)) return;
  if (onError) {
    onError(err);
  } else {
    logDiag(tag, err);
  }
}

function recoverGuardError(
  tag: string,
  err: unknown,
  opts: Pick<GuardOpts, "rethrow" | "onError" | "filter">,
): undefined {
  reportGuardError(tag, err, opts.onError, opts.filter);
  if (opts.rethrow) throw err;
  return undefined;
}

function recoverToolError(
  tag: string,
  err: unknown,
  opts: Pick<GuardOpts, "rethrow" | "onError" | "filter">,
): ReturnType<typeof cancelledResult> {
  if (isLoaderAbort(err)) {
    return cancelledResult(err.label ?? "unknown");
  }
  reportGuardError(tag, err, opts.onError, opts.filter);
  // Pi owns the native tool-error path. Returning an error-shaped value keeps
  // the content but does not set Pi's isError flag; rethrowing does.
  throw err;
}

function isLoaderAbort(
  error: unknown,
): error is { name: "LoaderAbortError"; label?: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "LoaderAbortError"
  );
}

type RecoverGuard = (
  tag: string,
  err: unknown,
  opts: Pick<GuardOpts, "rethrow" | "onError" | "filter">,
) => unknown;

/**
 * Recovery asymmetry as data, not function-pointer presence:
 *  - tool: loader cancellation returns a result; other failures rethrow to Pi
 *  - hook/command: swallow → undefined
 */
type GuardMode = "tool" | "hook" | "command";

const RECOVER_BY_MODE: Record<GuardMode, RecoverGuard> = {
  tool: recoverToolError,
  hook: recoverGuardError,
  command: recoverGuardError,
};

function wrapGuarded<F extends AnyAsync>(
  fn: F,
  opts: GuardOpts | undefined,
  mode: GuardMode,
): F {
  const recover = RECOVER_BY_MODE[mode];
  const { rethrow = false, label, onError, filter, ctxArg } = opts ?? {};
  const tag = makeTag(label);
  const guardOpts = { rethrow, onError, filter };

  const wrapped = (...args: Parameters<F>): ReturnType<F> => {
    // invoke runs the wrapped fn AND its recovery inside the ctx scope.
    // Both the sync-throw catch and the async .catch must execute here so
    // recovery resolves the same ambient ctx the handler threw under —
    // not undefined (the booted-host fallback). See audit finding #8.
    const invoke = (): ReturnType<F> => {
      try {
        const result = fn(...args);
        if (result instanceof Promise) {
          return result.catch((err: unknown) => {
            return recover(tag, err, guardOpts) as Awaited<ReturnType<F>>;
          }) as ReturnType<F>;
        }
        return result as ReturnType<F>;
      } catch (err: unknown) {
        return recover(tag, err, guardOpts) as ReturnType<F>;
      }
    };

    return ctxArg !== undefined && isBooted() && args[ctxArg] != null
      ? runWith(args[ctxArg] as ExtensionContext, invoke)
      : invoke();
  };

  return wrapped as unknown as F;
}

function guardImpl<F extends AnyAsync>(fn: F, opts?: GuardOpts): F {
  return wrapGuarded(fn, opts, "hook");
}

function toolGuardImpl<F extends AnyAsync>(fn: F, opts?: GuardOpts): F {
  return wrapGuarded(fn, opts, "tool");
}

export const Guard: GuardFn = Object.assign(guardImpl, {
  hook: <F extends AnyAsync>(fn: F, opts?: GuardOpts): F =>
    guardImpl(fn, { label: "hook", ctxArg: 1, ...opts }),
  tool: <F extends AnyAsync>(fn: F, opts?: GuardOpts): F =>
    toolGuardImpl(fn, { label: "tool", ctxArg: 4, ...opts }),
  command: <F extends AnyAsync>(fn: F, opts?: GuardOpts): F =>
    guardImpl(fn, { label: "command", ctxArg: 1, ...opts }),
});
