import { isDeepStrictEqual } from "node:util";
import { buildSessionProjection, type SessionEntry } from "./sdk.ts";
import { decodeSummary } from "./compiler/budget-formatter.ts";
import { normalizeMessage } from "./compiler/normalizer.ts";
import { certifyIdlessPairs } from "./compiler/tool-tracker.ts";
import { CompactionInputError } from "./compiler/errors.ts";
import { checkAbort, digest, isRecord, MAX_INPUT_BYTES, MAX_SOURCE_MESSAGES, validateStructuralInput } from "./compiler/helpers.ts";
import type { CompactionSource, NormalizedRecord } from "./compiler/types.ts";

export type { CompactionSource } from "./compiler/types.ts";
type AgentMessage = Record<string, unknown>;
export interface CompactionSourceInput {
  previousSummary?: string;
  messagesToSummarize?: unknown[];
  turnPrefixMessages?: unknown[];
  firstKeptEntryId: string;
  branchEntries: SessionEntry[];
  sessionId: string;
  cwd: string;
  timestamp?: string;
  signal?: AbortSignal;
}

/** The host's active projection and exact preparation partition are the only inputs. */
export function buildCompactionSource(input: CompactionSourceInput): CompactionSource {
  checkAbort(input.signal);
  const messages = input.messagesToSummarize ?? [];
  const prefix = input.turnPrefixMessages ?? [];
  if (!Array.isArray(messages) || !Array.isArray(prefix) || !Array.isArray(input.branchEntries))
    throw new CompactionInputError("invalid preparation arrays");
  if (messages.length + prefix.length > MAX_SOURCE_MESSAGES)
    throw new CompactionInputError("discarded message record limit", "required_analysis_overflow");
  const rawIds = input.branchEntries.map(entry => entry.id);
  if (rawIds.some(id => typeof id !== "string" || !id) || new Set(rawIds).size !== rawIds.length)
    throw new CompactionInputError("inconsistent_projection: missing or duplicate branch identity");
  const projected = buildSessionProjection(input.branchEntries).entries;
  const ids = projected.map(entry => entry.sourceEntry.id);
  if (new Set(ids).size !== ids.length) throw new CompactionInputError("inconsistent_projection: duplicate projected identity");
  // Validate only effective context: superseded summaries and abandoned branches
  // never become input or block fresh sessions merely because history exists.
  validateStructuralInput(projected.map(entry => ({ id: entry.sourceEntry.id, messages: entry.messages })));
  validateStructuralInput([messages, prefix]);
  const previous = projected.findIndex(entry => entry.sourceEntry.type === "compaction" && entry.messages.length > 0);
  const prior = previous >= 0 ? projected[previous].sourceEntry : undefined;
  if ((prior?.type === "compaction" ? prior.summary : undefined) !== input.previousSummary)
    throw new CompactionInputError("inconsistent_projection: previous summary differs from preparation");
  const start = previous + 1;
  const end = ids.indexOf(input.firstKeptEntryId);
  if (typeof input.firstKeptEntryId !== "string" || !input.firstKeptEntryId || end < start)
    throw new CompactionInputError("inconsistent_projection: missing discarded boundary");
  const discarded = projected.slice(start, end);
  const flatten = (entries: typeof discarded): AgentMessage[] => entries.flatMap(entry => entry.sourceEntry.type === "compaction"
    ? [] : entry.messages.filter(message => message.role !== "system")) as unknown as AgentMessage[];
  if (!isDeepStrictEqual(flatten(discarded), [...messages, ...prefix]))
    throw new CompactionInputError("inconsistent_projection: preparation partitions differ from projected messages");
  let count = 0;
  let partitionExists = messages.length === 0;
  for (const entry of discarded) {
    count += flatten([entry]).length;
    if (count === messages.length) partitionExists = true;
  }
  if (!partitionExists) throw new CompactionInputError("inconsistent_projection: partition splits a projected entry");
  for (const { sourceEntry } of projected) {
    if (sourceEntry.type === "custom" && (sourceEntry.customType === "dc-distill-handoff" || sourceEntry.customType === "dc-shrink-handoff"))
      throw new CompactionInputError("active legacy handoff requires the old extension or a fresh session", "incompatible_summary");
  }
  const session = { id: input.sessionId, cwd: input.cwd, timestamp: input.timestamp ?? new Date(0).toISOString() };
  validateStructuralInput(session);
  let predecessor: CompactionSource["predecessor"] = null;
  const nativePrior: NormalizedRecord[] = [];
  if (prior?.type === "compaction") {
    validateStructuralInput(prior);
    const details = isRecord(prior.details) ? prior.details : undefined;
    if (details?.compactor === "dc-distill" || details?.compactor === "dc-shrink") {
      if (details.compactor !== "dc-distill" || "version" in details || typeof details.summaryDigest !== "string" || digest(prior.summary) !== details.summaryDigest)
        throw new CompactionInputError("incompatible or unauthenticated owned predecessor", "incompatible_summary");
      predecessor = decodeSummary(prior.summary);
    } else nativePrior.push({ kind: "native-summary", text: prior.summary });
  }
  const groups = [...messages, ...prefix].map(message => {
    checkAbort(input.signal);
    if (!isRecord(message)) throw new CompactionInputError("invalid preparation message");
    return normalizeMessage(message);
  });
  certifyIdlessPairs(groups.flat());
  // Count ambiguity before admitting whole messages. Dropping one occurrence
  // must never turn a duplicate call/result ID into an apparently unique pair.
  const calls = new Map<string, number>(), results = new Map<string, number>();
  for (const record of groups.flat()) {
    if (record.callId === undefined) continue;
    const counts = record.kind === "tool-call" ? calls : record.kind === "tool-result" ? results : undefined;
    if (counts) counts.set(record.callId, (counts.get(record.callId) ?? 0) + 1);
  }
  const duplicateCallIds = [...new Set([...calls, ...results].filter(([, count]) => count > 1).map(([id]) => id))].sort();
  let omittedInputRecords = groups.reduce((total, group) => total + group.length, 0);
  const base = { records: nativePrior, predecessor, duplicateCallIds, omittedInputRecords, session };
  // Bytes measure this typed envelope only; no serialization/reparse compiler route.
  let used = Buffer.byteLength(JSON.stringify(base));
  if (used > MAX_INPUT_BYTES) throw new CompactionInputError("mandatory metadata exceeds input envelope", "protected_overflow");
  const admitted: NormalizedRecord[][] = [];
  let admittedCount = nativePrior.length;
  for (let index = groups.length - 1; index >= 0; index--) {
    checkAbort(input.signal);
    const group = groups[index];
    if (!group.length) continue;
    const remaining = omittedInputRecords - group.length;
    const cost = Buffer.byteLength(JSON.stringify(group)) - 2 + (admittedCount ? 1 : 0)
      + String(remaining).length - String(omittedInputRecords).length;
    if (used + cost > MAX_INPUT_BYTES) continue;
    omittedInputRecords = remaining;
    used += cost;
    admitted.unshift(group);
    admittedCount += group.length;
  }
  return { records: [...nativePrior, ...admitted.flat()], predecessor, duplicateCallIds, omittedInputRecords, session };
}
