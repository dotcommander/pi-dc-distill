import { expect, test } from "bun:test";
import { compileSessionJsonl } from "../local-compact.ts";
import { buildCheckpoint, canonicalJson, checkpointDigest, checkpointSectionLedger, emptyCheckpoint, type CheckpointFailureV2 } from "./checkpoint.ts";
import { digest } from "./helpers.ts";
import { CompactionInputError } from "./errors.ts";

const line = (entry: unknown) => JSON.stringify(entry);
const source = (entryId: string) => ({ sessionId: "synthetic", entryId, sourceKind: "tool-observation" as const, contentDigest: digest(entryId) });
const failedArgs = { path: "/repo/correction.ts", newText: "failed replacement " + "Q".repeat(2_500) };
const attemptedFix = `replace_file_content: ${canonicalJson(failedArgs)}`;
const failureOutput = "synthetic failure: expected anchor absent " + "X".repeat(1_000);

function ratingsInput(): string {
  const lines = [line({ type: "session", id: "synthetic", cwd: "/repo", timestamp: "2026-01-01T00:00:00Z" }),
    line({ type: "message", message: { role: "user", content: "Keep the exact failed invocation and its source." } })];
  for (let i = 0; i < 50; i++) {
    const id = `read-${i}`;
    const path = `/repo/${"a".repeat(1_400)}-${i}.ts`;
    lines.push(line({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id, name: "read", arguments: { path } }] } }));
    lines.push(line({ type: "message", message: { role: "toolResult", toolName: "read", toolCallId: id,
      content: [{ type: "text", text: "synthetic content" }], isError: false } }));
  }
  lines.push(line({ type: "message", sourceReference: source("failed-call"), message: { role: "assistant",
    content: [{ type: "toolCall", id: "failed", name: "replace_file_content", arguments: failedArgs }] } }));
  lines.push(line({ type: "message", sourceReference: source("failed-result"), message: { role: "toolResult",
    toolName: "replace_file_content", toolCallId: "failed", isError: true, content: [{ type: "text", text: failureOutput }] } }));
  return lines.join("\n");
}

test("synthetic ratings-class pressure preserves identity while evicting optional sections", () => {
  const input = ratingsInput();
  const first = compileSessionJsonl(input, undefined, undefined, false);
  const second = compileSessionJsonl(input, undefined, undefined, false);
  expect(first.summary).toBe(second.summary);
  expect(first.checkpointDigest).toBe(second.checkpointDigest);
  expect(first.checkpoint.version).toBe(2);
  const failure = first.checkpoint.failures.find(f => f.resolution === null) as CheckpointFailureV2;
  expect(failure).toBeDefined();
  expect(failure.signature).toBe(digest(`${attemptedFix}\0${failureOutput}`));
  expect(failure.invocationDigest).toBe(digest(attemptedFix));
  expect(failure.fixExcerpt).toHaveLength(512);
  expect(failure.sources).toEqual([]);
  expect(first.checkpoint.evidence.fileReads.length).toBeLessThan(50);
  expect(first.checkpoint.evidence.fileReads.length).toBeGreaterThanOrEqual(0);
  expect(checkpointDigest(first.checkpoint)).toBe(first.checkpointDigest);
  const ledger = checkpointSectionLedger(first.checkpoint);
  expect(Object.keys(ledger.sections)).toHaveLength(17);
  expect(ledger.ladderOutcomes.sourcesDropped).toBe(true);
  expect(ledger.ladderOutcomes.unreferencedReads).toBeLessThan(50);
  expect(ledger.sections["failures.identityCore"]).toBeGreaterThan(0);
  expect(ledger.sections["failures.sources"]).toBeLessThan(20);
});

test("synthetic dense failures shorten display excerpts after sources and unreferenced reads", () => {
  const failures = Array.from({ length: 70 }, (_, i) => {
    const attemptedFix = `replace_file_content: ${"A".repeat(700)}-${i}`;
    const observedOutcome = `${"B".repeat(700)}-${i}`;
    return { signature: digest(`${attemptedFix}\0${observedOutcome}`), attemptedFix, observedOutcome,
      sources: [source(`dense-${i}`)] };
  });
  const observations = { mutationEpoch: 0, fileReads: Array.from({ length: 50 }, (_, i) => ({
    id: `read-${i}`, runner: "read", path: `/repo/${"z".repeat(1_400)}-${i}.ts`, cwd: "/repo",
    status: "succeeded" as const, mutationEpoch: 0, freshnessEstablished: true, imports: [],
  })), verification: [], modifiedPaths: [] };
  const checkpoint = buildCheckpoint(undefined, undefined, observations, undefined, undefined, undefined, [], failures);
  const ledger = checkpointSectionLedger(checkpoint);
  expect(checkpoint.failures).toHaveLength(70);
  expect(checkpoint.failures.map(f => f.signature)).toEqual(failures.map(f => f.signature));
  expect(ledger.ladderOutcomes.sourcesDropped).toBe(true);
  expect(ledger.ladderOutcomes.unreferencedReads).toBe(0);
  expect(ledger.ladderOutcomes.maxFixExcerpt).toBeLessThanOrEqual(256);
  expect(ledger.ladderOutcomes.maxFixExcerpt).toBeGreaterThan(0);
  expect(checkpointDigest(checkpoint)).toMatch(/^[0-9a-f]{64}$/);
});

test("T0-only protected core overflow cancels rather than evicting identity", () => {
  const checkpoint = emptyCheckpoint();
  checkpoint.objective = "mandatory objective ".repeat(4_000);
  const observations = { mutationEpoch: 0, fileReads: [], verification: [], modifiedPaths: [] };
  try {
    buildCheckpoint(checkpoint, undefined, observations);
    throw new Error("protected overflow did not cancel");
  } catch (error) {
    expect(error).toBeInstanceOf(CompactionInputError);
    expect((error as CompactionInputError).code).toBe("protected_overflow");
  }
});
