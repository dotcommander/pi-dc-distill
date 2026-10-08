import type { NormalizedRecord, RawNormalizedRecord, CertifiedMessageGroups, ToolCallRecord } from "./types.ts";

/** Certify the full source before bounding; omission cannot restore ambiguity. */
function certifyCopies(records: readonly NormalizedRecord[]): string[] {
  const calls = new Map<string, number>(), results = new Map<string, number>();
  for (const record of records) {
    if ((record.kind !== "tool-call" && record.kind !== "tool-result") || record.callId === undefined) continue;
    const counts = record.kind === "tool-call" ? calls : results;
    counts.set(record.callId, (counts.get(record.callId) ?? 0) + 1);
  }
  const duplicates = [...new Set([...calls, ...results].filter(([, count]) => count > 1).map(([id]) => id))].sort();
  const duplicateIds = new Set(duplicates);
  const pending = new Map<string, ToolCallRecord[]>();
  let ordinal = 0;
  for (const record of records) {
    if (record.kind !== "tool-call" && record.kind !== "tool-result") continue;
    record.pairing = { state: "unpairable" };
    if (record.callId !== undefined) {
      if (!duplicateIds.has(record.callId)) record.pairing = { state: "identified", id: record.callId };
      continue;
    }
    if (record.kind === "tool-call") {
      const calls = pending.get(record.name) ?? [];
      calls.push(record);
      pending.set(record.name, calls);
    } else {
      const calls = pending.get(record.name) ?? [];
      if (calls.length !== 1) continue;
      calls[0]!.pairing = record.pairing = { state: "certified-idless", key: ordinal++ };
      pending.delete(record.name);
    }
  }
  return duplicates;
}


/** Copy the entire validated projection before certifying; bounding may only remove groups. */
export function certifyMessageGroups(groups: readonly (readonly RawNormalizedRecord[])[]): CertifiedMessageGroups {
  const copied: NormalizedRecord[][] = groups.map(group => group.map<NormalizedRecord>(record => {
    if (record.kind === "tool-call") return { ...record, args: structuredClone(record.args), pairing: { state: "unpairable" } };
    if (record.kind === "tool-result") return { ...record, pairing: { state: "unpairable" } };
    return { ...record };
  }));
  const duplicateCallIds = certifyCopies(copied.flat());
  // Freeze certificates and rows. Arguments were cloned, so caller mutation cannot redirect facts.
  for (const group of copied) {
    for (const record of group) {
      if (record.kind === "tool-call" || record.kind === "tool-result") Object.freeze(record.pairing);
      if (record.kind === "tool-call") freezeArguments(record.args);
      Object.freeze(record);
    }
    Object.freeze(group);
  }
  return Object.freeze({ groups: Object.freeze(copied), duplicateCallIds: Object.freeze(duplicateCallIds) });
}
function freezeArguments(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeArguments(child);
  Object.freeze(value);
}
