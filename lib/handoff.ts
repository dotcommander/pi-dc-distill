export const SHRINK_HANDOFF_ENTRY_TYPE = "dc-shrink-handoff";

export interface ShrinkHandoffEntry {
  handoff: string;
  ts: string;
}

export function shrinkHandoffEntry(
  handoff: string,
  now = new Date(),
): ShrinkHandoffEntry {
  return {
    handoff: handoff.trim(),
    ts: now.toISOString(),
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
