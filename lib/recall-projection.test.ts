import { expect, test } from "bun:test";
import { projectActiveBranchRecall } from "./recall-projection.ts";
import { emptyCheckpoint, checkpointDigest } from "./compiler/checkpoint.ts";
import { sha256Hex } from "./sha256.ts";

function host(version = 13) {
  const checkpoint = emptyCheckpoint();
  return {type:"compaction", id:"host-entry", timestamp:"2026-01-01T00:00:00Z",
    firstKeptEntryId:"tail", tokensBefore:100, summary:"exact wire summary 😀",
    details:{compactor:"dc-distill",version,tokensAfter:20,tokensAfterSource:"pi-rebuilt-message-estimate",
      ...(version >= 13 ? { checkpoint, checkpointDigest: checkpointDigest(checkpoint) } : {}),
      attemptId:"attempt",summaryDigest:sha256Hex("exact wire summary 😀")}};
}
test("projects committed host identity, original timestamp and exact wire digest", () => {
  expect(projectActiveBranchRecall([host()],"/project/../project","owner")).toEqual([{
    ts:"2026-01-01T00:00:00Z", before:100, after:20, summary:"exact wire summary 😀",
    project:"/project",sessionId:"owner",compactionEntryId:"host-entry",attemptId:"attempt",
    summaryDigest:sha256Hex("exact wire summary 😀"),tokenSource:"pi-rebuilt-message-estimate"}]);
});
test("rejects incomplete identities, nonfinite metrics, foreign compactor and mismatched v11 digest", () => {
  const invalid = [
    {...host(),id:""}, {...host(),timestamp:"invalid"}, {...host(),tokensBefore:NaN},
    {...host(),details:{...host().details,tokensAfter:Infinity}},
    {...host(),details:{...host().details,summaryDigest:"a".repeat(64)}},
    {...host(),details:{...host().details,compactor:"other"}},
  ];
  expect(projectActiveBranchRecall(invalid,"/project","owner")).toEqual([]);
});
test("historical v5-v9 compactions remain recoverable without manufacturing digest", () => {
  for (let version=5;version<=9;version++) {
    const old = host(version);
    const {summaryDigest, ...details} = old.details;
    const projected = projectActiveBranchRecall([{...old,details:{...details,compactor:"dc-shrink"}}],"/project","owner");
    expect(projected).toHaveLength(1);
    expect(projected[0]!.summaryDigest).toBeUndefined();
  }
});

for (const version of [10, 11, 12, 13, 14, 15]) test(`v${version} recall requires wire integrity and preserves its source`, () => {
  const original = host(version);
  const before = JSON.stringify(original);
  expect(projectActiveBranchRecall([original], "/project", "owner")).toHaveLength(1);
  for (const changed of [
    { ...original, summary: original.summary + " changed" },
    { ...original, details: { ...original.details, summaryDigest: undefined } },
    { ...original, details: { ...original.details, attemptId: "" } },
    { ...original, details: { ...original.details, tokensAfterSource: "unknown" } },
  ]) expect(projectActiveBranchRecall([changed], "/project", "owner")).toEqual([]);
  expect(JSON.stringify(original)).toBe(before);
});

test("recall rejects unknown detail versions rather than reinterpreting them", () => {
  expect(projectActiveBranchRecall([host(4), host(16)], "/project", "owner")).toEqual([]);
});

for (const version of [13, 14, 15]) test(`v${version} recall rejects corrupt or missing checkpoint state`, () => {
  const entry = host(version);
  expect(projectActiveBranchRecall([{...entry,details:{...entry.details,checkpointDigest:"f".repeat(64)}}],"/project","owner")).toEqual([]);
  expect(projectActiveBranchRecall([{...entry,details:{...entry.details,checkpoint:undefined}}],"/project","owner")).toEqual([]);
});
