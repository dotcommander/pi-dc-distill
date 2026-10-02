import { isDistillHandoffType } from "./legacy.ts";
import type { SessionEntry } from "./sdk.ts";
import { DISTILL_HANDOFF_ENTRY_TYPE, handoffTextFromEntryData } from "./handoff.ts";

const MAX_INPUT_BYTES = 20 * 1024 * 1024;
type AgentMessage = Record<string, unknown>;

export interface CompactionSource {
  previousSummary?: string;
  messagesToSummarize: AgentMessage[];
  turnPrefixMessages: AgentMessage[];
  handoff?: string;
  session: { id: string; cwd: string; timestamp: string };
}

export interface CanonicalCompactionInput {
  bytes: string;
  digestScope: "compaction-input" | "bounded-compaction-input";
  recordCount: number;
}

export class CompactionCancelledError extends Error {
  constructor() {
    super("compaction cancelled");
    this.name = "CompactionCancelledError";
  }
}

function check(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CompactionCancelledError();
}

function latestHandoff(entries: SessionEntry[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index] as { type?: string; customType?: string; data?: unknown };
    if (entry.type !== "custom" || !isDistillHandoffType(entry.customType)) continue;
    const handoff = handoffTextFromEntryData(entry.data);
    if (handoff) return handoff;
  }
  return undefined;
}

export function buildCompactionSource(input: {
  previousSummary?: string;
  messagesToSummarize?: AgentMessage[];
  turnPrefixMessages?: AgentMessage[];
  branchEntries: SessionEntry[];
  sessionId: string;
  cwd: string;
  timestamp?: string;
}): CompactionSource {
  return {
    previousSummary: input.previousSummary?.trim() || undefined,
    messagesToSummarize: [...(input.messagesToSummarize ?? [])],
    turnPrefixMessages: [...(input.turnPrefixMessages ?? [])],
    handoff: latestHandoff(input.branchEntries),
    session: {
      id: input.sessionId,
      cwd: input.cwd,
      timestamp: input.timestamp ?? new Date(0).toISOString(),
    },
  };
}

export function canonicalRecordFromMessage(message: AgentMessage): Record<string, unknown> | undefined {
  const value = message as unknown as Record<string, unknown>;
  switch (value.role) {
    case "user":
    case "assistant":
    case "toolResult":
      return { type: "message", message };
    case "bashExecution":
      return {
        type: "message",
        message: {
          role: "user",
          content: `! ${String(value.command ?? "")}\n${String(value.output ?? "")}\n(exit ${String(value.exitCode ?? "unknown")})`,
        },
      };
    case "custom":
      return {
        type: "custom_message",
        customType: String(value.customType ?? "custom"),
        content: value.content ?? "",
      };
    case "branchSummary":
      return { type: "branch_summary", summary: String(value.summary ?? "") };
    case "compactionSummary":
      return { type: "compaction", summary: String(value.summary ?? "") };
    default:
      return undefined;
  }
}

function recordBytes(record: string): number {
  return Buffer.byteLength(record, "utf8") + 1;
}

export function canonicalizeCompactionSource(
  source: CompactionSource,
  signal?: AbortSignal,
): CanonicalCompactionInput {
  check(signal);
  const required: string[] = [JSON.stringify({ type: "session", ...source.session })];
  if (source.previousSummary) {
    required.push(JSON.stringify({ type: "compaction", summary: source.previousSummary }));
  }

  const discarded: string[] = [];
  const ordered = [...source.messagesToSummarize, ...source.turnPrefixMessages];
  for (let index = 0; index < ordered.length; index++) {
    if (index % 128 === 0) check(signal);
    const record = canonicalRecordFromMessage(ordered[index]);
    if (record) discarded.push(JSON.stringify(record));
  }
  if (source.handoff) {
    discarded.push(JSON.stringify({
      type: "custom",
      customType: DISTILL_HANDOFF_ENTRY_TYPE,
      data: { handoff: source.handoff },
    }));
  }
  check(signal);

  const requiredBytes = required.reduce((total, record) => total + recordBytes(record), 0);
  const discardedBytes = discarded.map(recordBytes);
  const totalBytes = discardedBytes.reduce((total, size) => total + size, requiredBytes);
  let selected = discarded;
  let digestScope: CanonicalCompactionInput["digestScope"] = "compaction-input";
  if (totalBytes > MAX_INPUT_BYTES) {
    if (requiredBytes > MAX_INPUT_BYTES) {
      throw new Error("required compaction metadata exceeds the 20 MiB input envelope");
    }
    digestScope = "bounded-compaction-input";
    selected = [];
    let selectedBytes = requiredBytes;
    for (let index = discarded.length - 1; index >= 0; index--) {
      if (selectedBytes + discardedBytes[index] > MAX_INPUT_BYTES) continue;
      selected.push(discarded[index]);
      selectedBytes += discardedBytes[index];
      if (index % 128 === 0) check(signal);
    }
    selected.reverse();
  }
  check(signal);
  return {
    bytes: required.concat(selected).join("\n") + "\n",
    digestScope,
    recordCount: required.length + selected.length - 1,
  };
}
