/** Test-only clock/input seams and observations; no admission or host-event bypass. */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createDistillExtension } from "../../../index.ts";

export default function turnBoundaryExtension(pi: ExtensionAPI): void {
  const file = process.env.DISTILL_TEST_CLOCK_OFFSET;
  if (!file) throw new Error("Missing test clock offset file");
  const trace = process.env.DISTILL_TEST_BOUNDARY_TRACE;
  const fault = process.env.DISTILL_TEST_COMPILER_FAULT;
  const clock = () => Date.now() + Number(readFileSync(file, "utf8"));
  const record = (entry: object) => {
    if (trace) appendFileSync(trace, `${JSON.stringify({ at: clock(), ...entry })}\n`);
  };
  // Register before the real extension, as in the preparation-fault harness.
  // A replaced predecessor is an actual typed source failure; projection
  // agreement can reject this input before its malformed Unicode is decoded.
  pi.on("session_before_compact", (event) => {
    record({ kind: "preparation" });
    if (fault && existsSync(fault) && readFileSync(fault, "utf8").trim() === "unicode") {
      event.preparation.previousSummary = "Invalid decoded Unicode: \ud800";
    }
  });
  const observed = new Proxy(pi, {
    get(target, property) {
      if (property !== "on") return Reflect.get(target, property);
      return ((type: string, handler: (event: any, ctx: any) => unknown) => {
        (target.on as any)(type, async (event: any, ctx: any) => {
          const instrumented = new Proxy(ctx, {
            get(context, key) {
              const value = Reflect.get(context, key);
              if (key === "abort" || key === "compact" || key === "getContextUsage") {
                return (...args: unknown[]) => {
                  const result = value.apply(context, args);
                  record({ kind: String(key), source: type, leaf: context.sessionManager.getLeafId(),
                    ...(key === "getContextUsage" ? { tokens: result?.tokens } : {}) });
                  return result;
                };
              }
              return value;
            },
          });
          return handler(event, instrumented);
        });
      }) as ExtensionAPI["on"];
    },
  });
  createDistillExtension({ clock })(observed);
}
