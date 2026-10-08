import { writeSync } from "node:fs";

/** Fixed codes only: diagnostics never disclose host data or affect cancellation. */
export type CancellationCode = "ownership" | "snapshot" | "capability" | "preparation" | "source" | "compiler" | "capacity" | "stale" | "branch";
export function reportCancellation(code: CancellationCode, environment: () => string | undefined = () => process.env.DC_DISTILL_DEBUG, sink: (line: string) => unknown = line => writeSync(2, line)): void {
  try { if (environment() === "1") sink(`dc-distill:cancel:${code}\n`); } catch { /* Diagnostic failures are deliberately inert. */ }
}
