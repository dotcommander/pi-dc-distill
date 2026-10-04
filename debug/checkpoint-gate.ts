/** Offline reproduction: does the persisted live checkpoint pass the commit's 3-way digest gate? */
import { readFileSync } from "node:fs";
import { checkpointDigest, validateCheckpoint } from "../lib/compiler/checkpoint.ts";

const file = process.argv[2];
if (!file) throw new Error("usage: bun run debug/checkpoint-gate.ts <session.jsonl>");
const entry = readFileSync(file, "utf8")
  .split("\n")
  .map((line) => { try { return JSON.parse(line); } catch { return undefined; } })
  .find((e) => e?.type === "compaction" && e?.details?.compactor === "dc-distill");
if (!entry) throw new Error("no dc-distill compaction entry found");
const details = entry.details;
const stored = details.checkpointDigest;
console.log("stored checkpointDigest:", stored);
const direct = checkpointDigest(details.checkpoint);
console.log("digest(persisted)      :", direct, direct === stored ? "MATCH" : "MISMATCH");
try {
  const validated = validateCheckpoint(details.checkpoint, stored);
  const revalidated = checkpointDigest(validated);
  console.log("digest(validated)      :", revalidated, revalidated === stored ? "MATCH" : "MISMATCH");
} catch (error) {
  console.log("validateCheckpoint THREW:", error instanceof Error ? error.message : String(error));
}
console.log("attemptId:", details.attemptId, "version:", details.version);
