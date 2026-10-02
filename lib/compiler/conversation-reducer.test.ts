import { describe, test, expect } from "bun:test";
import {
  conversationEvictionCandidates,
} from "./conversation-reducer.ts";
import type { ConversationTurn } from "./types.ts";
import type { ConversationResult } from "./types.ts";
import { enforceOperatingBudget, formatSummary } from "./budget-formatter.ts";

describe("conversation-reducer intent-aware eviction", () => {
  test("relevance scoring protects intent-relevant explanation over unrelated diff turn", () => {
    const turns: ConversationTurn[] = [
      {
        role: "user",
        text: "Setup project.",
      },
      {
        role: "assistant",
        text: "Initial setup complete.",
      },
      {
        role: "assistant",
        text: "Configured auth JWT token verification details.",
      },
      {
        role: "assistant",
        text: "Configured logger settings.\n```diff\n- debug = false\n+ debug = true\n```",
      },
      {
        role: "user",
        text: "Please fix the auth JWT token verification bug.",
      },
      {
        role: "assistant",
        text: "All tasks completed successfully: all tests passed.",
      },
    ];

    // Pinned: Turn 4 (latestUser), Turn 5 (latestAssistant & latestSubstantive).
    // Candidates among older turns: Turn 1, Turn 2, Turn 3.
    // Turn 2 is about "auth JWT token verification", matching the active user request (Turn 4).
    // Turn 3 has a diff (syntax score 5), but is about logger settings (zero relevance to user request).
    // Distinct technical intent overlap retains auth over unrelated syntax.
    // In candidates (which are in eviction order), Turn 3 should be evicted BEFORE Turn 2:
    const candidates = conversationEvictionCandidates(turns);
    const indexOrder = candidates.map((c) => c.index);

    expect(indexOrder).toContain(2);
    expect(indexOrder).toContain(3);
    // Turn 3 (irrelevant diff) should be evicted before Turn 2 (relevant explanation)
    expect(indexOrder.indexOf(3)).toBeLessThan(indexOrder.indexOf(2));
  });

  test("falls back to recency when turns have no query overlap", () => {
    const turns: ConversationTurn[] = [
      {
        role: "user",
        text: "Setup project.",
      },
      {
        role: "assistant",
        text: "Plain explanation with no syntax features.",
      },
      {
        role: "assistant",
        text: "Logger settings with diff.\n```diff\n- a\n+ b\n```",
      },
      {
        role: "user",
        text: "Unrelated task.",
      },
      {
        role: "assistant",
        text: "All tasks completed successfully: all tests passed.",
      },
    ];

    const candidates = conversationEvictionCandidates(turns);
    const indexOrder = candidates.map((c) => c.index);

    expect(indexOrder).toContain(1);
    expect(indexOrder).toContain(2);
    // Within the same structural band, the older turn yields first.
    expect(indexOrder.indexOf(1)).toBeLessThan(indexOrder.indexOf(2));
  });
});

import { compactAssistantTurns, selectAssistantFrontier, trimTurn } from "./conversation-reducer.ts";
import { retireHistoricalControls } from "./conversation-reducer.ts";
import { technicalAnchorOverlap, resolvedFrontierIntent } from "./conversation-reducer.ts";

test("bounded relevance follows topical switches, corrections, sparse intent and bare implementation", () => {
  const cases = [
    { request: "Investigate ImageStorage symlinkEscape", relevant: "ImageStorage validates symlinkEscape.", irrelevant: "AuthProvider manages tokens." },
    { request: "Correction: preserve ParseHeader; change ParseBody only", relevant: "ParseHeader stays; ParseBody changes.", irrelevant: "ParseCookie uses legacy processing." },
    { request: "fix pool leak", relevant: "pool leak occurs on timeout.", irrelevant: "logger rotates output." },
    { request: "implement", proposal: "## Proposal\nRepair TokenAuthenticator using auth_service.", relevant: "TokenAuthenticator uses auth_service.", irrelevant: "LoggerBackend handles output." },
  ];
  for (const item of cases) {
    const turns: ConversationTurn[] = [
      { role: "assistant", text: item.relevant },
      { role: "assistant", text: item.irrelevant },
      ...(item.proposal ? [{ role: "assistant" as const, text: item.proposal }] : []),
      { role: "user", text: item.request },
      { role: "assistant", text: "Requested work is complete." },
    ];
    const order = conversationEvictionCandidates(turns).map((entry) => entry.index);
    expect(order.indexOf(1)).toBeLessThan(order.indexOf(0));
    if (item.proposal) expect(resolvedFrontierIntent(turns)).toContain(item.proposal);
  }
});

