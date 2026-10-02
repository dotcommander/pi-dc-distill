import { expect, test } from "bun:test";
import {
  classifyRequestGroups,
  compactAssistantTurns,
  hasTerminalNoWorkCompletion,
  removeCompletedHistoricalRequests,
  retireHistoricalControls,
  selectAssistantFrontier,
} from "./conversation-reducer.ts";
import type { ConversationTurn, ToolAdjacent } from "./types.ts";

const adjacent = (hadError: boolean): ToolAdjacent => ({ tools: ["Edit"], files: ["src/a.ts"], hadError });

test("protected loop starts and failed frontier replies survive edit collapse", () => {
  const turns: ConversationTurn[] = [
    { role: "user", text: "Repair parser", requestGroup: 4 },
    { role: "assistant", text: "Protected first attempt", requestGroup: 4, protectedRequest: true },
    ...Array.from({ length: 3 }, (_, i): ConversationTurn => ({ role: "assistant", text: `Attempt ${i}: error in src/a.ts`, requestGroup: 4 })),
    { role: "assistant", text: "Protected final failed attempt", requestGroup: 4, protectedRequest: true },
  ];
  const reduced = compactAssistantTurns(turns, turns.map(() => adjacent(true)));
  expect(reduced.some((turn) => turn.text === "Protected first attempt")).toBe(true);
  expect(reduced.some((turn) => turn.text === "Protected final failed attempt")).toBe(true);
  const loop = reduced.find((turn) => turn.text.startsWith("[loop:"));
  expect(loop?.requestGroup).toBe(4);
  expect(loop?.text).toContain("3 attempts");
  expect(loop?.text).toContain("outcome unverified");
});

test("collapse cannot cross request or custom provenance boundaries", () => {
  const turns: ConversationTurn[] = [
    ...Array.from({ length: 3 }, (_, i): ConversationTurn => ({ role: "assistant", text: `Moving along ${i}`, requestGroup: 0 })),
    ...Array.from({ length: 3 }, (_, i): ConversationTurn => ({ role: "assistant", text: `Moving along ${i + 3}`, requestGroup: 1, origin: "custom", customType: "handoff" })),
    { role: "user", text: "New frontier", requestGroup: 2 },
    { role: "assistant", text: "Latest reply", requestGroup: 2 },
  ];
  const reduced = compactAssistantTurns(turns, []);
  const synthetic = reduced.filter((turn) => turn.text.includes("procedural turns"));
  expect(synthetic).toHaveLength(2);
  expect(synthetic[0]?.requestGroup).toBe(0);
  expect(synthetic[1]?.requestGroup).toBe(1);
  expect(synthetic[1]?.origin).toBe("custom");
  expect(synthetic[1]?.customType).toBe("handoff");
  expect(synthetic.every((turn) => turn.text.startsWith("[3 procedural turns"))).toBe(true);

  const edits = turns.slice(0, 6).map((turn) => ({ ...turn, text: "type error in src/a.ts" }));
  edits.push({ role: "assistant", text: "Latest reply", requestGroup: 2 });
  const loops = compactAssistantTurns(edits, edits.map(() => adjacent(true))).filter((turn) => turn.text.startsWith("[loop:"));
  expect(loops.map((turn) => turn.requestGroup)).toEqual([0, 1]);
  expect(loops.every((turn) => turn.text.includes("3 attempts"))).toBe(true);
});

test("short blockers, approval restrictions and corrections survive procedural chatter", () => {
  const restrictions = ["Blocked pending access.", "Do not deploy without approval.", "Correction: use staging only."];
  const turns: ConversationTurn[] = [
    { role: "user", text: "Old request", requestGroup: 0 },
    ...Array.from({ length: 18 }, (_, i): ConversationTurn => ({ role: "assistant", text: `Moving along step ${i}`, requestGroup: 0 })),
    { role: "user", text: "Newest request", requestGroup: 1 },
    { role: "assistant", text: "Newest reply", requestGroup: 1 },
  ];
  // Interleave restrictions with enough procedural turns to trigger dense collapse.
  turns.splice(4, 0, ...restrictions.map((text): ConversationTurn => ({ role: "assistant", text, requestGroup: 0 })));
  const reduced = compactAssistantTurns(turns, []);
  for (const text of restrictions) expect(reduced.some((turn) => turn.text === text)).toBe(true);
});

