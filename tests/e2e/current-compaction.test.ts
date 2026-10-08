import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { assertCurrentCompaction } from "./harness/current-compaction.ts";

const digest = (): string => "a".repeat(22);
function full() {
  const summary = [
    "<dc-distill-summary>",
    "notice: Selected conversation excerpts and observations; incomplete.",
    "columns: records=kind|origin|cut|text ; files=section id|origin|cut|create|path ; commands=cmd id|origin|cut|runner|status|cwd|command|result ; current=selected input, prior=carried context; full/cut=no known text clipping/clipped; create=yes means capable, not created; command id=runner/command/cwd tuple, not execution; cwd: leading = marks recorded text; none means unrecorded; observations are not present truth, readiness, verification or authorization; omissions=count dropped candidates, not text cuts; 9007199254740991 means at least that many; request after=N counts preceding retained records; text uses literal backslash escapes",
    'focus: full "pipe \\| and newline \\n and backslash \\\\ escapes"',
    "latest-request: current cut after=1 \"TASK keep the newest native request text\"",
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
    "columns: records=kind|origin|cut|text ; files=section id|origin|cut|create|path ; commands=cmd id|origin|cut|runner|status|cwd|command|result ; current=selected input, prior=carried context; full/cut=no known text clipping/clipped; create=yes means capable, not created; command id=runner/command/cwd tuple, not execution; cwd: leading = marks recorded text; none means unrecorded; observations are not present truth, readiness, verification or authorization; omissions=count dropped candidates, not text cuts; 9007199254740991 means at least that many; request after=N counts preceding retained records; text uses literal backslash escapes",
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
  ["numbered details", (d: Record<string, unknown>) => { d.version = 15; }],
  ["retired attempt identity", (d: Record<string, unknown>) => { d.attemptId = "obsolete"; }],
  ["checkpoint", (d: Record<string, unknown>) => { d.checkpoint = {}; }],
  ["wrong digest", (d: Record<string, unknown>) => { d.summaryDigest = "0".repeat(64); }],
  ["foreign owner", (d: Record<string, unknown>) => { d.compactor = "foreign"; }],
  ["known overflow", (d: Record<string, unknown>) => { d.tokensAfter = 1001; }],
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

for (const [name, counter, reason] of [
  ["zero-padded omission counter", "00", "noncanonical omitted counter"],
  ["unsafe omission counter", "9007199254740992", "unsafe omitted counter"],
] as const) test(`oracle rejects authenticated ${name} in every omission lane`, () => {
  for (const lane of ["input", "excerpts", "reads", "modified", "commands"]) {
    const fixture = minimal();
    const mutated = rehash(fixture, fixture.summary.replace(`${lane}=0`, `${lane}=${counter}`));
    expect(() => assertCurrentCompaction(mutated.summary, mutated.details)).toThrow(reason);
  }
});

test("oracle accepts canonical zero and maximum safe omission counters", () => {
  for (const counter of [0, Number.MAX_SAFE_INTEGER]) {
    const fixture = minimal();
    const boundary = rehash(fixture, fixture.summary.replace(/=0/g, `=${counter}`));
    expect(assertCurrentCompaction(boundary.summary, boundary.details).omitted).toEqual({
      inputRecords: counter, excerpts: counter, readFiles: counter, modifiedFiles: counter, commands: counter,
    });
  }
});

test("independent oracle rejects authenticated noncanonical text and request anchors", () => {
  for (const spelling of ['"', "|", "<", ">", "\r", "\t", "\u001b", "\u202e", "\u200d", "\u2028", "\u2029",
    "\\u{41}", "\\u{03c}", "\\u{3C}", "\\u{a}", "\\u{d800}", "\\u{110000}", "\\u{}", "\\u{gg}", "\\u{3c", "\\"]) {
    const fixture = full();
    rehash(fixture, fixture.summary.replace("continue with the plan", spelling));
    expect(() => assertCurrentCompaction(fixture.summary, fixture.details)).toThrow();
  }
  for (const spelling of ["00", "+1", "-1", "4", "9007199254740992"]) {
    const fixture = full(); rehash(fixture, fixture.summary.replace("after=1", `after=${spelling}`));
    expect(() => assertCurrentCompaction(fixture.summary, fixture.details)).toThrow();
  }
});

test("independent oracle decodes canonical escapes in every text lane", () => {
  const wire = '\\\\ \\" \\| \\n\\r\\t \\u{3c}\\u{3e}\\u{0}\\u{1b}\\u{7f}\\u{85}\\u{202e}\\u{200d}\\u{2028}\\u{2029} 😀 \\\\u{202e}';
  const decoded = '\\ " | \n\r\t <>\u0000\u001b\u007f\u0085\u202e\u200d\u2028\u2029 😀 \\u{202e}';
  const fixture = minimal();
  const lines = fixture.summary.split("\n");
  lines.splice(3, 0, `focus: cut "${wire}"`, `latest-request: current full after=1 "${wire}"`);
  lines.splice(lines.indexOf("files:"), 0, `user | prior | full | ${wire}`);
  lines.splice(lines.indexOf("commands:"), 0, `read ${digest()} | prior | full | no | ${wire}`);
  lines.splice(lines.findIndex(line => line.startsWith("omitted:")), 0, `cmd ${digest()} | current | cut | ${wire} | unknown | =${wire} | ${wire} | ${wire}`);
  rehash(fixture, lines.join("\n"));
  const accepted = assertCurrentCompaction(fixture.summary, fixture.details);
  expect([accepted.focus?.text, accepted.latestRequest?.text, accepted.records[0]?.text, accepted.files.read[0]?.path,
    accepted.commands[0]?.runner, accepted.commands[0]?.cwd, accepted.commands[0]?.command, accepted.commands[0]?.result]).toEqual(Array(8).fill(decoded));
});
