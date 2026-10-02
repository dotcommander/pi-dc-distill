import { checkpointDigest, emptyCheckpoint, validateCheckpoint, type ResumeCheckpointV1, type CheckpointSourceReference } from "./compiler/checkpoint.ts";
import { parseAnyStructuredDistillHandoff, DISTILL_HANDOFF_ENTRY_TYPE } from "./handoff.ts";
import { sha256Hex } from "./sha256.ts";
import { codePointLength, codePointPrefix } from "./unicode.ts";

export type CheckpointTarget = { kind: "pin" | "task"; id: string };
export type CheckpointSourceSelector =
  | { kind: "span"; entryId: string; messageIndex: number; blockIndex: number; start: number; end: number }
  | { kind: "excerpt"; excerpt: string }
  | { kind: "pin"; id: string };
export type CheckpointOperation =
  | { op: "pin"; id: string; purpose: "workset" | "constraint" | "request"; source: CheckpointSourceSelector }
  | { op: "resolve"; target: CheckpointTarget; reason: string }
  | { op: "supersede"; target: CheckpointTarget; replacement: CheckpointTarget; reason: string };
export interface CheckpointUpdateArgument {
  version: 1;
  expectedBase: { checkpointDigest: string | null; updateEntryId: string | null };
  operations: CheckpointOperation[];
}
export interface CheckpointUpdateBase {
  checkpoint: ResumeCheckpointV1 | null;
  checkpointDigest: string | null;
  updateEntryId: string | null;
}
export interface CheckpointUpdateContext extends CheckpointUpdateBase {
  occurrences: { message: Record<string, unknown>; reference: CheckpointSourceReference }[];
  nextUpdateEntryId: string;
  handoff?: string;
}
export interface SavedCheckpointUpdate {
  checkpoint: ResumeCheckpointV1;
  checkpointDigest: string;
  entryId: string;
  operations: (CheckpointOperation | { op: "pin"; id: string; purpose: "workset" | "constraint" | "request"; source: CheckpointSourceReference })[];
}

