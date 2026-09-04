/**
 * Keys — input/event matching primitives for interactive overlays.
 *
 * Re-exports pi-tui key primitives behind a single dc-framework facade so
 * extensions stop reaching directly into @earendil-works/pi-tui for key
 * matching. The shape is pure re-export — adding an adapter layer here would
 * only widen the gap between docs and behavior, since the contract IS the
 * pi-tui function signature.
 *
 * @module dc-framework/x/keys
 */

import { Key, matchesKey } from "../pi/tui.ts";

export { Key, matchesKey, parseKey } from "../pi/tui.ts";

export function isCancelKey(data: string): boolean {
  return (
    data === Key.escape ||
    data === Key.ctrl("c") ||
    matchesKey(data, Key.escape) ||
    matchesKey(data, Key.ctrl("c"))
  );
}
