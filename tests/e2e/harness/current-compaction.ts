/** Acceptance-owned current contract, shared by real-host checks and the demo. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkpointDigest, checkpointSectionLedger, validateCheckpoint } from "../../../lib/compiler/checkpoint.ts";

export function assertCurrentCompaction(summary: unknown, details: unknown): void {
  assert(details && typeof details === "object", "missing compaction details");
  const d = details as Record<string, unknown>;
  assert.equal(d.compactor, "dc-distill", "unexpected compactor");
  // Expected protocol versions are explicit: importing the writer's constant
  // would let an accidental writer version change silently change this oracle.
  assert.equal(d.version, 15, "current details must be v15");
  const checkpoint = validateCheckpoint(d.checkpoint);
  assert.equal(checkpoint.version, 2, "current checkpoint must be schema v2");
  assert.equal(d.checkpointDigest, checkpointDigest(checkpoint), "checkpoint digest mismatch");
  assert.equal(typeof summary, "string", "missing wire summary");
  assert.equal(d.summaryDigest, createHash("sha256").update(summary as string).digest("hex"), "wire summary digest mismatch");
  const ledger = checkpointSectionLedger(checkpoint);
  assert.equal(Object.keys(ledger.sections).length, 17, "current section ledger must have 17 keys");
  assert.deepEqual(d.checkpointSections, ledger, "checkpoint section ledger mismatch");
}