export class CheckpointUpdateError extends Error {
  constructor(message: string) { super(message); this.name = "CheckpointUpdateError"; }
}
function fail(message: string): never { throw new CheckpointUpdateError(message); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Expected an object.");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]): void {
  if (Object.keys(value).length !== expected.length || expected.some((key) => !Object.hasOwn(value, key))) fail("Unexpected checkpoint update fields.");
}
function text(value: unknown, max = 2048): asserts value is string {
  if (typeof value !== "string" || !value.trim() || codePointLength(value) > max || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail("Invalid bounded Unicode text.");
}
function id(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(value)) fail("Invalid checkpoint identifier.");
}
function target(value: unknown): asserts value is CheckpointTarget {
  const t = object(value); keys(t, ["kind", "id"]); id(t.id);
  if (t.kind !== "pin" && t.kind !== "task") fail("Invalid checkpoint target kind.");
}
/** Reject structural excess before serialization; counters cover the entire update. */
function checkStructure(value: unknown): void {
  const stack: { value: unknown; depth: number; exit?: boolean }[] = [{ value, depth: 0 }]; let values = 0; let containers = 0;
  const active = new Set<object>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current.exit) { active.delete(current.value as object); continue; }
    if (++values > 1_000_000 || current.depth > 64) fail("Checkpoint update structural budget exceeded.");
    if (typeof current.value === "string" && codePointLength(current.value) > 16_384) fail("Checkpoint update envelope exceeded.");
    if (current.value && typeof current.value === "object") {
      if (++containers > 100_000 || active.has(current.value)) fail("Checkpoint update containers exceeded or cyclic.");
      active.add(current.value);
      stack.push({ value: current.value, depth: current.depth, exit: true });
      for (const value of Object.values(current.value)) stack.push({ value, depth: current.depth + 1 });
    }
  }
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") fail("Invalid checkpoint update value.");
  if (codePointLength(serialized) > 16_384) fail("Checkpoint update envelope exceeded.");
}
export function validateCheckpointUpdate(value: unknown): CheckpointUpdateArgument {
  checkStructure(value);
  const update = object(value); keys(update, ["version", "expectedBase", "operations"]);
  if (update.version !== 1) fail("Unsupported checkpoint update version.");
  const base = object(update.expectedBase); keys(base, ["checkpointDigest", "updateEntryId"]);
  if (base.checkpointDigest !== null && (typeof base.checkpointDigest !== "string" || !/^[a-f0-9]{64}$/.test(base.checkpointDigest))) fail("Invalid checkpoint base digest.");
  if (base.updateEntryId !== null) text(base.updateEntryId, 512);
  if (!Array.isArray(update.operations) || update.operations.length > 32) fail("Checkpoint updates allow at most 32 operations.");
  for (const value of update.operations) {
    const operation = object(value);
    if (operation.op === "pin") {
      keys(operation, ["op", "id", "purpose", "source"]); id(operation.id);
      if (!["workset", "constraint", "request"].includes(String(operation.purpose))) fail("Invalid pin purpose.");
      const source = object(operation.source);
      if (source.kind === "span") {
        keys(source, ["kind", "entryId", "messageIndex", "blockIndex", "start", "end"]); text(source.entryId, 512);
        for (const field of ["messageIndex", "blockIndex", "start", "end"]) if (!Number.isSafeInteger(source[field]) || Number(source[field]) < 0) fail("Invalid source span.");
        if (Number(source.end) <= Number(source.start)) fail("Empty source span.");
      } else if (source.kind === "excerpt") { keys(source, ["kind", "excerpt"]); text(source.excerpt); }
      else if (source.kind === "pin") { keys(source, ["kind", "id"]); id(source.id); }
      else fail("Invalid pin source selector.");
    } else if (operation.op === "resolve" || operation.op === "supersede") {
      keys(operation, operation.op === "resolve" ? ["op", "target", "reason"] : ["op", "target", "replacement", "reason"]);
      target(operation.target); text(operation.reason);
      if (operation.op === "supersede") target(operation.replacement);
    } else fail("Unknown checkpoint operation.");
  }
  return value as CheckpointUpdateArgument;
}

function blockText(occurrence: CheckpointUpdateContext["occurrences"][number]): string {
  const content = occurrence.message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const block = content[occurrence.reference.blockIndex ?? 0] as { type?: string; text?: unknown } | undefined;
    if (block?.type === "text" && typeof block.text === "string") return block.text;
  }
  fail("Source reference does not identify a text block.");
}
function resolveSource(source: CheckpointSourceSelector, context: CheckpointUpdateContext, checkpoint: ResumeCheckpointV1): { text: string; source: CheckpointSourceReference } {
  if (source.kind === "pin") {
    const pin = checkpoint.pins.find((pin) => pin.id === source.id);
    if (!pin || pin.status !== "active" || pin.source.sourceKind !== "user") fail("Unknown or inactive validated user pin.");
    return { text: pin.text, source: { ...pin.source } };
  }
  let candidates = context.occurrences.filter((occurrence) => occurrence.reference.sourceKind === "user" && occurrence.message.role === "user");
  if (source.kind === "span") {
    candidates = candidates.filter(({ reference: ref }) => ref.entryId === source.entryId && (ref.messageIndex ?? 0) === source.messageIndex && (ref.blockIndex ?? 0) === source.blockIndex);
    if (candidates.length !== 1) fail("Ambiguous or missing user source occurrence.");
    const occurrence = candidates[0]; const whole = blockText(occurrence);
    if (sha256Hex(whole) !== occurrence.reference.contentDigest || source.end > codePointLength(whole)) fail("Source content or span changed.");
    const selected = codePointPrefix(whole, source.end).slice(codePointPrefix(whole, source.start).length);
    text(selected);
    return { text: selected, source: { ...occurrence.reference, start: source.start, end: source.end } };
  }
  const latest = candidates.at(-1);
  if (!latest) fail("No eligible user message.");
  candidates = candidates.filter(({ reference: ref }) => ref.entryId === latest.reference.entryId && ref.messageIndex === latest.reference.messageIndex);
  const matches: { text: string; source: CheckpointSourceReference }[] = [];
  for (const occurrence of candidates) {
    const whole = blockText(occurrence);
    if (sha256Hex(whole) !== occurrence.reference.contentDigest) fail("User source content changed.");
    let offset = 0;
    while ((offset = whole.indexOf(source.excerpt, offset)) >= 0) {
      const start = codePointLength(whole.slice(0, offset));
      matches.push({ text: source.excerpt, source: { ...occurrence.reference, start, end: start + codePointLength(source.excerpt) } });
      if (matches.length > 1) fail("User excerpt must match uniquely.");
      offset++;
    }
  }
  if (matches.length !== 1) fail("Excerpt absent from the latest eligible user message.");
  return matches[0];
}

