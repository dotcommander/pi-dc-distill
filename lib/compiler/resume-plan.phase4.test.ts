import { expect, test } from "bun:test";
import { buildResumeIndex, buildResumePlan, buildResumeTasks } from "./resume-index.ts";
import { enforceOperatingBudget, formatSummary } from "./budget-formatter.ts";
import { compileSessionJsonl } from "../local-compact.ts";
import type { ConversationResult, ResumePlan, VerificationReceipt } from "./types.ts";

const receipt = (command = "bun test", cwd: string | undefined = "/tmp/project"): VerificationReceipt => ({
  status: "FAIL", tool: "bash", command, cwd, evidence: "1 fail", mutationEpoch: 0, freshnessEstablished: true,
});
const emptyIndex = () => ({ activeFiles: [], recentUserIntents: [], continuationHints: [], recallQueries: [] });
const tasks = (resumePlan: ResumePlan) => buildResumeTasks({ resumePlan, recentToolCalls: [], verification: [], workingTree: [], sourceAnchors: [], activeTasks: [], resumeIndex: emptyIndex(), recallEnabled: false });
const plan = (value: VerificationReceipt) => buildResumePlan({ terminalComplete: false, activeTasks: [], verificationReceipts: [value], workingTree: [] });
const conversation = (resumePlan: ResumePlan): ConversationResult => ({
  resumePlan, terminalComplete: false,
  turns: [{ role: "user", text: "Repair parser. " + "critical obligation ".repeat(550), protectedRequest: true }],
  readFiles: [], modifiedFiles: [], omittedReadFiles: 0, omittedModifiedFiles: 0,
  recentToolCalls: [], recentToolResults: [], sourceAnchors: [], literalAnchors: [], resumeRisks: [], budgetOmissions: [],
  verification: ["FAIL [bash cwd=/tmp/project]: bun test — 1 fail [freshness: not established after later potentially modifying work]"],
  activeTasks: ["Task parser; running at snapshot"], workingTree: ["git status --short; dirty"],
  resumeIndex: emptyIndex(), resumeTasks: [],
});

test("resume obligations survive eviction of all supporting display records", () => {
  const source = receipt();
  const resumePlan = buildResumePlan({ terminalComplete: false, activeTasks: ["Task parser; running at snapshot"], verificationReceipts: [source], workingTree: ["dirty"] });
  source.command = "unrelated command";
  const conv = conversation(resumePlan);
  enforceOperatingBudget({ priorSummaries: [] }, conv, undefined, false);
  expect(conv.activeTasks).toEqual([]);
  // The unresolved failure stays visible even when every other support row goes.
  expect(conv.verification).toEqual(["FAIL [bash cwd=/tmp/project]: bun test — 1 fail [freshness: not established after later potentially modifying work]"]);
  expect(conv.workingTree).toEqual([]);
  expect(conv.resumeTasks).toEqual([
    "Await/check existing delegated task; do not launch a duplicate: Task parser; running at snapshot",
    "Verify: bun test [runner=bash; cwd=/tmp/project]",
    "Check working tree: git status --short",
  ]);
  expect(conv.budgetOmissions).toContain("protected-content overflow; operating target exceeded");
  expect(conv.budgetOmissions.join("\n")).toContain("1 active tasks omitted");
  const summary = formatSummary({ priorSummaries: [] }, conv);
  for (const name of ["resume-tasks", "summary-omissions"]) {
    expect(summary.split(`<${name}>`)).toHaveLength(2);
    expect(summary.split(`</${name}>`)).toHaveLength(2);
  }
});

test("verification task uses command bytes including dash delimiter and exact cwd", () => {
  const command = "bun  test --filter 'literal — separator'";
  expect(tasks(plan(receipt(command, "/tmp/first")))).toEqual([`Verify: ${command} [runner=bash; cwd=/tmp/first]`]);
  expect(tasks(plan(receipt(command, "/tmp/second")))).toEqual([`Verify: ${command} [runner=bash; cwd=/tmp/second]`]);
});

test("incomplete verification presentation yields inspection instead of a clipped command", () => {
  for (const value of [receipt("bun test " + "x".repeat(1_100)), receipt("bun test\nother command"), receipt("bun test", "/" + "x".repeat(210))]) {
    expect(tasks(plan(value))[0]).toStartWith("Inspect verification");
  }
  const missing = receipt(); delete missing.cwd;
  expect(tasks(plan(missing))[0]).toStartWith("Inspect verification");
  expect(tasks(plan(receipt("bun test " + "x".repeat(1_100))))[0]).toStartWith("Inspect verification");
  expect(tasks(buildResumePlan({ terminalComplete: false, activeTasks: [], verification: ["PASS: bun test — evidence"], workingTree: [] }))[0]).toStartWith("Inspect verification");
});

test("wire escaping round-trips commands once without creating markers", () => {
  const command = "bun test --filter 'literal <marker> &lt; &&'";
  const summary = compileSessionJsonl([
    { type: "session", cwd: "/tmp/project" },
    { type: "message", message: { role: "user", content: "Repair parser and verify" } },
    { type: "message", message: { role: "assistant", content: [{ type: "toolCall", name: "bash", id: "check", arguments: { command } }] } },
    { type: "message", message: { role: "toolResult", toolName: "bash", toolCallId: "check", isError: false, content: [{ type: "text", text: "1 pass\n0 fail" }] } },
  ].map((value) => JSON.stringify(value)).join("\n"), undefined, undefined, false).summary;
  const escaped = "bun test --filter 'literal &lt;marker&gt; &amp;lt; &amp;&amp;'";
  const decode = (value: string) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  for (const name of ["verification", "resume-tasks"]) {
    const block = summary.match(new RegExp(`<${name}>\\n([\\s\\S]*?)\\n</${name}>`))?.[1] ?? "";
    expect(block).toContain(escaped);
    expect(decode(block)).toContain(command);
    expect(block).not.toContain("<marker>");
  }
});

test("modified-first index deduplicates before ten-file cap and preserves observation order", () => {
  const reads = ["modified.ts", ...Array.from({ length: 11 }, (_, index) => `read-${index}.ts`), "read-0.ts"];
  const index = buildResumeIndex([{ role: "user", text: "Repair parser" }], reads, ["modified.ts", "modified.ts"], []);
  expect(index.activeFiles).toEqual(["... (2 active files omitted)", "modified.ts", ...reads.slice(1, 10)]);
});

test("existing task priority and four-task cap remain intact", () => {
  const resumePlan = buildResumePlan({ terminalComplete: false, activeTasks: ["Task running"], verificationReceipts: [receipt()], workingTree: ["dirty"] });
  const result = buildResumeTasks({ resumePlan, recentToolCalls: [], verification: [], workingTree: [], sourceAnchors: [], activeTasks: [], resumeIndex: {
    activeFiles: ["parser.ts"], recentUserIntents: [], continuationHints: ["Inspect parser"], recallQueries: ["ParserManager"],
  } });
  expect(result.map((line) => line.split(":")[0])).toEqual(["Await/check existing delegated task; do not launch a duplicate", "Reread active files", "Continue", "Verify"]);
  expect(tasks({ ...resumePlan, terminalComplete: true })).toEqual([]);
});
