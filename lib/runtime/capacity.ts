import type { CompactionEntry, SessionEntry } from "../sdk.ts";
import { runtimeCapabilities } from "../sdk.ts";
import { encodeSummary, evictOldestOptional } from "../local-compact.ts";
import { checkAbort, MAX_STRUCTURED_SUMMARY_CODE_POINTS } from "../compiler/helpers.ts";
import type { LocalCompileResult } from "../compiler/types.ts";
import { codePointLength } from "../unicode.ts";

/** Estimate the exact proposed summary and retained tail through Pi's context builder. */
export function prospectiveTokenEstimator(branch: SessionEntry[], firstKeptEntryId: string, tokensBefore: number, initialSummary: string): (summary: string) => number {
  const { buildSessionContext, buildSessionProjection, estimateTokens, getCurrentSystemMessage, sessionEntryToContextMessages } = runtimeCapabilities();
  let id = "dc-distill-prospective";
  while (branch.some(entry => entry.id === id)) id += "-";
  const timestamp = "1970-01-01T00:00:00.000Z";
  const systemMessage = getCurrentSystemMessage(buildSessionProjection(branch).messages);
  const entryFor = (summary: string): CompactionEntry => ({
    type: "compaction", id, parentId: branch.at(-1)?.id ?? null,
    timestamp, firstKeptEntryId, tokensBefore, summary,
    ...(systemMessage ? { systemMessage: { ...systemMessage, timestamp: new Date(timestamp).getTime() } } : {}),
  });
  const summaryTokens = (summary: string): number => {
    const message = sessionEntryToContextMessages(entryFor(summary)).at(-1);
    if (!message) throw new Error("missing summary context message");
    return estimateTokens(message);
  };
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

export function fitCapacity(compiled: LocalCompileResult, branch: SessionEntry[], firstKeptEntryId: string, tokensBefore: number, window: unknown, signal: AbortSignal) {
  const knownWindow = typeof window === "number" && Number.isFinite(window) && window > 0 ? window : undefined;
  let summary = compiled.summary;
  const estimate = prospectiveTokenEstimator(branch, firstKeptEntryId, tokensBefore, summary);
  let tokensAfter = estimate(summary);
  while (codePointLength(summary) > MAX_STRUCTURED_SUMMARY_CODE_POINTS || (knownWindow !== undefined && tokensAfter > knownWindow)) {
    checkAbort(signal);
    if (!evictOldestOptional(compiled.document)) throw new Error("mandatory summary exceeds capacity");
    summary = encodeSummary(compiled.document);
    tokensAfter = estimate(summary);
  }
  return { summary, tokensAfter, knownWindow };
}
