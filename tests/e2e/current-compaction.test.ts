import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { checkpointDigest, checkpointSectionLedger, emptyCheckpoint } from "../../lib/compiler/checkpoint.ts";
import { assertCurrentCompaction } from "./harness/current-compaction.ts";

function fixture() {
  const summary = "Current wire summary\n😀\n";
  const checkpoint = emptyCheckpoint();
  return { summary, details: {
    compactor: "dc-distill", version: 14, checkpoint,
    checkpointDigest: checkpointDigest(checkpoint),
    summaryDigest: createHash("sha256").update(summary).digest("hex"),
    checkpointSections: checkpointSectionLedger(checkpoint),
  } };
}

describe("current real-Pi compaction acceptance", () => {
  test("accepts authenticated v14/schema-v2 with exactly derived telemetry", () => {
    const { summary, details } = fixture();
    expect(() => assertCurrentCompaction(summary, details)).not.toThrow();
  });

  const corruptions: Array<[string, (details: Record<string, any>) => void]> = [
    ["historical details version", d => { d.version = 13; }],
    ["missing details version", d => { delete d.version; }],
    ["foreign compactor", d => { d.compactor = "other"; }],
    ["historical checkpoint schema", d => {
      d.checkpoint.version = 1;
      // Authenticating historical state does not make it a current checkpoint.
      d.checkpointDigest = checkpointDigest(d.checkpoint);
    }],
    ["malformed checkpoint", d => { delete d.checkpoint.tasks; }],
    ["wrong checkpoint digest", d => { d.checkpointDigest = "0".repeat(64); }],
    ["missing checkpoint digest", d => { delete d.checkpointDigest; }],
    ["wrong summary digest", d => { d.summaryDigest = "0".repeat(64); }],
    ["missing summary digest", d => { delete d.summaryDigest; }],
    ["missing section ledger", d => { delete d.checkpointSections; }],
    ["wrong section cost", d => { d.checkpointSections.sections.tasks++; }],
    ["missing section key", d => { delete d.checkpointSections.sections.tasks; }],
    ["extra section key", d => { d.checkpointSections.sections.unexpected = 0; }],
    ["wrong ladder telemetry", d => { d.checkpointSections.ladderOutcomes.sourcesDropped = true; }],
    ["wrong ledger version", d => { d.checkpointSections.version = 2; }],
  ];
  for (const [name, corrupt] of corruptions) {
    test(`rejects ${name}`, () => {
      const { summary, details } = fixture();
      corrupt(details);
      expect(() => assertCurrentCompaction(summary, details)).toThrow();
    });
  }

  test("hashes exact Unicode wire bytes including trailing newline", () => {
    const { summary, details } = fixture();
    expect(() => assertCurrentCompaction(summary.trimEnd(), details)).toThrow();
    expect(() => assertCurrentCompaction(undefined, details)).toThrow();
    expect(() => assertCurrentCompaction(summary, null)).toThrow();
  });
});