/** Pure atomic reducer: no source mutation, evidence invention, or host side effects. */
export function prepareCheckpointUpdate(value: unknown, context: CheckpointUpdateContext): SavedCheckpointUpdate {
  const update = validateCheckpointUpdate(value);
  if (update.expectedBase.checkpointDigest !== context.checkpointDigest || update.expectedBase.updateEntryId !== context.updateEntryId) fail("Stale checkpoint base.");
  if (context.checkpoint) validateCheckpoint(context.checkpoint, context.checkpointDigest ?? undefined);
  const checkpoint: ResumeCheckpointV1 = structuredClone(context.checkpoint ?? emptyCheckpoint());
  if (context.checkpointDigest) checkpoint.predecessor = { checkpointDigest: context.checkpointDigest, entryId: context.updateEntryId };
  // New declarations may add work; absent or done prose cannot retire prior declarations.
  const handoff = context.handoff && parseAnyStructuredDistillHandoff(context.handoff);
  if (handoff && "version" in handoff) {
    checkpoint.objective = handoff.objective;
    for (const task of handoff.tasks) {
      const prior = checkpoint.tasks.find((item) => item.id === task.id);
      if (!prior) checkpoint.tasks.push({ ...task, requires: "requires" in task && Array.isArray(task.requires) ? [...task.requires] : [] });
      else if (prior.action !== task.action || JSON.stringify(prior["depends-on"]) !== JSON.stringify(task["depends-on"]) ||
        JSON.stringify(prior.requires) !== JSON.stringify("requires" in task && Array.isArray(task.requires) ? task.requires : [])) fail("Conflicting task identifier reuse.");
    }
    if (handoff.version === 3) for (const precondition of handoff.preconditions) {
      const prior = checkpoint.preconditions.find((item) => item.id === precondition.id);
      if (prior && JSON.stringify(prior) !== JSON.stringify(precondition)) fail("Conflicting precondition reuse.");
      if (!prior) checkpoint.preconditions.push({ ...precondition });
    }
    for (const invariant of handoff.invariants) if (!checkpoint.constraints.includes(invariant)) checkpoint.constraints.push(invariant);
    for (const decision of handoff.decisions) {
      const prior = checkpoint.decisions.find((item) => item.id === decision.id);
      if (prior && (prior.text !== decision.text || prior.rationale !== decision.rationale)) fail("Conflicting decision identifier reuse.");
      if (!prior) checkpoint.decisions.push({ ...decision });
    }
  } else if (handoff) {
    checkpoint.objective = handoff.objective;
    for (const action of [...handoff.next, ...handoff["verification-needed"]]) {
      const id = `legacy-${sha256Hex(action).slice(0, 16)}`;
      if (!checkpoint.tasks.some((task) => task.id === id)) checkpoint.tasks.push({ id, status: "pending", action, "depends-on": [], blocker: "", requires: [] });
    }
    for (const decision of handoff.decision) if (!checkpoint.decisions.some((item) => item.text === decision)) checkpoint.decisions.push({ id: `decision-${sha256Hex(decision).slice(0, 16)}`, text: decision, rationale: "agent declaration" });
    for (const risk of handoff.blocker) if (!checkpoint.risks.includes(risk)) checkpoint.risks.push(risk);
  }
  const canonical: SavedCheckpointUpdate["operations"] = [];
  const lookup = (target: CheckpointTarget) => {
    const item = target.kind === "pin" ? checkpoint.pins.find((pin) => pin.id === target.id) : checkpoint.tasks.find((task) => task.id === target.id);
    if (!item) fail("Unknown checkpoint target.");
    return item;
  };
  for (const operation of update.operations) {
    if (operation.op === "pin") {
      if (checkpoint.pins.some((pin) => pin.id === operation.id)) fail("Conflicting pin identifier reuse.");
      if (checkpoint.pins.length >= 32) fail("Protected pin budget exceeded.");
      const resolved = resolveSource(operation.source, context, checkpoint);
      checkpoint.pins.push({ id: operation.id, purpose: operation.purpose, ...resolved, status: "active" });
      canonical.push({ ...operation, source: resolved.source });
    } else {
      const item = lookup(operation.target);
      if (item.resolution) fail("Checkpoint target already resolved.");
      if (operation.op === "supersede") {
        if (operation.target.kind !== operation.replacement.kind || operation.target.id === operation.replacement.id) fail("Invalid cross-kind or cyclic supersession.");
        const replacement = lookup(operation.replacement);
        if (replacement.resolution) fail("Replacement must be unresolved.");
        if (operation.target.kind === "pin" && "purpose" in item && "purpose" in replacement && item.purpose !== replacement.purpose) fail("Pin purpose cannot be superseded across kinds.");
        let cursor = replacement;
        const seen = new Set([operation.target.id]);
        while (cursor.resolution?.replacement) {
          if (seen.has(cursor.resolution.replacement)) fail("Cyclic supersession.");
          seen.add(cursor.resolution.replacement);
          cursor = lookup({ kind: operation.target.kind, id: cursor.resolution.replacement });
        }
      }
      item.resolution = { reason: operation.reason, ...(operation.op === "supersede" ? { replacement: operation.replacement.id } : {}) };
      if (operation.target.kind === "pin") checkpoint.pins.find((pin) => pin.id === operation.target.id)!.status = operation.op === "resolve" ? "resolved" : "superseded";
      else { const task = checkpoint.tasks.find((task) => task.id === operation.target.id)!; task.status = "done"; task.blocker = ""; }
      canonical.push(structuredClone(operation));
    }
  }
  checkpoint.updateEntryId = context.nextUpdateEntryId;
  validateCheckpoint(checkpoint);
  return { checkpoint, checkpointDigest: checkpointDigest(checkpoint), entryId: context.nextUpdateEntryId, operations: canonical };
}

