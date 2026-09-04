/**
 * rawOn — single escape-hatch for calling pi.on without fighting its 29-overload
 * signature from dynamic call sites.
 *
 * @module dc-framework/lib/_pi-on
 */

import type { ExtensionAPI } from "../pi/coding-agent";

/**
 * Register a hook handler on pi. Both call sites in the framework use an unsafe
 * cast to bypass pi's overloaded on() signature; centralise that cast here so
 * there is exactly one place to update when pi's API changes.
 */
export function rawOn(
  pi: ExtensionAPI,
  event: string,
  handler: (...args: any[]) => any,
): void {
  (pi as any).on(event, handler);
}
