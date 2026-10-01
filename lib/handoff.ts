import { normalizeLegacyHandoffFence } from "./legacy.ts";

export const DISTILL_HANDOFF_ENTRY_TYPE = "dc-distill-handoff";

export interface DistillHandoffEntry {
  handoff: string;
  ts: string;
}

export interface StructuredDistillHandoff {
  objective: string;
  done: string[];
  next: string[];
  blocker: string[];
  decision: string[];
  "verification-needed": string[];
}

export interface DistillHandoffDecision {
  id: string;
  text: string;
  rationale: string;
}

export interface DistillHandoffRejectedHypothesis {
  id: string;
  claim: string;
  evidence: string;
}

export interface DistillHandoffTask {
  id: string;
  status: "done" | "pending" | "blocked";
  action: string;
  "depends-on": string[];
  blocker: string;
}

/** Strict execution-graph handoff. `version` is parser metadata, not an envelope key. */
export interface StructuredDistillHandoffV2 {
  version: 2;
  objective: string;
  invariants: string[];
  decisions: DistillHandoffDecision[];
  "rejected-hypotheses": DistillHandoffRejectedHypothesis[];
  tasks: DistillHandoffTask[];
  "verification-needed": string[];
}

export type ParsedStructuredDistillHandoff =
  | StructuredDistillHandoff
  | StructuredDistillHandoffV2;

const STRUCTURED_HANDOFF_KEYS = [
  "objective",
  "done",
  "next",
  "blocker",
  "decision",
  "verification-needed",
] as const;
const STRUCTURED_HANDOFF_MAX_CODE_POINTS = 16_384;
const STRUCTURED_HANDOFF_MAX_ITEMS = 32;
const STRUCTURED_HANDOFF_MAX_ITEM_CODE_POINTS = 2_048;
const STRUCTURED_HANDOFF_RE = /^\s*```distill-handoff-v1\n([\s\S]*?)\n```\s*$/;
const STRUCTURED_HANDOFF_V2_RE = /^\s*```distill-handoff-v2\n([\s\S]*?)\n```\s*$/;
const STRUCTURED_HANDOFF_V2_KEYS = [
  "objective",
  "invariants",
  "decisions",
  "rejected-hypotheses",
  "tasks",
  "verification-needed",
] as const;
const HANDOFF_ID_RE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;

export function distillHandoffEntry(
  handoff: string,
  now = new Date(),
): DistillHandoffEntry {
  return {
    handoff: handoff.trim(),
    ts: now.toISOString(),
  };
}

function withinCodePointLimit(value: string, limit: number): boolean {
  return Array.from(value).length <= limit;
}

function hasExactlyKeys(record: object, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function hasNoDuplicateObjectKeys(json: string): boolean {
  const stack: Array<{ type: "object" | "array"; keys?: Set<string>; expectingKey?: boolean }> = [];
  for (let index = 0; index < json.length; index++) {
    const char = json[index];
    if (char === '"') {
      const start = index;
      index++;
      while (index < json.length) {
        if (json[index] === "\\") {
          index += 2;
          continue;
        }
        if (json[index] === '"') break;
        index++;
      }
      if (index >= json.length) return false;
      const top = stack.at(-1);
      if (top?.type === "object" && top.expectingKey) {
        let key: string;
        try {
          key = JSON.parse(json.slice(start, index + 1));
        } catch {
          return false;
        }
        if (top.keys!.has(key)) return false;
        top.keys!.add(key);
        top.expectingKey = false;
      }
      continue;
    }
    if (char === "{") stack.push({ type: "object", keys: new Set(), expectingKey: true });
    else if (char === "[") stack.push({ type: "array" });
    else if (char === "}" || char === "]") stack.pop();
    else if (char === "," && stack.at(-1)?.type === "object") stack.at(-1)!.expectingKey = true;
  }
  return stack.length === 0;
}

function isNonEmptyBoundedString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    withinCodePointLimit(value, STRUCTURED_HANDOFF_MAX_ITEM_CODE_POINTS);
}

function hasUniqueBoundedIds<T extends { id: string }>(items: T[]): boolean {
  const ids = new Set<string>();
  return items.every(({ id }) => HANDOFF_ID_RE.test(id) && !ids.has(id) && !!ids.add(id));
}

function hasCycle(tasks: DistillHandoffTask[]): boolean {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const cyclic = byId.get(id)!["depends-on"].some(visit);
    visiting.delete(id);
    visited.add(id);
    return cyclic;
  };
  return tasks.some((task) => visit(task.id));
}