test("technical overlap has no repetition or corpus-rarity reward and is bounded", () => {
  const text = "AuthProvider JWT validation";
  const query = "Repair AuthProvider JWT validation";
  expect(technicalAnchorOverlap(text.repeat(30), query)).toBe(technicalAnchorOverlap(text, query));
  const turns: ConversationTurn[] = [
    { role: "assistant", text },
    { role: "assistant", text: "LoggerBackend ImageStorage ParseHeader unrelated output. ".repeat(30) },
    { role: "user", text: query },
    { role: "assistant", text: "Requested work is complete." },
  ];
  const before = conversationEvictionCandidates(turns);
  expect(before.map((entry) => entry.index)).toEqual([1, 0]);
  const after = conversationEvictionCandidates([{ role: "assistant", text: "AuthProvider JWT duplicate vocabulary" }, ...turns]);
  expect(after.find((entry) => entry.index === 1)?.score).toBe(before.find((entry) => entry.index === 0)?.score);
  expect(technicalAnchorOverlap(Array.from({ length: 30 }, (_, i) => `TechnicalItem${i}`).join(" "), Array.from({ length: 30 }, (_, i) => `TechnicalItem${i}`).join(" "))).toBe(8);
});

test("structural caveat evidence retains its band above unrelated syntax", () => {
  const turns: ConversationTurn[] = [
    { role: "assistant", text: "Known pre-existing: 292 errors. Deferred production transfer requires authority." },
    { role: "assistant", text: "LoggerBackend details.\n```diff\n- old\n+ new\n```" },
    { role: "user", text: "Investigate LoggerBackend" },
    { role: "assistant", text: "Requested work is complete." },
  ];
  expect(conversationEvictionCandidates(turns).map((entry) => entry.index)).toEqual([1, 0]);
});

test("terminal completion retires unique historical invitations but keeps substantive caveats", () => {
  const turns: ConversationTurn[] = [
    { role: "assistant", text: "Phase 4 is implemented.\n\nProduction data migration requires separate authority; do not rotate credentials yet.\n\n<!-- DISPOSITION: IMPLEMENT -->\n\nNext choice: Run the unique external canary in eu-west-2." },
    { role: "user", text: "finish bookkeeping" },
    { role: "assistant", text: "No files changed.\n\nNext choice: None — task complete; no response needed." },
  ];
  retireHistoricalControls(turns);
  expect(turns[0].text).toContain("Production data migration requires separate authority; do not rotate credentials yet.");
  expect(turns[0].text).not.toContain("eu-west-2");
  expect(turns[0].text).not.toContain("DISPOSITION");
  expect(turns[2].text).toBe("No files changed.");
});

test("historical protocol cleanup preserves fenced, quoted, inline and non-trailer text", () => {
  const historical = "Verified behavior.\n<!-- EXECUTION: COMPLETE -->\n<!-- DISPOSITION: NEEDS_USER_DECISION — choose storage -->\n<!-- EXECUTION: BLOCKED — provider authority -->\n```text\nNext choice: Example only.\n<!-- DISPOSITION: IMPLEMENT -->\n```\n~~~~\n<!-- EXECUTION: COMPLETE -->\nNext choice: Another example.\n~~~~\n> Next choice: Quoted choice.\n> <!-- EXECUTION: COMPLETE -->\nInline <!-- EXECUTION: COMPLETE --> example.\nNext choice: This line is part of the report.\nA substantive paragraph follows.";
  const turns: ConversationTurn[] = [
    { role: "assistant", text: historical },
    { role: "assistant", text: "Next choice: None — task complete; no response needed.\n<!-- EXECUTION: COMPLETE -->" },
  ];
  retireHistoricalControls(turns);
  expect(turns[0].text).not.toContain("choose storage");
  expect(turns[0].text).not.toContain("provider authority");
  expect(turns[0].text).toContain("```text\nNext choice: Example only.\n<!-- DISPOSITION: IMPLEMENT -->\n```");
  expect(turns[0].text).toContain("~~~~\n<!-- EXECUTION: COMPLETE -->\nNext choice: Another example.\n~~~~");
  expect(turns[0].text).toContain("> <!-- EXECUTION: COMPLETE -->");
  expect(turns[0].text).toContain("Inline <!-- EXECUTION: COMPLETE --> example.");
  expect(turns[0].text).toContain("Next choice: This line is part of the report.");
  expect(turns[1].text).toBe("");
});

