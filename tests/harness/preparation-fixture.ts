/** Build exact projected occurrence identities for host-boundary fixtures. */
export function withPreparationBranch(event: any, customEntries: any[] = []): any {
  if (!event.preparation || event.branchEntries?.length) return event;
  const branch: any[] = [];
  const timestamp = "2026-10-06T00:00:00.000Z";
  const append = (entry: any) => {
    branch.push({ id: `fixture-${branch.length}`, parentId: branch.at(-1)?.id ?? null, timestamp, ...entry });
  };
  if (event.preparation.previousSummary !== undefined) {
    append({ type: "compaction", summary: event.preparation.previousSummary,
      firstKeptEntryId: "fixture-1", tokensBefore: 100_000,
      ...(event.predecessorDetails === undefined ? {} : { details: event.predecessorDetails }) });
  }
  for (const message of [...(event.preparation.messagesToSummarize ?? []), ...(event.preparation.turnPrefixMessages ?? [])]) {
    append({ type: "message", message });
  }
  for (const entry of customEntries) if (entry.type === "custom") append({ ...entry, id: `fixture-${branch.length}` });
  append({ type: "message", id: event.preparation.firstKeptEntryId,
    message: { role: "user", content: "retained fixture context", timestamp: 1 } });
  return { ...event, branchEntries: branch };
}
