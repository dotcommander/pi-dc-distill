export const SHRINK_HANDOFF_ENTRY_TYPE = "dc-shrink-handoff";

export interface ShrinkHandoffEntry {
  handoff: string;
  ts: string;
}

export interface StructuredShrinkHandoff {
  objective: string;
  done: string[];
  next: string[];
  blocker: string[];
  decision: string[];
  "verification-needed": string[];
}

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
const STRUCTURED_HANDOFF_RE = /^\s*```shrink-handoff-v1\n([\s\S]*?)\n```\s*$/;

export function shrinkHandoffEntry(
  handoff: string,
  now = new Date(),
): ShrinkHandoffEntry {
  return {
    handoff: handoff.trim(),
    ts: now.toISOString(),
  };
}

function withinCodePointLimit(value: string, limit: number): boolean {
  return Array.from(value).length <= limit;
}

/** Parse only the explicit, whole-message v1 envelope. Invalid envelopes stay legacy text. */
export function parseStructuredShrinkHandoff(
  text: string,
): StructuredShrinkHandoff | undefined {
  if (!withinCodePointLimit(text, STRUCTURED_HANDOFF_MAX_CODE_POINTS)) return undefined;
  const match = text.match(STRUCTURED_HANDOFF_RE);
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
