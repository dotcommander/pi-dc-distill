/** Deterministic compaction. Pi owns triggering, append, and context rebuilding. */
import type { ExtensionAPI, ExtensionContext } from "./lib/sdk.ts";
import { runtimeCapabilities } from "./lib/sdk.ts";
import { buildCompactionSource } from "./lib/compaction-source.ts";
import { compileCompactionSource } from "./lib/local-compact.ts";
import { checkAbort } from "./lib/compiler/helpers.ts";
import type { CompactionDetails } from "./lib/compiler/types.ts";
import { sha256Hex } from "./lib/sha256.ts";
import { RuntimeOwnership } from "./lib/runtime/ownership.ts";
import { fitCapacity } from "./lib/runtime/capacity.ts";
import { reportCancellation } from "./lib/runtime/diagnostics.ts";
import type { CancellationCode } from "./lib/runtime/diagnostics.ts";
export { prospectiveTokenEstimator } from "./lib/runtime/capacity.ts";

function sessionId(ctx: ExtensionContext): string | null {
  try {
    const id = ctx.sessionManager.getSessionId();
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch { return null; }
}
function modelIdentity(ctx: ExtensionContext): string {
  const model = ctx.model;
  return JSON.stringify([model?.provider ?? null, model?.id ?? null, model?.contextWindow ?? null]);
}

export function createDistillExtension() {
  return (pi: ExtensionAPI): void => {
    const ownership = new RuntimeOwnership();
    pi.on("session_start", (_event, ctx) => { ownership.start(sessionId(ctx)); });
    pi.on("session_shutdown", (_event, ctx) => { ownership.shutdown(sessionId(ctx)); });
    pi.on("session_before_switch", (_event, ctx) => { ownership.invalidate(sessionId(ctx)); });
    pi.on("session_before_fork", (_event, ctx) => { ownership.invalidate(sessionId(ctx)); });
    pi.on("session_tree", (_event, ctx) => { ownership.invalidate(sessionId(ctx)); });
    pi.on("model_select", (_event, ctx) => { ownership.invalidate(sessionId(ctx)); });

    pi.on("session_before_compact", (event, ctx) => {
      let code: CancellationCode = "ownership";
      const cancel = () => { reportCancellation(code); return { cancel: true as const }; };
      try {
        if (!ownership.owns(sessionId(ctx))) return cancel();
        const capturedGeneration = ownership.generation;
        code = "snapshot";
        const capturedModel = modelIdentity(ctx);
        code = "capability";
        runtimeCapabilities();
        code = "preparation";
        checkAbort(event.signal);
        const preparation = event.preparation;
        if (!Number.isFinite(preparation.tokensBefore) || preparation.tokensBefore < 0) return cancel();
        code = "source";
        const source = buildCompactionSource({
          ...(preparation.previousSummary === undefined ? {} : { previousSummary: preparation.previousSummary }),
          messagesToSummarize: preparation.messagesToSummarize,
          turnPrefixMessages: preparation.turnPrefixMessages,
          firstKeptEntryId: preparation.firstKeptEntryId,
          branchEntries: event.branchEntries,
          cwd: ctx.cwd, signal: event.signal,
        });
        code = "compiler";
        const compiled = compileCompactionSource(source, {
          ...(event.customInstructions === undefined ? {} : { focus: event.customInstructions }), signal: event.signal,
        });
        code = "capacity";
        const { summary, tokensAfter, knownWindow } = fitCapacity(compiled, event.branchEntries, preparation.firstKeptEntryId, preparation.tokensBefore, ctx.model?.contextWindow, event.signal);
        checkAbort(event.signal);
        code = "stale";
        if (!ownership.owns(sessionId(ctx)) || ownership.generation !== capturedGeneration || modelIdentity(ctx) !== capturedModel) return cancel();
        code = "branch";
        const anchor = event.branchEntries.at(-1)?.id ?? null;
        if ((ctx.sessionManager.getBranch().at(-1)?.id ?? null) !== anchor) return cancel();
        const details: CompactionDetails = {
          compactor: "dc-distill", summaryDigest: sha256Hex(summary),
          tokensAfter, tokensAfterSource: "pi-rebuilt-message-estimate",
          capacityStatus: knownWindow === undefined ? "unknown" : "within-window",
          ...(knownWindow === undefined ? {} : { contextWindow: knownWindow }),
        };
        return { compaction: { summary, firstKeptEntryId: preparation.firstKeptEntryId, tokensBefore: preparation.tokensBefore, details } };
      } catch { return cancel(); }
    });
  };
}

export default createDistillExtension();
