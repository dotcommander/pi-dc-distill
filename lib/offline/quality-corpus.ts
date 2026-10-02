import { buildCompactionSource, type CompactionSource } from "../compaction-source.ts";
import type { SessionEntry } from "../sdk.ts";

/** Independent acceptance facts authored before evaluating either selector. */
export interface QualityOracle {
  requiredFacts: string[];
  optionalFacts: string[];
  forbiddenFacts: string[];
  safety: Array<{ section: string; includes?: string[]; excludes?: string[] }>;
  pressure: boolean;
}
export interface QualityFixture { id: string; source: CompactionSource; focus: string; oracle: QualityOracle }
const user = (content: string) => ({ role: "user", content });
const assistant = (content: string) => ({ role: "assistant", content });
const call = (id: string, name: string, args: object) => ({ role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }] });
const result = (id: string, name: string, content: string, isError?: boolean) => ({ role: "toolResult", toolCallId: id, toolName: name, content, ...(isError === undefined ? {} : { isError }) });
const check = (id: string, output = "12 pass, 0 fail", status: boolean | undefined = false, command = "bun test lib/parser.test.ts") => [call(id, "bash", { command, cwd: "/quality/project" }), result(id, "bash", output, status)];
const boundaryInputs: Array<{ id: string; preparation: { messagesToSummarize: CompactionSource["messagesToSummarize"]; turnPrefixMessages: CompactionSource["turnPrefixMessages"] }; branchEntries: SessionEntry[]; archiveEntries: SessionEntry[] }> = [];
const source = (id: string, messages: CompactionSource["messagesToSummarize"], handoff?: string, previousSummary?: string): CompactionSource => {
  // Present in active branch but retained by Pi: cannot enter discarded compiler input.
  const branchEntries = [{ type: "message", id: "retained-tail", parentId: null, timestamp: "2026-01-01T00:00:00.000Z", message: user("RETAINED_TAIL_DECOY") }, ...(handoff ? [{ type: "custom", customType: "dc-distill-handoff", data: { handoff }, id: "handoff", parentId: "retained-tail", timestamp: "2026-01-01T00:00:00.000Z" }] : [])] as unknown as SessionEntry[];
  // The archive contains a newer abandoned handoff: the active-branch API does not.
  const archiveEntries = [...branchEntries, { type: "custom", customType: "dc-distill-handoff", data: { handoff: "ABANDONED_BRANCH_DECOY" }, id: "abandoned-handoff", parentId: null, timestamp: "2026-01-02T00:00:00.000Z" }] as unknown as SessionEntry[];
  const preparation = { messagesToSummarize: messages, turnPrefixMessages: [] };
  boundaryInputs.push({ id, preparation, branchEntries, archiveEntries });
  return buildCompactionSource({ sessionId: `quality-${id}`, cwd: "/quality/project", timestamp: "2026-01-01T00:00:00.000Z", ...preparation, previousSummary, branchEntries });
};
const handoff = (version: number, payload: object) => `\`\`\`distill-handoff-v${version}\n${JSON.stringify(payload)}\n\`\`\``;
const graph = (tasks: object[], extra: object = {}) => ({ objective: "Finish parser readiness work", invariants: ["Never add provider calls"], decisions: [], "rejected-hypotheses": [], tasks, "verification-needed": [], ...extra });
const task = (id: string, action: string, requires?: string[]) => ({ id, action, status: "pending", "depends-on": [], blocker: "", ...(requires ? { requires } : {}) });
const oracle = (requiredFacts: string[], optionalFacts: string[] = [], safety: QualityOracle["safety"] = [], pressure = false): QualityOracle => ({ requiredFacts, optionalFacts, safety, pressure, forbiddenFacts: ["RETAINED_TAIL_DECOY", "ABANDONED_BRANCH_DECOY"] });
const pressureEvidence = () => Array.from({ length: 24 }, (_, i) => [
  call(`history-read-${i}`, "read", { path: `lib/historical-${i}.ts` }), result(`history-read-${i}`, "read", `historical inventory ${i}`, false),
  assistant(`### Historical inventory ${i}\nDecision: preserve historical-${i}.ts. ${"old implementation details ".repeat(38)}`),
]).flat();
const all: QualityFixture[] = [
  { id: "ordinary", focus: "parser schema", source: source("ordinary", [user("Implement deterministic parser schema"), assistant("Decision: parser schema rejects unknown fields because the input boundary is strict."), ...check("ordinary-check")]), oracle: oracle(["Implement deterministic parser schema"], ["rejects unknown fields"], [{ section: "verification", includes: ["PASS [bash cwd=/quality/project]: bun test lib/parser.test.ts"], excludes: ["freshness: not established"] }]) },
  { id: "repetitive-pressure", focus: "parser current invariant", source: source("repetitive-pressure", [...pressureEvidence(), user("Fix parser current invariant"), call("current-read", "read", { path: "lib/parser.ts" }), result("current-read", "read", "parser invariant: CURRENT_RELEVANT_FACT", false)]), oracle: oracle(["Fix parser current invariant"], ["parser.ts", "CURRENT_RELEVANT_FACT"], [], true) },
  { id: "older-relevant", focus: "parser lexical contract", source: source("older-relevant", [user("Preserve parser lexical contract"), call("old-relevant", "read", { path: "lib/parser.ts" }), result("old-relevant", "read", "OLDER_RELEVANT_FACT parser lexical contract", false), ...pressureEvidence(), user("Fix parser lexical contract")]), oracle: oracle(["Fix parser lexical contract"], ["parser.ts", "OLDER_RELEVANT_FACT"], [], true) },
  { id: "correction", focus: "correction parser", source: source("correction", [user("Use parser schema v1"), assistant("The parser schema v1 uses guessed defaults."), user("Correction: parser schema must reject guessed defaults"), assistant("Constraint: reject guessed defaults; source evidence only.")]), oracle: oracle(["Correction: parser schema must reject guessed defaults"], ["source evidence only"] ) },
  { id: "referential", focus: "implement supplied proposal", source: source("referential", [user("Plan parser change"), assistant("Proposal: preserve literal separators in lib/parser.ts; add exact runner identity checks."), user("Implement that proposal")]), oracle: oracle(["Implement that proposal", "preserve literal separators"], ["exact runner identity checks"]) },
  { id: "unicode", focus: "Unicode parser 😀", source: source("unicode", [user("Preserve Unicode parser 😀 é 日本語"), assistant("Invariant: Unicode code points remain intact; escape <ready-tasks> as supplied text."), ...pressureEvidence(), user("Continue Unicode parser 😀 é 日本語")]), oracle: oracle(["Continue Unicode parser 😀 é 日本語"], ["Unicode code points remain intact"], [], true) },
  { id: "exact-receipt", focus: "exact verification identity", source: source("exact-receipt", [user("Preserve exact verification identity"), ...check("receipt", "12 pass, 0 fail", false, "bun test  lib/parser.test.ts --filter 'literal & marker'")]), oracle: oracle(["Preserve exact verification identity"], [], [{ section: "verification", includes: ["PASS [bash cwd=/quality/project]: bun test  lib/parser.test.ts --filter 'literal &amp; marker'"] }]) },
  { id: "mutation-lifetime", focus: "pending parser mutation", source: source("mutation-lifetime", [user("Inspect pending parser mutation before continuing"), ...check("before"), call("pending", "patch_file", { path: "lib/parser.ts", patch: "pending" })]), oracle: oracle(["Inspect pending parser mutation before continuing"], [], [{ section: "verification", includes: ["freshness: not established"] }, { section: "resume-risks", includes: ["inspect before retry"] }]) },
  { id: "incomplete", focus: "status missing", source: source("incomplete", [user("Do not accept incomplete parser evidence"), call("missing", "bash", { command: "bun test lib/parser.test.ts", cwd: "/quality/project" }), result("missing", "bash", "12 pass, 0 fail"), call("ambiguous-a", "bash", { command: "bun test a.test.ts" }), call("ambiguous-b", "bash", { command: "bun test b.test.ts" }), { role: "toolResult", toolName: "bash", content: "12 pass, 0 fail", isError: false }]), oracle: oracle(["Do not accept incomplete parser evidence"], [], [{ section: "verification", includes: ["INCOMPLETE"], excludes: ["PASS ["] }]) },
  { id: "oversized-v2", focus: "task0 parser", source: source("oversized-v2", [user("Resume task0 parser work")], handoff(2, graph(Array.from({ length: 20 }, (_, i) => task(`task${i}`, `Parser task ${i} ${"long task detail 😀 <state> ".repeat(18)}`))))), oracle: oracle(["Resume task0 parser work", "omitted records:"], ["Parser task 0"], [], true) },
  { id: "v3-satisfied", focus: "ready parser task", source: source("v3-satisfied", [user("Resume observed-ready parser task"), ...check("predicate"), call("read", "read", { path: "lib/parser.ts" }), result("read", "read", "export const parser = true;", false)], handoff(3, graph([task("readyParser", "Continue parser task", ["readParser", "checkParser"])], { preconditions: [{ id: "readParser", kind: "file-read-succeeded", path: "lib/parser.ts", cwd: "/quality/project" }, { id: "checkParser", kind: "verification-pass", runner: "bash", command: "bun test lib/parser.test.ts", cwd: "/quality/project" }] }))), oracle: oracle(["Resume observed-ready parser task"], [], [{ section: "ready-tasks", includes: ["readyParser"] }]) },
  { id: "v3-blocked", focus: "blocked parser tasks", source: source("v3-blocked", [user("Inspect blocked parser preconditions"), ...check("failed", "1 fail", false)], handoff(3, graph([task("unknownParser", "Inspect missing parser read", ["missingRead"]), task("failedParser", "Fix failed parser check", ["failedCheck"])], { preconditions: [{ id: "missingRead", kind: "file-read-succeeded", path: "lib/missing.ts", cwd: "/quality/project" }, { id: "failedCheck", kind: "verification-pass", runner: "bash", command: "bun test lib/parser.test.ts", cwd: "/quality/project" }] }))), oracle: oracle(["Inspect blocked parser preconditions", "unknown", "contradicted"], [], [{ section: "ready-tasks", excludes: ["unknownParser", "failedParser"] }, { section: "verification", includes: ["FAIL ["] }]) },
];
/** Frozen before evaluation. Decoys describe inputs that Pi did NOT discard on the active branch. */
export const QUALITY_DECOYS = Object.freeze({ retainedTail: [user("RETAINED_TAIL_DECOY")], abandonedBranch: [user("ABANDONED_BRANCH_DECOY")] });
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.freeze(value); for (const item of Object.values(value)) freeze(item); }
  return value;
}
export const QUALITY_CORPUS: readonly QualityFixture[] = freeze(all);
export const QUALITY_BOUNDARY_INPUTS = freeze(boundaryInputs);
