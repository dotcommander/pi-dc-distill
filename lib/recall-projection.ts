import { resolve } from "node:path";
import { isDistillCompactor } from "./legacy.ts";
import { validateCheckpoint } from "./compiler/checkpoint.ts";
import { sha256Hex } from "./sha256.ts";
import type { CompactionRecallEntry } from "./recall-entry.ts";

/** Pure projection: callers supply only the owner session's active branch. */
export function projectActiveBranchRecall(entries: Iterable<unknown>, projectIdentity: string, sessionId: string): CompactionRecallEntry[] {
  if (!projectIdentity || !sessionId) return [];
  const projected: CompactionRecallEntry[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const details = entry.details as Record<string, unknown> | undefined;
    if (entry.type !== "compaction" || !details || !isDistillCompactor(details.compactor)) continue;
    if (typeof details.version !== "number" || !Number.isInteger(details.version) || details.version < 5 || details.version > 14) continue;
    if (typeof entry.id !== "string" || !entry.id || typeof entry.timestamp !== "string" || !Number.isFinite(Date.parse(entry.timestamp))) continue;
    if (typeof entry.summary !== "string" || !entry.summary || typeof entry.firstKeptEntryId !== "string" || !entry.firstKeptEntryId) continue;
    const before = entry.tokensBefore;
    const after = details.tokensAfter;
    if (typeof before !== "number" || !Number.isFinite(before) || before < 0
      || typeof after !== "number" || !Number.isFinite(after) || after < 0) continue;
    const digest = details.summaryDigest;
    if (details.version >= 10 && (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)
      || sha256Hex(entry.summary) !== digest || typeof details.attemptId !== "string" || !details.attemptId
      || details.tokensAfterSource !== "pi-rebuilt-message-estimate")) continue;
    if (details.version === 13 || details.version === 14) {
      try {
        if (typeof details.checkpointDigest !== "string") continue;
        validateCheckpoint(details.checkpoint, details.checkpointDigest);
      } catch { continue; }
    }
    projected.push({ ts: entry.timestamp, before, after, summary: entry.summary,
      project: resolve(projectIdentity), sessionId, compactionEntryId: entry.id,
      ...(typeof digest === "string" ? { summaryDigest: digest } : {}),
      ...(typeof details.attemptId === "string" ? { attemptId: details.attemptId } : {}),
      ...(typeof details.tokensAfterSource === "string" ? { tokenSource: details.tokensAfterSource } : {}),
    });
  }
  return projected;
}
