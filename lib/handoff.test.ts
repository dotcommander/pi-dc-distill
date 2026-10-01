import { describe, expect, test } from "bun:test";
import {
  handoffTextFromEntryData,
  parseAnyStructuredDistillHandoff,
  parseStructuredDistillHandoff,
  parseStructuredDistillHandoffV2,
  readyDistillHandoffTasks,
  distillHandoffEntry,
  type StructuredDistillHandoffV2,
} from "./handoff.ts";

function envelope(json: string): string {
  return `\`\`\`distill-handoff-v1\n${json}\n\`\`\``;
}

function envelopeV2(json: string): string {
  return `\`\`\`distill-handoff-v2\n${json}\n\`\`\``;
}

const valid = {
  objective: "Finish deterministic resume-state handling.",
  done: ["Result-confirmed file evidence implemented."],
  next: ["Run focused tests."],
  blocker: [],
  decision: ["Keep legacy handoffs compatible."],
  "verification-needed": ["bun test lib/local-compact.test.ts"],
};

const validV2: Omit<StructuredDistillHandoffV2, "version"> = {
  objective: "Finish parser repair.",
  invariants: ["Legacy input remains valid."],
  decisions: [{ id: "D1", text: "Use recursive descent.", rationale: "Regex failed on nesting." }],
  "rejected-hypotheses": [{ id: "H1", claim: "Input is malformed.", evidence: "Fixture parses with the reference parser." }],
  tasks: [
    { id: "T1", status: "done", action: "Add regression fixture.", "depends-on": [], blocker: "" },
    { id: "T2", status: "pending", action: "Implement parser.", "depends-on": ["T1"], blocker: "" },
    { id: "T3", status: "pending", action: "Run tests.", "depends-on": [], blocker: "" },
    { id: "T4", status: "blocked", action: "Publish package.", "depends-on": ["T2"], blocker: "Release approval required." },
  ],
  "verification-needed": ["bun test lib/handoff.test.ts"],
};