test("open and unknown conversations retain historical workflow controls", () => {
  for (const latest of ["Still working; remaining work is open.", "Investigating."]) {
    const turns: ConversationTurn[] = [
      { role: "assistant", text: "Implemented.\n<!-- EXECUTION: COMPLETE -->\nNext choice: Deploy after approval." },
      { role: "user", text: "investigate" },
      { role: "assistant", text: latest },
    ];
    const before = turns.map((turn) => turn.text);
    retireHistoricalControls(turns);
    expect(turns.map((turn) => turn.text)).toEqual(before);
  }
});

test("control savings do not re-admit historical scaffolding in either recall mode", () => {
  for (const recallEnabled of [false, true]) {
    const report = "Phase 2 is implemented.\n\n";
    const controls = "\n\n<!-- EXECUTION: COMPLETE -->\n\nNext choice: " + "Retired invitation. ".repeat(20);
    const conv: ConversationResult = {
      terminalComplete: true,
      turns: [
        { role: "user", text: "Historical scaffolding. " + "process ".repeat(40) },
        { role: "assistant", text: report + controls },
        { role: "user", text: "implement" },
        { role: "assistant", text: "Next choice: None — task complete; no response needed." },
      ],
      readFiles: [], modifiedFiles: [], omittedReadFiles: 0, omittedModifiedFiles: 0,
      recentToolCalls: [], recentToolResults: [], verification: [], workingTree: [],
      sourceAnchors: [], literalAnchors: [], activeTasks: [], resumeRisks: [],
      budgetOmissions: [], resumeTasks: [],
      resumeIndex: { activeFiles: [], recentUserIntents: [], continuationHints: [], recallQueries: [] },
    };
    const meta = { priorSummaries: [] };
    const filler = "x".repeat(7168 + 20 - [...formatSummary(meta, conv)].length);
    conv.turns[1].text = report + filler + controls;
    enforceOperatingBudget(meta, conv, undefined, recallEnabled);
    expect(conv.turns.some((turn) => turn.text.includes("Historical scaffolding"))).toBe(false);
    expect(conv.turns[0].text).toBe(report + filler);
    expect(conv.turns.at(-1)?.text).toBe("");
    expect(conv.terminalComplete).toBe(true);
  }
});

test("completion and final bookkeeping reply remain separate frontier records", () => {
  const turns: ConversationTurn[] = [
    { role: "assistant", text: "## Proposal\nImplement the native repository contract." },
    { role: "user", text: "implement" },
    { role: "assistant", text: "Phase 2 is implemented.\nVerification: 28/28 passed; 292 pre-existing errors remain." },
    { role: "assistant", text: "## Bookkeeping\nResolved three orphan task closures. No application files changed." },
  ];
  expect(selectAssistantFrontier(turns).pinned).toEqual([1, 3, 2, 0]);
  expect(conversationEvictionCandidates(turns)).toEqual([]);
  expect(compactAssistantTurns(turns, [])).toEqual(turns);
});

test("latest human request bounds completion selection", () => {
  const turns: ConversationTurn[] = [
    { role: "user", text: "finish old work" },
    { role: "assistant", text: "Phase 1 is implemented." },
    { role: "user", text: "Investigate a new regression" },
    { role: "assistant", text: "Investigation is running." },
  ];
  expect(selectAssistantFrontier(turns).completion).toBe(-1);
  expect(conversationEvictionCandidates(turns).map((entry) => entry.index)).toContain(1);
});

test("completion allowance drops whole optional sections and retains caveats", () => {
  const text = "Phase 2 is implemented.\n\n### Changed\n" + "- Updated a repository contract.\n".repeat(100) +
    "\n### Verification\n28/28 passed. Known pre-existing: 292 errors; unapproved broad gates are not acceptance.\n\nNo commit was created.";
  const trimmed = trimTurn(text, 100);
  expect([...trimmed].length).toBeLessThanOrEqual(2048);
  expect(trimmed).toContain("Phase 2 is implemented.");
  expect(trimmed).toContain("292 errors");
  expect(trimmed).toContain("No commit was created.");
  expect(trimmed).not.toContain("### Changed");
  expect(trimmed).not.toContain("…");
});
