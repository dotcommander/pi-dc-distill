import { describe, expect, test } from "bun:test";
import { formatSummary, prepareSummaryProjection } from "./budget-formatter.ts";
import { buildResumeIndex } from "./resume-index.ts";
import { scanSections } from "./section-scanner.ts";
import { codePointLength } from "../unicode.ts";
import type { ConversationResult, ConversationTurn, SessionMeta } from "./types.ts";

/** Wire-format contract text: a wording change must update this literal deliberately. */
const SCOPE_NOTE = "This summary covers only the entries Pi discarded at compaction; newer state lives in the retained messages that follow it in context.";

function conversation(turns: ConversationTurn[]): ConversationResult {
  return { turns, readFiles: [], modifiedFiles: [], omittedReadFiles: 0, omittedModifiedFiles: 0,
    recentToolCalls: [], recentToolResults: [], verification: [], workingTree: [], sourceAnchors: [], literalAnchors: [],
    activeTasks: [], resumeRisks: [], budgetOmissions: [], resumeTasks: [], resumeIndex: buildResumeIndex(turns, [], [], []) };
}

const turns: ConversationTurn[] = [
  { role: "user", text: "Fix the parser regression in lib/parse.ts" },
  { role: "assistant", text: "Reproduced and fixed the token loop." },
];

describe("summary scope note", () => {
  test("wire summary starts with the fixed scope note", () => {
    const summary = formatSummary({ priorSummaries: [] }, conversation(turns));
    expect(summary.startsWith(`${SCOPE_NOTE}\n\n`)).toBe(true);
  });

  test("scope note is static: identical across summaries with different session metadata", () => {
    const first = formatSummary({ priorSummaries: [], id: "s-1", timestamp: "2026-10-05T01:00:00Z" }, conversation(turns));
    const second = formatSummary({ priorSummaries: [], id: "s-2", timestamp: "2027-01-01T00:00:00Z" }, conversation(turns));
    expect(first.split("\n")[0]).toBe(SCOPE_NOTE);
    expect(second.split("\n")[0]).toBe(SCOPE_NOTE);
    // No timestamp or other varying component may enter the preamble.
    expect(SCOPE_NOTE).not.toMatch(/\d/);
  });

  test("measure pass counts the scope note identically to the wire render", () => {
    const meta: SessionMeta = { priorSummaries: [], id: "s-1", cwd: "/tmp/project", model: "prov/model", timestamp: "2026-10-05T01:00:00Z" };
    const conv = conversation(turns);
    const projection = prepareSummaryProjection(meta, conv);
    projection.measureOnly = true;
    formatSummary(meta, conv, undefined, projection);
    const wire = formatSummary(meta, conv);
    expect(projection.renderedCost).toBe(codePointLength(wire));
    expect(projection.renderedCost!).toBeGreaterThan(codePointLength(SCOPE_NOTE));
  });

  test("scope-note preamble keeps the structural scanner valid", () => {
    const summary = formatSummary({ priorSummaries: [] }, conversation(turns));
    expect(scanSections(summary).valid).toBe(true);
  });
});
