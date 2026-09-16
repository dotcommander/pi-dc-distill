import { describe, expect, test } from "bun:test";
import {
  handoffTextFromEntryData,
  parseStructuredShrinkHandoff,
  shrinkHandoffEntry,
} from "./handoff.ts";

function envelope(json: string): string {
  return `\`\`\`shrink-handoff-v1\n${json}\n\`\`\``;
}

const valid = {
  objective: "Finish deterministic resume-state handling.",
  done: ["Result-confirmed file evidence implemented."],
  next: ["Run focused tests."],
  blocker: [],
  decision: ["Keep legacy handoffs compatible."],
  "verification-needed": ["bun test lib/local-compact.test.ts"],
};

describe("structured shrink handoff", () => {
  test("parses the strict whole-message v1 envelope", () => {
    expect(parseStructuredShrinkHandoff(envelope(JSON.stringify(valid)))).toEqual(valid);
  });

  test("keeps malformed or non-v1 envelopes on the opaque legacy path", () => {
    const malformed = [
      envelope("{bad json}"),
      envelope(JSON.stringify({ ...valid, unknown: [] })),
      envelope(JSON.stringify({ ...valid, done: "finished" })),
      `${envelope(JSON.stringify(valid))}\ntrailing prose`,
      `${envelope(JSON.stringify(valid))}\n${envelope(JSON.stringify(valid))}`,
      "```shrink-handoff-v2\n{}\n```",
      envelope('{"objective":"first","objective":"second","done":[],"next":[],"blocker":[],"decision":[],"verification-needed":[]}'),
    ];
    for (const value of malformed) {
      expect(parseStructuredShrinkHandoff(value)).toBeUndefined();
      expect(handoffTextFromEntryData({ handoff: value })).toBe(value);
    }
  });

  test("rejects oversized fields without truncating structured state", () => {
    expect(parseStructuredShrinkHandoff(envelope(JSON.stringify({
      ...valid,
      objective: "x".repeat(2_049),
    })))).toBeUndefined();
  });

  test("preserves the existing stored handoff shape", () => {
    const entry = shrinkHandoffEntry("  Next: run tests.  ", new Date("2026-01-01T00:00:00Z"));
    expect(entry).toEqual({ handoff: "Next: run tests.", ts: "2026-01-01T00:00:00.000Z" });
  });
});
