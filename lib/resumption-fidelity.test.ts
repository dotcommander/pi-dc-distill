import { expect, test } from "bun:test";
import { DISTILL_HANDOFF_ENTRY_TYPE } from "./handoff.ts";
import { compileSessionJsonl } from "./local-compact.ts";

const line = (value: unknown) => JSON.stringify(value);

test("v2 resumption state is deterministic and preserves graph evidence", () => {
  const handoff = [
    "```distill-handoff-v2",
    JSON.stringify({
      objective: "Finish parser repair.",
      invariants: ["Legacy input remains valid."],
      decisions: [{ id: "D1", text: "Use recursive descent.", rationale: "Regex failed on nesting." }],
      "rejected-hypotheses": [{
        id: "H1",
        claim: "Input is malformed.",
        evidence: "Fixture parses with the reference parser.",
      }],
      tasks: [
        { id: "T1", status: "done", action: "Add regression fixture.", "depends-on": [], blocker: "" },
        { id: "T2", status: "pending", action: "Implement parser.", "depends-on": ["T1"], blocker: "" },
        { id: "T3", status: "blocked", action: "Publish parser.", "depends-on": ["T2"], blocker: "Await review." },
      ],
      "verification-needed": ["bun test lib/parser.test.ts"],
    }),
    "```",
  ].join("\n");
  const input = [
    line({ type: "session", id: "s1", cwd: "/tmp/project" }),
    line({ type: "custom", customType: DISTILL_HANDOFF_ENTRY_TYPE, data: { handoff } }),
    line({ type: "message", message: { role: "user", content: [{ type: "text", text: "Continue the repair." }] } }),
  ].join("\n");

  const first = compileSessionJsonl(input).summary;
  const second = compileSessionJsonl(input).summary;
  expect(second).toBe(first);
  expect(first).toContain("objective: Finish parser repair.");
  expect(first).toContain("T2 [pending]: Implement parser.");
  expect(first).toContain("depends-on: T1");
  expect(first).toContain("blocker: Await review.");
  expect(first).toContain("H1: Input is malformed.; evidence: Fixture parses with the reference parser.");
  expect(first).toContain("ready-tasks:\n- T2: Implement parser.");
  expect(first).toContain("verification-needed:\n- bun test lib/parser.test.ts");
  expect(first).toContain("task state, not verification");
});
