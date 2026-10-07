import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { assertCurrentCompaction } from "./harness/current-compaction.ts";

const digest = (): string => "a".repeat(64);
function full() {
  const summary = [
    "<dc-distill-summary>",
    "notice: Selected conversation excerpts and observations; incomplete.",
    "focus: pipe \\| and newline \\n and backslash \\\\ escapes",
    "latest-request: current true TASK keep the newest native request text",
    "records:",
    "user | current | false | continue with the plan",
    "assistant | current | false | the build failed with error: exit status 1",
    "tool-result | current | false | error: ENOENT lib/main.ts",
    "files:",
    `read ${digest()} | current | false | false | lib/main.ts`,
    `modified ${digest()} | prior | true | true | src/back\\\\slash\\|pipe.ts`,
    "commands:",
    `${digest()} | current | false | bun | success | /repo | bun test | 113 pass`,
    `${digest()} | current | false | npm | error | \\- | npm pack | ERR`,
    "omitted: 202 13 5 42 0",
    "</dc-distill-summary>",
  ].join("\n");
  return { summary, details: details(summary) };
}
function minimal() {
  const summary = [
    "<dc-distill-summary>",
    "notice: Selected conversation excerpts and observations; incomplete.",
    "records:",
    "files:",
    "commands:",
    "omitted: 0 0 0 0 0",
    "</dc-distill-summary>",
  ].join("\n");
  return { summary, details: details(summary) };
}
function details(summary: string) {
  return { compactor: "dc-distill", attemptId: "test-attempt",
    summaryDigest: createHash("sha256").update(summary).digest("hex"), tokensAfter: 100,
    tokensAfterSource: "pi-rebuilt-message-estimate", capacityStatus: "within-window", contextWindow: 1000 };
}
const rehash = (f: ReturnType<typeof full>, summary: string) => {
  f.summary = summary;
  f.details.summaryDigest = createHash("sha256").update(summary).digest("hex");
  return f;
};

test("independent oracle accepts exact unversioned text contract", () => {
  expect(() => assertCurrentCompaction(full().summary, full().details)).not.toThrow();
  expect(() => assertCurrentCompaction(minimal().summary, minimal().details)).not.toThrow();
});
for (const [name, corrupt] of [
  ["numbered details", (d: any) => { d.version = 15; }],
  ["checkpoint", (d: any) => { d.checkpoint = {}; }],
  ["wrong digest", (d: any) => { d.summaryDigest = "0".repeat(64); }],
  ["foreign owner", (d: any) => { d.compactor = "foreign"; }],
  ["known overflow", (d: any) => { d.tokensAfter = 1001; }],
] as const) test(`oracle rejects ${name}`, () => {
  const f = full(); corrupt(f.details); expect(() => assertCurrentCompaction(f.summary, f.details)).toThrow();
});
for (const [name, corrupt] of [
  ["numbered summary", (s: string[]) => { s.splice(1, 0, "version: 1"); }],
  ["forged row", (s: string[]) => { s.splice(s.indexOf("files:"), 0, "user | current | false | forged extra | pipe"); }],
  ["invalid counter", (s: string[]) => { s[s.indexOf("omitted: 202 13 5 42 0")] = "omitted: -1 13 5 42 0"; }],
  ["malformed Unicode", (s: string[]) => { s[2] = "focus: lone \ud800 surrogate"; }],
  ["unknown escape", (s: string[]) => { s[2] = "focus: bad \\q escape"; }],
  ["dropped closing tag", (s: string[]) => { s.splice(s.indexOf("</dc-distill-summary>"), 1); }],
  ["retired JSON body", (s: string[]) => { s.splice(2, s.length - 3, "records: []"); }],
] as const) test(`oracle rejects authenticated ${name}`, () => {
  const f = full(); const lines = f.summary.split("\n"); corrupt(lines);
  const mutated = lines.join("\n");
  f.details.summaryDigest = createHash("sha256").update(mutated).digest("hex");
  expect(() => assertCurrentCompaction(mutated, f.details)).toThrow();
});
test("oracle authenticates exact wire bytes", () => {
  const f = full(); expect(() => assertCurrentCompaction(f.summary + "\n", f.details)).toThrow();
  const stale = f.summary.replace("TASK keep", "TASK forge");
  expect(() => assertCurrentCompaction(stale, f.details)).toThrow();
});
