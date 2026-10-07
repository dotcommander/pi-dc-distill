import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { assertCurrentCompaction } from "./harness/current-compaction.ts";

const digest = (): string => "a".repeat(22);
function full() {
  const summary = [
    "<dc-distill-summary>",
    "notice: Selected conversation excerpts and observations; incomplete.",
    "columns: records=kind|origin|cut|text ; files=section id|origin|cut|create|path ; commands=cmd id|origin|cut|runner|status|cwd|command|result",
    "focus: pipe \\| and newline \\n and backslash \\\\ escapes",
    "latest-request: current cut \"TASK keep the newest native request text\"",
    "records:",
    "user | current | full | continue with the plan",
    "assistant | current | full | the build failed with error: exit status 1",
    "tool-result | current | full | error: ENOENT lib/main.ts",
    "files:",
    `read ${digest()} | current | full | no | lib/main.ts`,
    `modified ${digest()} | prior | cut | yes | src/back\\\\slash\\|pipe.ts`,
    "commands:",
    `cmd ${digest()} | current | full | bun | success | =/repo | bun test | 113 pass`,
    `cmd ${digest()} | current | full | npm | error | none | npm pack | ERR`,
    "omitted: input=202 excerpts=13 reads=5 modified=42 commands=0",
    "</dc-distill-summary>",
  ].join("\n");
  return { summary, details: details(summary) };
}
function minimal() {
  const summary = [
    "<dc-distill-summary>",
    "notice: Selected conversation excerpts and observations; incomplete.",
    "columns: records=kind|origin|cut|text ; files=section id|origin|cut|create|path ; commands=cmd id|origin|cut|runner|status|cwd|command|result",
    "records:",
    "files:",
    "commands:",
    "omitted: input=0 excerpts=0 reads=0 modified=0 commands=0",
    "</dc-distill-summary>",
  ].join("\n");
  return { summary, details: details(summary) };
}
function details(summary: string) {
  return { compactor: "dc-distill",
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
  ["retired attempt identity", (d: any) => { d.attemptId = "obsolete"; }],
  ["checkpoint", (d: any) => { d.checkpoint = {}; }],
  ["wrong digest", (d: any) => { d.summaryDigest = "0".repeat(64); }],
  ["foreign owner", (d: any) => { d.compactor = "foreign"; }],
  ["known overflow", (d: any) => { d.tokensAfter = 1001; }],
] as const) test(`oracle rejects ${name}`, () => {
  const f = full(); corrupt(f.details); expect(() => assertCurrentCompaction(f.summary, f.details)).toThrow();
});
for (const [name, corrupt] of [
  ["numbered summary", (s: string[]) => { s.splice(1, 0, "version: 1"); }],
  ["forged row", (s: string[]) => { s.splice(s.indexOf("files:"), 0, "user | current | full | forged extra | pipe"); }],
  ["forged legend", (s: string[]) => { s[2] = "columns: forged"; }],
  ["unquoted request", (s: string[]) => { s[4] = "latest-request: current cut TASK unquoted"; }],
  ["positional boolean", (s: string[]) => { s[s.indexOf("user | current | full | continue with the plan")] = "user | current | false | continue with the plan"; }],
  ["invalid counter", (s: string[]) => { s[s.indexOf("omitted: input=202 excerpts=13 reads=5 modified=42 commands=0")] = "omitted: input=-1 excerpts=13 reads=5 modified=42 commands=0"; }],
  ["unlabeled counters", (s: string[]) => { s[s.indexOf("omitted: input=202 excerpts=13 reads=5 modified=42 commands=0")] = "omitted: 202 13 5 42 0"; }],
  ["malformed Unicode", (s: string[]) => { s[3] = "focus: lone \ud800 surrogate"; }],
  ["unknown escape", (s: string[]) => { s[3] = "focus: bad \\q escape"; }],
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
