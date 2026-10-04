import { isDeepStrictEqual, types } from "node:util";
import { createHash } from "node:crypto";
import { buildSessionProjection } from "./sdk.ts";
import { validateCheckpoint, checkpointDigest, type ResumeCheckpointV1, type CheckpointSourceReference } from "./compiler/checkpoint.ts";
import { CompactionInputError } from "./compiler/errors.ts";
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
  previousCheckpoint?: ResumeCheckpointV1;
  previousCheckpointDigest?: string;
  previousSummaryDigest?: string;
  predecessorEntryId?: string;
  checkpointUpdates?: { checkpoint: ResumeCheckpointV1; checkpointDigest: string; entryId: string }[];
  occurrences?: SourceOccurrence[];
  mandatoryMessages?: AgentMessage[];
  messageReferences?: CheckpointSourceReference[][];
  handoffReference?: CheckpointSourceReference;
  protectedHandoffs?: { handoff: string; sourceReference: CheckpointSourceReference }[];
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

export interface SourceOccurrence {
  message: AgentMessage;
  reference: CheckpointSourceReference;
}

function sourceKind(message: AgentMessage): CheckpointSourceReference["sourceKind"] {
  if (message.role === "user") return "user";
  if (message.role === "bashExecution") return "bash";
  if (message.role === "assistant" || message.role === "custom") return "agent-declaration";
  if (message.role === "toolResult") return "tool-observation";
  return "legacy";
}

/** References describe projected occurrences, never a guessed match by prose. */
export function sourceOccurrences(entries: SessionEntry[], sessionId: string, eligibleEntryIds?: ReadonlySet<string>): SourceOccurrence[] {
  const result: SourceOccurrence[] = [];
  const budget: StructuralBudget = { values: 0, containers: 0 };
  for (const projected of buildSessionProjection(entries).entries) {
    if (projected.sourceEntry.type === "compaction" || (eligibleEntryIds && !eligibleEntryIds.has(projected.sourceEntry.id))) continue;
    projected.messages.forEach((raw, messageIndex) => {
      const message = raw as unknown as AgentMessage;
      if (message.role === "system") return;
      const content = message.content ?? (message.role === "bashExecution"
        ? { command: message.command, output: message.output, exitCode: message.exitCode } : message.summary);
      const blocks = Array.isArray(content) ? content : [content ?? message];
      blocks.forEach((block, blockIndex) => {
        const text = typeof block === "string" ? block : block && typeof block === "object" && typeof block.text === "string" ? block.text : undefined;
        const hash = createHash("sha256");
        if (typeof text === "string") hash.update(text, "utf8");
        else {
          const writer = new CappedJsonWriter(Buffer.allocUnsafe(0), 0, Infinity, undefined, budget, hash);
          writer.value(block);
        }
        result.push({ message, reference: { sessionId, entryId: projected.sourceEntry.id,
          messageIndex, blockIndex, contentDigest: hash.digest("hex"), sourceKind: sourceKind(message) } });
      });
    });
  }
  return result;
}

