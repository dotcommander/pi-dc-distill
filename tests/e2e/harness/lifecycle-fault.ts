/** Test-only native boundary cancellation; loaded after dc-distill. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function lifecycleFault(pi: ExtensionAPI): void {
  pi.on("session_before_switch", () => process.env.DISTILL_LIFECYCLE_FAULT === "switch" ? { cancel: true } : undefined);
  pi.on("session_before_fork", () => process.env.DISTILL_LIFECYCLE_FAULT === "fork" ? { cancel: true } : undefined);
}