function retireAgedRequest(request: string, reply: string): ConversationTurn[] {
  const turns: ConversationTurn[] = [{ role: "user", text: request }, { role: "assistant", text: reply }];
  for (let i = 0; i < 4; i++) turns.push({ role: "user", text: `New task ${i}` }, { role: "assistant", text: "Still working." });
  const protectedGroups = classifyRequestGroups(turns);
  removeCompletedHistoricalRequests(turns, turns.map(() => ({ tools: [], files: [], hadError: false })), protectedGroups);
  return turns;
}

test("aged progress-only and negated completion requests remain unresolved", () => {
  for (const reply of ["Investigating…", "Investigating the reported parser regression…", "Investigation is running in the parser module.", "Not all tests passed in this environment.", "The task is not implemented."]) {
    expect(retireAgedRequest("Implement parser repair", reply).some((turn) => turn.text === reply)).toBe(true);
    expect(selectAssistantFrontier([{ role: "user", text: "Repair it" }, { role: "assistant", text: reply }]).completion).toBe(-1);
  }
  for (const reply of ["Investigating the reported parser regression…", "I am reviewing the parser regression now.", "Review is in progress; checking the parser.", "I'm currently checking the parser."]) {
    expect(retireAgedRequest("Investigate the parser regression", reply).some((turn) => turn.text === reply)).toBe(true);
  }
});

test("completed informational answers and diagnoses still retire", () => {
  for (const [request, reply] of [
    ["Explain request ordering", "Requests are processed in FIFO order because the queue preserves submission order."],
    ["Diagnose the parser failure", "The root cause is an unchecked empty token. The parser fails because its index is out of range."],
  ]) expect(retireAgedRequest(request!, reply!).some((turn) => turn.text === request)).toBe(false);
});

test("code and quoted completion examples neither complete requests nor retire controls", () => {
  const examples = [
    "```text\nAll tests passed.\n```",
    "~~~~text\nAll tests passed.\n~~~~",
    "```text\nAll tests passed.",
    "~~~text\nAll tests passed.",
    "    All tests passed.",
    "\tAll tests passed.",
    "> All tests passed.",
    '"All tests passed."',
    "`All tests passed.`",
  ];
  for (const example of examples) {
    expect(retireAgedRequest("Implement parser repair", example).some((turn) => turn.text === example)).toBe(true);
    expect(selectAssistantFrontier([{ role: "user", text: "Implement parser repair" }, { role: "assistant", text: example }]).completion).toBe(-1);
    const terminalExample = example.replace("All tests passed.", "Next choice: None — task complete; no response needed.");
    const turns: ConversationTurn[] = [{ role: "assistant", text: "Old report\n<!-- EXECUTION: COMPLETE -->\nNext choice: Continue old task." }, { role: "assistant", text: terminalExample }];
    const original = turns[0]!.text;
    expect(hasTerminalNoWorkCompletion(turns)).toBe(false);
    retireHistoricalControls(turns);
    expect(turns[0]!.text).toBe(original);
  }
});

test("retirement uses the same code boundaries and preserves unfinished examples", () => {
  const example = "~~~text\n<!-- EXECUTION: COMPLETE -->\nNext choice: Keep this code example.";
  const turns: ConversationTurn[] = [{ role: "assistant", text: "Report\n<!-- EXECUTION: COMPLETE -->\n" + example }, { role: "assistant", text: "Next choice: None — task complete; no response needed." }];
  retireHistoricalControls(turns);
  expect(turns[0]!.text).toBe("Report\n" + example);
});

test("inline genuine terminal trailers establish completion outside examples", () => {
  const trailer = "Resolved three orphan records. Next choice: None — task complete; no response needed.";
  expect(hasTerminalNoWorkCompletion([{ role: "assistant", text: trailer }])).toBe(true);
  for (const example of ["> " + trailer, "    " + trailer, "~~~text\n" + trailer, '"' + trailer + '"', "`" + trailer + "`"]) {
    expect(hasTerminalNoWorkCompletion([{ role: "assistant", text: example }])).toBe(false);
  }
});