export function buildCompactionSource(input: {
  previousSummary?: string;
  messagesToSummarize?: AgentMessage[];
  turnPrefixMessages?: AgentMessage[];
  firstKeptEntryId?: string;
  branchEntries: SessionEntry[];
  sessionId: string;
  cwd: string;
  timestamp?: string;
}): CompactionSource {
  const messagesToSummarize = input.messagesToSummarize ?? [];
  const turnPrefixMessages = input.turnPrefixMessages ?? [];
  if (messagesToSummarize.length + turnPrefixMessages.length > 50_000)
    throw new CompactionInputError("required_analysis_exhausted: discarded message record limit", "required_analysis_overflow");
  const source: CompactionSource = {
    previousSummary: input.previousSummary,
    messagesToSummarize, turnPrefixMessages,
    handoff: latestHandoff(input.branchEntries),
    session: { id: input.sessionId, cwd: input.cwd, timestamp: input.timestamp ?? new Date(0).toISOString() },
  };
  // The boundary is mandatory in production. Its absence preserves the offline
  // diagnostic API, which has no authority to attach durable checkpoint state.
  if (input.firstKeptEntryId === undefined) return source;
  const rawIds = input.branchEntries.map(entry => entry.id);
  if (rawIds.some(id => typeof id !== "string" || !id) || new Set(rawIds).size !== rawIds.length)
    throw new CompactionInputError("inconsistent_projection: missing or duplicate branch identity", "invalid_input");
  const projected = buildSessionProjection(input.branchEntries).entries;
  const ids = projected.map(entry => entry.sourceEntry.id);
  if (new Set(ids).size !== ids.length) throw new CompactionInputError("inconsistent_projection: duplicate entry identity", "invalid_input");
  const previous = projected.findIndex(entry => entry.sourceEntry.type === "compaction" && entry.messages.length > 0);
  const prior = previous >= 0 ? projected[previous].sourceEntry : undefined;
  if ((prior?.type === "compaction" ? prior.summary : undefined) !== input.previousSummary)
    throw new CompactionInputError("inconsistent_projection: previous summary differs from preparation", "invalid_input");
  const start = previous + 1;
  const end = ids.indexOf(input.firstKeptEntryId);
  if (end < start) throw new CompactionInputError("inconsistent_projection: missing discarded boundary", "invalid_input");
  const discarded = projected.slice(start, end);
  const flatten = (entries: typeof discarded) => entries.flatMap(entry => entry.sourceEntry.type === "compaction"
    ? [] : entry.messages.filter(message => message.role !== "system")) as unknown as AgentMessage[];
  // Require each partition boundary to coincide with a projected entry. Repeated
  // text does not grant identity: only the authoritative sequence and cut agree.
  const all = flatten(discarded);
  if (!isDeepStrictEqual(all, [...messagesToSummarize, ...turnPrefixMessages]))
    throw new CompactionInputError("inconsistent_projection: preparation partitions differ from projected messages", "invalid_input");
  let count = 0;
  let partitionExists = messagesToSummarize.length === 0;
  for (const entry of discarded) {
    count += flatten([entry]).length;
    if (count === messagesToSummarize.length) partitionExists = true;
  }
  if (!partitionExists) throw new CompactionInputError("inconsistent_projection: partition splits a projected entry", "invalid_input");
  const discardedIds = new Set(discarded.map(entry => entry.sourceEntry.id));
  source.occurrences = sourceOccurrences(input.branchEntries, input.sessionId, discardedIds);
  const referenceByMessage = new Map<string, CheckpointSourceReference[]>();
  for (const occurrence of source.occurrences) {
    const key = `${occurrence.reference.entryId}:${occurrence.reference.messageIndex}`;
    const references = referenceByMessage.get(key) ?? [];
    references.push(occurrence.reference);
    referenceByMessage.set(key, references);
  }
  source.messageReferences = discarded.flatMap(entry => entry.sourceEntry.type === "compaction" ? [] :
    entry.messages.map((message, messageIndex) => ({ message, messageIndex })).filter(item => item.message.role !== "system")
      .map(item => referenceByMessage.get(`${entry.sourceEntry.id}:${item.messageIndex}`) ?? []));
  const details = prior?.type === "compaction" ? prior.details as Record<string, unknown> | undefined : undefined;
  if (details?.compactor === "dc-distill" && details.version === 13) {
    if (prior?.type !== "compaction" || typeof details.summaryDigest !== "string" ||
        createHash("sha256").update(prior.summary, "utf8").digest("hex") !== details.summaryDigest)
      throw new CompactionInputError("invalid_checkpoint: prior wire summary digest mismatch", "invalid_checkpoint");
    if (typeof details.checkpointDigest !== "string") throw new CompactionInputError("invalid_checkpoint: missing checkpoint digest", "invalid_checkpoint");
    source.previousSummaryDigest = details.summaryDigest;
    source.previousCheckpoint = validateCheckpoint(details.checkpoint, details.checkpointDigest as string);
    source.previousCheckpointDigest = details.checkpointDigest as string;
    source.predecessorEntryId = prior!.id;
  }
  source.checkpointUpdates = [];
  for (const entry of discarded) {
    const raw = entry.sourceEntry as unknown as { type: string; id: string; customType?: string; data?: Record<string, unknown> };
    if (raw.type !== "custom" || !isDistillHandoffType(raw.customType)) continue;
    const data = raw.data;
    if (data?.checkpoint !== undefined) {
      if (typeof data.checkpointDigest !== "string") throw new CompactionInputError("invalid_checkpoint: missing update digest", "invalid_checkpoint");
      const checkpoint = validateCheckpoint(data.checkpoint, data.checkpointDigest as string);
      checkpoint.updateEntryId = raw.id;
      source.checkpointUpdates.push({ checkpoint, checkpointDigest: checkpointDigest(checkpoint), entryId: raw.id });
    }
  }
  // Evidence/declarations cannot be discarded by the optional lexical selector.
  source.mandatoryMessages = [...messagesToSummarize, ...turnPrefixMessages].filter(message =>
    message.role === "toolResult" || message.role === "bashExecution" ||
    (message.role === "assistant" && Array.isArray(message.content) && message.content.some(block => block?.type === "toolCall")));
  // Only discarded custom declarations can create authority. A retained custom
  // entry is not promoted into the compiler merely because it is the latest.
  source.handoff = latestHandoff(discarded.map(entry => entry.sourceEntry));
  source.protectedHandoffs = [];
  for (const entry of discarded) {
    const raw = entry.sourceEntry as unknown as { type: string; customType?: string; data?: unknown };
    if (raw.type !== "custom" || !isDistillHandoffType(raw.customType)) continue;
    const handoff = handoffTextFromEntryData(raw.data);
    if (!handoff) continue;
    const sourceReference: CheckpointSourceReference = { sessionId: input.sessionId, entryId: entry.sourceEntry.id,
      contentDigest: createHash("sha256").update(handoff, "utf8").digest("hex"), sourceKind: "agent-declaration" };
    source.protectedHandoffs.push({ handoff, sourceReference });
  }
  source.handoffReference = source.protectedHandoffs.at(-1)?.sourceReference;
  return source;
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

// Start small for ordinary sessions; grow only when bounded validated writes
// require it. Accepted records stay at the tail as capacity changes.
class BoundedUtf8Arena {
  buffer = Buffer.allocUnsafe(64 * 1024);
  tailLength = 0;

  write(text: string, offset: number, size: number, encoding: BufferEncoding): number {
    const needed = offset + size + this.tailLength;
    if (needed > MAX_INPUT_BYTES) throw new CompactionInputError("protected_overflow: UTF-8 arena limit", "protected_overflow");
    if (needed > this.buffer.length) {
      const capacity = Math.min(MAX_INPUT_BYTES, Math.max(needed, this.buffer.length * 2));
      const next = Buffer.allocUnsafe(capacity);
      this.buffer.copy(next, 0, 0, offset);
      if (this.tailLength) this.buffer.copy(next, capacity - this.tailLength, this.buffer.length - this.tailLength);
      this.buffer = next;
    }
    return this.buffer.write(text, offset, size, encoding);
  }

  prependTail(start: number, end: number): void {
    const length = end - start;
    const target = this.buffer.length - this.tailLength - length;
    this.buffer.copy(this.buffer, target, start, end);
    this.tailLength += length;
  }

  publish(headLength: number): string {
    this.buffer.copy(this.buffer, headLength, this.buffer.length - this.tailLength);
    return this.buffer.toString("utf8", 0, headLength + this.tailLength);
  }
}

interface StructuralBudget { values: number; containers: number }

class CappedJsonWriter {
  offset: number;
  overflow = false;
  private readonly ancestors = new Set<object>();

  constructor(
    private readonly arena: Buffer | BoundedUtf8Arena,
    start: number,
    private readonly limit: number,
    private readonly signal?: AbortSignal,
    private readonly budget: StructuralBudget = { values: 0, containers: 0 },
    private readonly hash?: ReturnType<typeof createHash>,
  ) { this.offset = start; }

  raw(text: string): void {
    check(this.signal);
    if (this.overflow) return;
    const size = Buffer.byteLength(text, "utf8");
    if (size > this.limit - this.offset) {
      this.overflow = true;
      return;
    }
    if (this.hash) { this.hash.update(text, "utf8"); this.offset += size; }
    else this.offset += this.arena.write(text, this.offset, size, "utf8");
  }

  stringParts(parts: readonly string[]): void {
    this.raw('"');
    for (const part of parts) {
      // JSON.stringify only sees bounded pieces. Keep surrogate pairs together
      // so native escaping of lone surrogates and UTF-8 encoding stay exact.
      for (let start = 0; start < part.length;) {
        let end = Math.min(start + 4096, part.length);
        const last = part.charCodeAt(end - 1);
        const next = part.charCodeAt(end);
        if (end < part.length && last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
        check(this.signal);
        if (!this.overflow) this.raw(JSON.stringify(part.slice(start, end)).slice(1, -1));
        start = end;
      }
    }
    this.raw('"');
  }

  private prepare(value: unknown, key: string): unknown {
    if ((typeof value === "object" && value !== null) || typeof value === "function" || typeof value === "bigint") {
      const toJSON = (value as { toJSON?: unknown }).toJSON;
      if (typeof toJSON === "function") value = toJSON.call(value, key);
    }
    // Native brand checks include boxed primitives from other realms and do
    // not invoke user-defined Symbol.toStringTag getters on ordinary objects.
    if (types.isNumberObject(value)) value = Number(value);
    else if (types.isStringObject(value)) value = String(value);
    else if (types.isBooleanObject(value)) value = Boolean.prototype.valueOf.call(value);
    else if (types.isBigIntObject(value)) value = BigInt.prototype.valueOf.call(value);
    return value;
  }

  value(input: unknown, key = ""): boolean {
    return this.prepared(this.prepare(input, key));
  }

  private prepared(value: unknown): boolean {
    check(this.signal);
    if (++this.budget.values > 1_000_000) throw new CompactionInputError("required_analysis_exhausted: visited value limit", "required_analysis_overflow");
    if (value === null) this.raw("null");
    else if (typeof value === "string") this.stringParts([value]);
    else if (typeof value === "number") this.raw(Number.isFinite(value) ? String(value) : "null");
    else if (typeof value === "boolean") this.raw(String(value));
    else if (typeof value === "bigint") throw new TypeError("Do not know how to serialize a BigInt");
    else if (typeof value !== "object") return false;
    else {
      if (this.ancestors.size >= 64 || ++this.budget.containers > 100_000)
        throw new CompactionInputError("required_analysis_exhausted: container limit", "required_analysis_overflow");
      if (this.ancestors.has(value)) throw new TypeError("Converting circular structure to JSON");
      this.ancestors.add(value);
      try {
        if (Array.isArray(value)) {
          this.raw("[");
          const length = value.length;
          for (let index = 0; index < length; index++) {
            if (index) this.raw(",");
            if (!this.value(value[index], String(index))) this.raw("null");
          }
          this.raw("]");
        } else {
          this.raw("{");
          let first = true;
          for (const key of Object.keys(value)) {
            const child = this.prepare((value as Record<string, unknown>)[key], key);
            if (child === undefined || typeof child === "function" || typeof child === "symbol") continue;
            if (!first) this.raw(",");
            first = false;
            this.stringParts([key]);
            this.raw(":");
            this.prepared(child);
          }
          this.raw("}");
        }
      } finally { this.ancestors.delete(value); }
    }
    return true;
  }
}

function writeMessage(writer: CappedJsonWriter, message: AgentMessage, provenance = false, sourceReferences?: CheckpointSourceReference[]): boolean {
  if (message.role === "bashExecution") {
    if (provenance) {
      writer.raw('{"sourceKind":"bash","sourceReferences":');
      writer.value(sourceReferences ?? []);
      writer.raw(',"type":"message","message":{"role":"user","content":');
    } else writer.raw('{"type":"message","message":{"role":"user","content":');
    writer.stringParts(["! ", String(message.command ?? ""), "\n", String(message.output ?? ""), "\n(exit ", String(message.exitCode ?? "unknown"), ")"]);
    writer.raw("}}");
    return true;
  }
  const record = canonicalRecordFromMessage(message);
  if (!record) return false;
  writer.value(provenance ? { ...record, sourceKind: sourceKind(message), sourceReferences } : record);
  return true;
}

export function canonicalizeCompactionSource(
  source: CompactionSource,
  signal?: AbortSignal,
): CanonicalCompactionInput {
  check(signal);
  const arena = new BoundedUtf8Arena();
  const budget: StructuralBudget = { values: 0, containers: 0 };
  const required = new CappedJsonWriter(arena, 0, MAX_INPUT_BYTES, signal, budget);
  required.value({ type: "session", ...source.session,
    ...(source.previousCheckpoint ? { checkpoint: source.previousCheckpoint, checkpointDigest: source.previousCheckpointDigest,
      predecessorEntryId: source.predecessorEntryId } : {}),
    ...(source.checkpointUpdates?.length ? { checkpointUpdates: source.checkpointUpdates } : {}),
    ...(source.occurrences?.length ? { occurrences: source.occurrences.map(item => item.reference) } : {}),
  });
  required.raw("\n");
  let recordCount = 0;
  if (source.previousSummary) {
    required.value({ type: "compaction", id: source.predecessorEntryId, summary: source.previousSummary,
      ...(source.previousSummaryDigest ? { details: { compactor: "dc-distill", version: 13, summaryDigest: source.previousSummaryDigest,
        checkpoint: source.previousCheckpoint, checkpointDigest: source.previousCheckpointDigest } } : {}) });
    required.raw("\n");
    recordCount++;
  }
  const mandatory = new Set(source.mandatoryMessages ?? []);
  const handoffs = source.protectedHandoffs ?? (source.handoff ? [{ handoff: source.handoff, sourceReference: source.handoffReference }] : []);
  const protectedHandoff = source.protectedHandoffs !== undefined;
  // Reservation and serialization each enforce the aggregate structural limits.
  // Include metadata in both, but never charge protected records twice to the
  // serialization budget simply because their byte reservations need preflight.
  const preflightBudget: StructuralBudget = { ...budget };
  let reserved = 0;
  const measure = (write: (writer: CappedJsonWriter) => boolean): void => {
    const candidate = new CappedJsonWriter(arena, required.offset, MAX_INPUT_BYTES, signal, preflightBudget);
    if (!write(candidate)) return;
    candidate.raw("\n");
    reserved += candidate.offset - required.offset;
    if (candidate.overflow || reserved > MAX_INPUT_BYTES - required.offset)
      throw new CompactionInputError("protected_overflow: required compaction metadata exceeds the 20 MiB input envelope", "protected_overflow");
  };
  const orderedMessages = [...source.messagesToSummarize, ...source.turnPrefixMessages];
  orderedMessages.forEach((message, index) => {
    if (mandatory.has(message)) measure(writer => writeMessage(writer, message, source.occurrences !== undefined, source.messageReferences?.[index]));
  });
  if (protectedHandoff) for (const item of handoffs) measure(writer => writer.value({ type: "custom", customType: DISTILL_HANDOFF_ENTRY_TYPE, data: { handoff: item.handoff }, sourceReference: item.sourceReference }));
  if (required.overflow) throw new CompactionInputError("protected_overflow: required compaction metadata exceeds the 20 MiB input envelope", "protected_overflow");

  // Accepted newer records occupy the growing arena's tail in chronological order.
  // Serialize each candidate into the remaining gap and move it to that tail
  // only if the entire record and its newline fit. Still traverse rejected
  // records to catch malformed values, circular data, and cancellation.

  let digestScope: CanonicalCompactionInput["digestScope"] = "compaction-input";
  const accept = (write: (writer: CappedJsonWriter) => boolean, protectedRecord = false): void => {
    const candidate = new CappedJsonWriter(arena, required.offset, MAX_INPUT_BYTES - arena.tailLength - (protectedRecord ? 0 : reserved), signal, budget);
    if (!write(candidate)) return;
    candidate.raw("\n");
    if (candidate.overflow) {
      if (protectedRecord) throw new CompactionInputError("protected_overflow: required record changed during serialization", "protected_overflow");
      digestScope = "bounded-compaction-input"; return;
    }
    const length = candidate.offset - required.offset;
    if (protectedRecord) reserved -= length;
    arena.prependTail(required.offset, candidate.offset);
    recordCount++;
  };
  for (let index = handoffs.length - 1; index >= 0; index--) {
    const item = handoffs[index];
    accept(writer => writer.value({ type: "custom", customType: DISTILL_HANDOFF_ENTRY_TYPE,
      data: { handoff: item.handoff }, sourceReference: item.sourceReference }), protectedHandoff);
  }
  for (const messages of [source.turnPrefixMessages, source.messagesToSummarize]) {
    for (let index = messages.length - 1; index >= 0; index--) {
      check(signal);
      accept(writer => writeMessage(writer, messages[index], source.occurrences !== undefined, source.messageReferences?.[index + (messages === source.turnPrefixMessages ? source.messagesToSummarize.length : 0)]), mandatory.has(messages[index]));
    }
  }
  check(signal);
  return {
    bytes: arena.publish(required.offset),
    digestScope,
    recordCount,
  };
}
