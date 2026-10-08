import { saturatingAdd } from "./helpers.ts";
import { excerptScore, SUBSTANTIVE_THRESHOLD } from "./signal.ts";
import type { DcDistillSummary } from "./types.ts";

export function evictOldestOptional(document: DcDistillSummary): boolean {
  // Preserve user context until every other optional category is exhausted.
  const evictRow = <T>(rows: T[], predicate: (row: T) => boolean, counter: keyof DcDistillSummary["omitted"]): boolean => {
    const index = rows.findIndex(predicate);
    if (index < 0) return false;
    rows.splice(index, 1);
    document.omitted[counter] = saturatingAdd(document.omitted[counter], 1);
    return true;
  };
  if (evictRow(document.records, row => row.kind !== "user" && excerptScore(row) < SUBSTANTIVE_THRESHOLD, "excerpts")) return true;
  if (evictRow(document.commands, row => row.status !== "error", "commands")) return true;
  if (evictRow(document.records, row => row.kind !== "user", "excerpts")) return true;
  if (evictRow(document.commands, () => true, "commands")) return true;
  if (evictRow(document.files.read, () => true, "readFiles")) return true;
  if (evictRow(document.files.modified, () => true, "modifiedFiles")) return true;
  return evictRow(document.records, row => row.kind === "user", "excerpts");
}
