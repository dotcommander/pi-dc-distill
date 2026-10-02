/** Build real projected occurrence identities for entrypoint fixtures.
 * Deliberately does not repair nonempty branches: explicit provenance tests
 * supply the exact host preparation they want to accept or reject.
 */
export function withPreparationBranch(event: any, customEntries: any[] = []): any {
  if (!event.preparation || event.branchEntries?.length) return event;
  const branch: any[] = [];
  const timestamp = "2026-10-02T00:00:00.000Z";
  const append = (entry: any) => {
    branch.push({ id: `fixture-${branch.length}`, parentId: branch.at(-1)?.id ?? null, timestamp, ...entry });
  };
  if (event.preparation.previousSummary !== undefined) {
    // Previous compaction retains the first discarded entry in its projection.
    append({ type: "compaction", summary: event.preparation.previousSummary,
      firstKeptEntryId: "fixture-1", tokensBefore: 100_000, details: { compactor: "dc-distill", version: 12 } });
  }
  for (const message of [...(event.preparation.messagesToSummarize ?? []), ...(event.preparation.turnPrefixMessages ?? [])]) {
    append({ type: "message", message });
  }
  for (const entry of customEntries) if (entry.type === "custom") append({ ...entry, id: `fixture-${branch.length}` });
  append({ type: "message", id: event.preparation.firstKeptEntryId,
    message: { role: "user", content: "retained fixture context", timestamp: 1 } });
  return { ...event, branchEntries: branch };
}
