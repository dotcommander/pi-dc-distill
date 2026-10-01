/** Test-only transaction barrier, loaded after dc-distill's before hook. */
import { existsSync, writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function compactionBarrier(pi: ExtensionAPI): void {
  const control = process.env.DISTILL_COMPACTION_BARRIER;
  if (!control) throw new Error("Missing sandbox compaction barrier path");
  pi.on("session_before_compact", async () => {
    writeFileSync(`${control}.prepared`, "prepared\n");
    // Returning undefined preserves the preceding extension's result. A
    // missing release fails closed rather than accidentally appending it.
    const released = await new Promise<boolean>((resolve) => {
      const deadline = Date.now() + 30_000;
      const timer = setInterval(() => {
        if (existsSync(`${control}.release`) || Date.now() >= deadline) {
          clearInterval(timer);
          resolve(existsSync(`${control}.release`));
        }
      }, 10);
    });
    if (!released) return { cancel: true };
  });
  pi.on("session_compact", async (event) => {
    writeFileSync(`${control}.committed`, JSON.stringify(event.compactionEntry));
  });
}
