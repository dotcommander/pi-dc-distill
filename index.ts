/** Deterministic compaction. Pi owns triggering, append, and context rebuilding. */
import type { CompactionEntry, ExtensionAPI, ExtensionContext, SessionEntry } from "./lib/sdk.ts";
import { buildSessionContext, buildSessionProjection, estimateTokens, getCurrentSystemMessage, sessionEntryToContextMessages } from "./lib/sdk.ts";
import { buildCompactionSource } from "./lib/compaction-source.ts";
import { compileCompactionSource, encodeSummary, evictOldestOptional } from "./lib/local-compact.ts";
import { checkAbort, MAX_STRUCTURED_SUMMARY_CODE_POINTS } from "./lib/compiler/helpers.ts";
import type { CompactionDetails } from "./lib/compiler/types.ts";
import { codePointLength } from "./lib/unicode.ts";
import { sha256Hex } from "./lib/sha256.ts";

function sessionId(ctx: ExtensionContext): string | null {
  try {
    const id = ctx.sessionManager.getSessionId();
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch { return null; }
}
function modelIdentity(ctx: ExtensionContext): string {
  return JSON.stringify([ctx.model?.provider ?? null, ctx.model?.id ?? null, ctx.model?.contextWindow ?? null]);
}
/** Exact prospective-context estimate. The synthetic entry models the exact context
 *  Pi will build after its append; across eviction iterations only the summary text
 *  changes, so one full rebuild fixes the invariant tail/system cost and each later
 *  estimate re-tokenizes only the summary message (estimateTokens is per-message). */
export function prospectiveTokenEstimator(branch: SessionEntry[], firstKeptEntryId: string, tokensBefore: number, initialSummary: string): (summary: string) => number {
  let id = "dc-distill-prospective";
  while (branch.some(entry => entry.id === id)) id += "-";
  const timestamp = "1970-01-01T00:00:00.000Z";
  const systemMessage = getCurrentSystemMessage(buildSessionProjection(branch).messages);
  const entryFor = (summary: string): CompactionEntry => ({
    type: "compaction", id, parentId: branch.at(-1)?.id ?? null,
    timestamp, firstKeptEntryId, tokensBefore, summary,
    ...(systemMessage ? { systemMessage: { ...systemMessage, timestamp: new Date(timestamp).getTime() } } : {}),
  });
  const summaryTokens = (summary: string): number => estimateTokens(sessionEntryToContextMessages(entryFor(summary)).at(-1)!);
  const rebuilt = buildSessionContext([...branch, entryFor(initialSummary)], id).messages;
  const initialCount = rebuilt.reduce((sum, message) => sum + estimateTokens(message), 0);
  if (!Number.isFinite(initialCount) || initialCount < 0) throw new Error("invalid rebuilt context estimate");
  const invariant = initialCount - summaryTokens(initialSummary);
  return (summary: string) => {
    const count = invariant + summaryTokens(summary);
    if (!Number.isFinite(count) || count < 0) throw new Error("invalid rebuilt context estimate");
    return count;
  };
}

export function createDistillExtension() {
  return (pi: ExtensionAPI): void => {
    let owner: string | null = null;
    let generation = 0;
    let replacementExpected = false;
    const isOwner = (ctx: ExtensionContext) => owner !== null && sessionId(ctx) === owner;
    const invalidate = () => { generation++; };

    pi.on("session_start", (event, ctx) => {
      const id = sessionId(ctx);
      const replacing = replacementExpected && ["new", "resume", "fork"].includes(event.reason);
      if (!id || (owner !== null && owner !== id && !replacing)) return;
      replacementExpected = false;
      owner = id;
      invalidate();
    });
    pi.on("session_shutdown", (_event, ctx) => {
      if (!isOwner(ctx)) return;
      invalidate();
      owner = null;
      replacementExpected = false;
    });
    pi.on("session_before_switch", (_event, ctx) => {
      if (isOwner(ctx)) { invalidate(); replacementExpected = true; }
    });
    pi.on("session_before_fork", (_event, ctx) => {
      if (isOwner(ctx)) { invalidate(); replacementExpected = true; }
    });
    pi.on("session_tree", (_event, ctx) => { if (isOwner(ctx)) invalidate(); });
    pi.on("model_select", (_event, ctx) => { if (isOwner(ctx)) invalidate(); });

    pi.on("session_before_compact", (event, ctx) => {
      if (!isOwner(ctx)) return { cancel: true };
      const capturedGeneration = generation;
      const capturedModel = modelIdentity(ctx);
      try {
        checkAbort(event.signal);
        const preparation = event.preparation;
        if (!Number.isFinite(preparation.tokensBefore) || preparation.tokensBefore < 0) return { cancel: true };
        const source = buildCompactionSource({
          previousSummary: preparation.previousSummary,
          messagesToSummarize: preparation.messagesToSummarize,
          turnPrefixMessages: preparation.turnPrefixMessages,
          firstKeptEntryId: preparation.firstKeptEntryId,
          branchEntries: event.branchEntries,
          cwd: ctx.cwd, signal: event.signal,
        });
        const compiled = compileCompactionSource(source, { focus: event.customInstructions, signal: event.signal });
        let summary = compiled.summary;
        const window = ctx.model?.contextWindow;
        const knownWindow = typeof window === "number" && Number.isFinite(window) && window > 0 ? window : undefined;
        const estimateTokensFor = prospectiveTokenEstimator(event.branchEntries, preparation.firstKeptEntryId, preparation.tokensBefore, summary);
        let tokensAfter = estimateTokensFor(summary);
        while (codePointLength(summary) > MAX_STRUCTURED_SUMMARY_CODE_POINTS || (knownWindow !== undefined && tokensAfter > knownWindow)) {
          checkAbort(event.signal);
          if (!evictOldestOptional(compiled.document)) throw new Error("mandatory summary exceeds capacity");
          summary = encodeSummary(compiled.document);
          tokensAfter = estimateTokensFor(summary);
        }
        checkAbort(event.signal);
        if (!isOwner(ctx) || generation !== capturedGeneration || modelIdentity(ctx) !== capturedModel) return { cancel: true };
        const anchor = event.branchEntries.at(-1)?.id ?? null;
        if ((ctx.sessionManager.getBranch().at(-1)?.id ?? null) !== anchor) return { cancel: true };
        const details: CompactionDetails = {
          compactor: "dc-distill", summaryDigest: sha256Hex(summary),
          tokensAfter, tokensAfterSource: "pi-rebuilt-message-estimate",
          capacityStatus: knownWindow === undefined ? "unknown" : "within-window",
          ...(knownWindow === undefined ? {} : { contextWindow: knownWindow }),
        };
        return { compaction: { summary, firstKeptEntryId: preparation.firstKeptEntryId, tokensBefore: preparation.tokensBefore, details } };
      } catch {
        // Returning cancellation on every failure prevents Pi's default LLM compactor.
        return { cancel: true };
      }
    });
  };
}

export default createDistillExtension();