/** Returns ready pending tasks in a stable topological (then source) order. */
export function readyDistillHandoffTasks(
  handoff: StructuredDistillHandoffV2,
): DistillHandoffTask[] {
  const sourceIndex = new Map(handoff.tasks.map((task, index) => [task.id, index]));
  const dependents = new Map(handoff.tasks.map((task) => [task.id, [] as string[]]));
  const remaining = new Map(handoff.tasks.map((task) => [task.id, task["depends-on"].length]));
  for (const task of handoff.tasks) {
    for (const dependency of task["depends-on"]) dependents.get(dependency)!.push(task.id);
  }
  const available = handoff.tasks.filter((task) => remaining.get(task.id) === 0);
  const ordered: DistillHandoffTask[] = [];
  while (available.length > 0) {
    available.sort((left, right) => sourceIndex.get(left.id)! - sourceIndex.get(right.id)!);
    const task = available.shift()!;
    ordered.push(task);
    for (const dependent of dependents.get(task.id)!) {
      const count = remaining.get(dependent)! - 1;
      remaining.set(dependent, count);
      if (count === 0) available.push(handoff.tasks[sourceIndex.get(dependent)!]);
    }
  }
  const status = new Map(handoff.tasks.map((task) => [task.id, task.status]));
  return ordered.filter((task) =>
    task.status === "pending" && task["depends-on"].every((dependency) => status.get(dependency) === "done"));
}

/** Parse only the explicit, whole-message v1 envelope. Invalid envelopes stay legacy text. */
export function parseStructuredDistillHandoff(
  text: string,
): StructuredDistillHandoff | undefined {
  if (!withinCodePointLimit(text, STRUCTURED_HANDOFF_MAX_CODE_POINTS)) return undefined;
  const match = normalizeLegacyHandoffFence(text).match(STRUCTURED_HANDOFF_RE);
  if (!match) return undefined;
  const json = match[1];
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== STRUCTURED_HANDOFF_KEYS.length) return undefined;
  if (Object.keys(record).some((key) =>
    !STRUCTURED_HANDOFF_KEYS.some((allowed) => allowed === key))) return undefined;
  // JSON.parse accepts duplicate object keys. Reject any envelope whose raw key count
  // is not exactly one per required field; false-positive rejection safely falls back.
  for (const key of STRUCTURED_HANDOFF_KEYS) {
    const occurrences = [...json.matchAll(new RegExp(`"${key.replace("-", "\\-")}"\\s*:`, "g"))].length;
    if (occurrences !== 1) return undefined;
  }
  if (typeof record.objective !== "string" || !record.objective.trim()) return undefined;
  if (!withinCodePointLimit(record.objective, STRUCTURED_HANDOFF_MAX_ITEM_CODE_POINTS)) return undefined;
  for (const key of STRUCTURED_HANDOFF_KEYS.slice(1)) {
    const items = record[key];
    if (!Array.isArray(items) || items.length > STRUCTURED_HANDOFF_MAX_ITEMS) return undefined;
    if (items.some((item) =>
      typeof item !== "string" || !item.trim() ||
      !withinCodePointLimit(item, STRUCTURED_HANDOFF_MAX_ITEM_CODE_POINTS))) return undefined;
  }
  return {
    objective: record.objective.trim(),
    done: (record.done as string[]).map((item) => item.trim()),
    next: (record.next as string[]).map((item) => item.trim()),
    blocker: (record.blocker as string[]).map((item) => item.trim()),
    decision: (record.decision as string[]).map((item) => item.trim()),
    "verification-needed": (record["verification-needed"] as string[]).map((item) => item.trim()),
  };
}