describe("structured distill handoff", () => {
  test("parses the strict whole-message v1 envelope", () => {
    expect(parseStructuredDistillHandoff(envelope(JSON.stringify(valid)))).toEqual(valid);
  });

  test("keeps malformed or non-v1 envelopes on the opaque legacy path", () => {
    const malformed = [
      envelope("{bad json}"),
      envelope(JSON.stringify({ ...valid, unknown: [] })),
      envelope(JSON.stringify({ ...valid, done: "finished" })),
      `${envelope(JSON.stringify(valid))}\ntrailing prose`,
      `${envelope(JSON.stringify(valid))}\n${envelope(JSON.stringify(valid))}`,
      "```distill-handoff-v2\n{}\n```",
      envelope('{"objective":"first","objective":"second","done":[],"next":[],"blocker":[],"decision":[],"verification-needed":[]}'),
    ];
    for (const value of malformed) {
      expect(parseStructuredDistillHandoff(value)).toBeUndefined();
      expect(handoffTextFromEntryData({ handoff: value })).toBe(value);
    }
  });

  test("rejects oversized fields without truncating structured state", () => {
    expect(parseStructuredDistillHandoff(envelope(JSON.stringify({
      ...valid,
      objective: "x".repeat(2_049),
    })))).toBeUndefined();
  });

  test("preserves the existing stored handoff shape", () => {
    const entry = distillHandoffEntry("  Next: run tests.  ", new Date("2026-01-01T00:00:00Z"));
    expect(entry).toEqual({ handoff: "Next: run tests.", ts: "2026-01-01T00:00:00.000Z" });
  });

  test("parses a strict v2 execution graph and derives source-stable ready tasks", () => {
    const parsed = parseStructuredDistillHandoffV2(envelopeV2(JSON.stringify(validV2)));
    expect(parsed).toBeDefined();
    expect(parsed?.version).toBe(2);
    expect(readyDistillHandoffTasks(parsed!)).toEqual([
      expect.objectContaining({ id: "T2" }),
      expect.objectContaining({ id: "T3" }),
    ]);
    expect(parseAnyStructuredDistillHandoff(envelopeV2(JSON.stringify(validV2)))).toEqual(parsed);
  });

  test("keeps malformed v2 graph envelopes on the opaque path", () => {
    const malformed = [
      envelopeV2(JSON.stringify({ ...validV2, unknown: [] })),
      envelopeV2(JSON.stringify({ ...validV2, tasks: [{ ...validV2.tasks[0], id: "1bad" }] })),
      envelopeV2(JSON.stringify({ ...validV2, tasks: [{ ...validV2.tasks[0], status: "blocked" }] })),
      envelopeV2(JSON.stringify({ ...validV2, tasks: [{ ...validV2.tasks[0], blocker: "not allowed" }] })),
      envelopeV2(JSON.stringify({ ...validV2, tasks: [{ ...validV2.tasks[0], "depends-on": ["missing"] }] })),
      envelopeV2(JSON.stringify({ ...validV2, tasks: [
        { ...validV2.tasks[0], id: "T1", "depends-on": ["T2"] },
        { ...validV2.tasks[1], id: "T2", "depends-on": ["T1"] },
      ] })),
      envelopeV2(JSON.stringify({ ...validV2, invariants: Array.from({ length: 33 }, () => "invariant") })),
      envelopeV2(JSON.stringify({ ...validV2, objective: "x".repeat(2_049) })),
      envelopeV2('{"objective":"first","objective":"second","invariants":[],"decisions":[],"rejected-hypotheses":[],"tasks":[],"verification-needed":[]}'),
      "```distill-handoff-v3\n{}\n```",
    ];
    for (const value of malformed) {
      expect(parseStructuredDistillHandoffV2(value)).toBeUndefined();
      expect(parseAnyStructuredDistillHandoff(value)).toBeUndefined();
      expect(handoffTextFromEntryData({ handoff: value })).toBe(value);
    }
  });

  test("validates decoded v2 keys while preserving escaped string content", () => {
    const value = {
      ...validV2,
      objective: 'Keep {braces}, [arrays], "quotes" and \\ paths.',
    };
    const json = JSON.stringify(value)
      .replace('"objective":', '"obj\\u0065ctive":')
      .replace('"rationale":', '"ration\\u0061le":');
    expect(parseStructuredDistillHandoffV2(envelopeV2(json))).toEqual({ version: 2, ...value });
  });

  test("rejects duplicate decoded v2 keys at every object depth", () => {
    const json = JSON.stringify(validV2);
    const duplicates = [
      json.replace('"objective":', '"obj\\u0065ctive":"duplicate","objective":'),
      json.replace('"id":"D1"', '"id":"D1","\\u0069d":"D1"'),
      json.replace('"claim":', '"cl\\u0061im":"duplicate","claim":'),
      json.replace('"action":', '"\\u0061ction":"duplicate","action":'),
    ];
    for (const duplicate of duplicates) {
      const text = envelopeV2(duplicate);
      expect(parseAnyStructuredDistillHandoff(text)).toBeUndefined();
      expect(handoffTextFromEntryData({ handoff: text })).toBe(text);
    }
  });

  test("rejects missing and extra v2 fields in each nested record", () => {
    for (const [field, key] of [
      ["decisions", "rationale"],
      ["rejected-hypotheses", "evidence"],
      ["tasks", "blocker"],
    ] as const) {
      const item = validV2[field][0];
      const missing = { ...item } as Record<string, unknown>;
      delete missing[key];
      for (const invalid of [missing, { ...item, unknown: {} }, { ...item, [key]: null }]) {
        const text = envelopeV2(JSON.stringify({ ...validV2, [field]: [invalid] }));
        expect(parseAnyStructuredDistillHandoff(text)).toBeUndefined();
        expect(handoffTextFromEntryData({ handoff: text })).toBe(text);
      }
    }
  });

  test("retains conservative v1 raw-key validation", () => {
    const json = JSON.stringify(valid).replace('"objective":', '"obj\\u0065ctive":');
    expect(parseStructuredDistillHandoff(envelope(json))).toBeUndefined();
  });
});