/** Only native compaction details and saved custom declarations carry checkpoint authority. */
export function readCheckpointUpdateBase(branch: Iterable<unknown>): CheckpointUpdateBase {
  let base: CheckpointUpdateBase = { checkpoint: null, checkpointDigest: null, updateEntryId: null };
  for (const value of branch) {
    const entry = value as { type?: string; customType?: string; id?: string; data?: Record<string, unknown>; details?: Record<string, unknown> };
    const data = entry.type === "custom" && entry.customType === DISTILL_HANDOFF_ENTRY_TYPE ? entry.data : entry.type === "compaction" ? entry.details : undefined;
    if (!data) continue;
    if (data.checkpoint === undefined) {
      if (entry.type === "compaction" && data.compactor === "dc-distill" && data.version === 13) fail("Expected v13 checkpoint is missing.");
      continue;
    }
    if (typeof data.checkpointDigest !== "string") fail("Expected checkpoint digest is missing.");
    const checkpoint = validateCheckpoint(data.checkpoint, data.checkpointDigest);
    if (entry.type === "custom") {
      if (typeof entry.id !== "string" || !entry.id) fail("Saved checkpoint update has no observed Pi entry identity.");
      checkpoint.updateEntryId = entry.id;
    }
    base = { checkpoint, checkpointDigest: checkpointDigest(checkpoint), updateEntryId: checkpoint.updateEntryId };
  }
  return base;
}