/** Parse the strict whole-message v2 envelope. Invalid input is always opaque text. */
export function parseStructuredDistillHandoffV2(
  text: string,
): StructuredDistillHandoffV2 | undefined {
  if (!withinCodePointLimit(text, STRUCTURED_HANDOFF_MAX_CODE_POINTS)) return undefined;
  const match = normalizeLegacyHandoffFence(text).match(STRUCTURED_HANDOFF_V2_RE);
  if (!match) return undefined;
  const json = match[1];
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!hasExactlyKeys(record, STRUCTURED_HANDOFF_V2_KEYS) || !hasNoDuplicateObjectKeys(json)) return undefined;
  if (!isNonEmptyBoundedString(record.objective)) return undefined;

  const invariants = record.invariants;
  const verificationNeeded = record["verification-needed"];
  if (!Array.isArray(invariants) || invariants.length > STRUCTURED_HANDOFF_MAX_ITEMS ||
    invariants.some((item) => !isNonEmptyBoundedString(item))) return undefined;
  if (!Array.isArray(verificationNeeded) || verificationNeeded.length > STRUCTURED_HANDOFF_MAX_ITEMS ||
    verificationNeeded.some((item) => !isNonEmptyBoundedString(item))) return undefined;

  const decisions = record.decisions;
  if (!Array.isArray(decisions) || decisions.length > STRUCTURED_HANDOFF_MAX_ITEMS ||
    decisions.some((decision) => typeof decision !== "object" || decision === null || Array.isArray(decision))) return undefined;
  const typedDecisions = decisions as DistillHandoffDecision[];
  if (typedDecisions.some((decision) =>
    !hasExactlyKeys(decision, ["id", "text", "rationale"]) ||
    !isNonEmptyBoundedString(decision.id) || !isNonEmptyBoundedString(decision.text) ||
    !isNonEmptyBoundedString(decision.rationale)) || !hasUniqueBoundedIds(typedDecisions)) return undefined;

  const hypotheses = record["rejected-hypotheses"];
  if (!Array.isArray(hypotheses) || hypotheses.length > STRUCTURED_HANDOFF_MAX_ITEMS ||
    hypotheses.some((hypothesis) => typeof hypothesis !== "object" || hypothesis === null || Array.isArray(hypothesis))) return undefined;
  const typedHypotheses = hypotheses as DistillHandoffRejectedHypothesis[];
  if (typedHypotheses.some((hypothesis) =>
    !hasExactlyKeys(hypothesis, ["id", "claim", "evidence"]) ||
    !isNonEmptyBoundedString(hypothesis.id) || !isNonEmptyBoundedString(hypothesis.claim) ||
    !isNonEmptyBoundedString(hypothesis.evidence)) || !hasUniqueBoundedIds(typedHypotheses)) return undefined;

  const tasks = record.tasks;
  if (!Array.isArray(tasks) || tasks.length > STRUCTURED_HANDOFF_MAX_ITEMS ||
    tasks.some((task) => typeof task !== "object" || task === null || Array.isArray(task))) return undefined;
  const typedTasks = tasks as DistillHandoffTask[];
  if (typedTasks.some((task) =>
    !hasExactlyKeys(task, ["id", "status", "action", "depends-on", "blocker"]) ||
    !isNonEmptyBoundedString(task.id) ||
    (task.status !== "done" && task.status !== "pending" && task.status !== "blocked") ||
    !isNonEmptyBoundedString(task.action) ||
    !Array.isArray(task["depends-on"]) || task["depends-on"].length > STRUCTURED_HANDOFF_MAX_ITEMS ||
    task["depends-on"].some((dependency) => typeof dependency !== "string" || !HANDOFF_ID_RE.test(dependency)) ||
    typeof task.blocker !== "string" || !withinCodePointLimit(task.blocker, STRUCTURED_HANDOFF_MAX_ITEM_CODE_POINTS) ||
    (task.status === "blocked" ? !task.blocker.trim() : task.blocker !== "")) ||
    !hasUniqueBoundedIds(typedTasks)) return undefined;
  const taskIds = new Set(typedTasks.map((task) => task.id));
  if (typedTasks.some((task) => task["depends-on"].some((dependency) =>
    dependency === task.id || !taskIds.has(dependency))) || hasCycle(typedTasks)) return undefined;

  return {
    version: 2,
    objective: record.objective.trim(),
    invariants: (invariants as string[]).map((item) => item.trim()),
    decisions: typedDecisions.map(({ id, text, rationale }) => ({ id, text: text.trim(), rationale: rationale.trim() })),
    "rejected-hypotheses": typedHypotheses.map(({ id, claim, evidence }) => ({ id, claim: claim.trim(), evidence: evidence.trim() })),
    tasks: typedTasks.map(({ id, status, action, "depends-on": dependsOn, blocker }) => ({
      id,
      status,
      action: action.trim(),
      "depends-on": [...dependsOn],
      blocker: blocker.trim(),
    })),
    "verification-needed": (verificationNeeded as string[]).map((item) => item.trim()),
  };
}

/** Parse either supported strict handoff version; unknown versions remain opaque. */
export function parseAnyStructuredDistillHandoff(
  text: string,
): ParsedStructuredDistillHandoff | undefined {
  return parseStructuredDistillHandoff(text) ?? parseStructuredDistillHandoffV2(text);
}

export function handoffTextFromEntryData(data: unknown): string | undefined {
  if (typeof data === "string") return data.trim() || undefined;
  if (typeof data !== "object" || data === null) return undefined;
  const candidate = data as {
    handoff?: unknown;
    note?: unknown;
    text?: unknown;
  };
  for (const value of [candidate.handoff, candidate.note, candidate.text]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}
