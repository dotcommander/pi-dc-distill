import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { assertCurrentCompaction } from "./harness/current-compaction.ts";

function fixture() {
  const summary = JSON.stringify({ format: "dc-distill-summary",
    notice: "Selected conversation excerpts and observations; incomplete.", focus: "😀", latestRequest: null,
    records: [], files: { read: [], modified: [] }, commands: [],
    omitted: { inputRecords: 0, excerpts: 0, readFiles: 0, modifiedFiles: 0, commands: 0 } });
  return { summary, details: { compactor: "dc-distill", attemptId: "test-attempt",
    summaryDigest: createHash("sha256").update(summary).digest("hex"), tokensAfter: 100,
    tokensAfterSource: "pi-rebuilt-message-estimate", capacityStatus: "within-window", contextWindow: 1000 } };
}
test("independent oracle accepts exact unversioned contract", () => {
  const f = fixture(); expect(() => assertCurrentCompaction(f.summary, f.details)).not.toThrow();
});
for (const [name, corrupt] of [
  ["numbered details", (d: any) => { d.version = 15; }],
  ["checkpoint", (d: any) => { d.checkpoint = {}; }],
  ["wrong digest", (d: any) => { d.summaryDigest = "0".repeat(64); }],
  ["foreign owner", (d: any) => { d.compactor = "foreign"; }],
  ["known overflow", (d: any) => { d.tokensAfter = 1001; }],
] as const) test(`oracle rejects ${name}`, () => {
  const f = fixture(); corrupt(f.details); expect(() => assertCurrentCompaction(f.summary, f.details)).toThrow();
});
for (const [name, corrupt] of [
  ["numbered summary", (s: any) => { s.version = 1; }],
  ["nested state", (s: any) => { s.records.push({ kind: "native-summary", text: {}, shortened: false, origin: "prior" }); }],
  ["invalid counter", (s: any) => { s.omitted.inputRecords = -1; }],
  ["malformed Unicode", (s: any) => { s.focus = "\ud800"; }],
] as const) test(`oracle rejects authenticated ${name}`, () => {
  const f = fixture(); const s = JSON.parse(f.summary); corrupt(s);
  f.summary = JSON.stringify(s); f.details.summaryDigest = createHash("sha256").update(f.summary).digest("hex");
  expect(() => assertCurrentCompaction(f.summary, f.details)).toThrow();
});
test("oracle authenticates exact wire bytes", () => {
  const f = fixture(); expect(() => assertCurrentCompaction(f.summary + "\n", f.details)).toThrow();
});
