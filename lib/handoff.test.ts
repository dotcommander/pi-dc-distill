import { describe, expect, test } from "bun:test";
import {
  handoffTextFromEntryData,
  parseAnyStructuredDistillHandoff,
  parseStructuredDistillHandoff,
  parseStructuredDistillHandoffV2,
  parseStructuredDistillHandoffV3,
  isStructuredDistillHandoffV3,
  readyDistillHandoffTasks,
  distillHandoffEntry,
  type StructuredDistillHandoffV2,
  type StructuredDistillHandoffV3,
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

  test("v1 rejects literal and decoded duplicate keys", () => {
    const json = JSON.stringify(valid);
    for (const duplicate of ['"objective":"duplicate",', '"obj\\u0065ctive":"duplicate",']) {
      expect(parseStructuredDistillHandoff(envelope(json.replace("{", `{${duplicate}`)))).toBeUndefined();
    }
  });

  test("key-like string content stays string content", () => {
    const value = { ...valid, objective: 'Keep the text "objective": inside a string.' };
    expect(parseStructuredDistillHandoff(envelope(JSON.stringify(value)))?.objective).toBe(value.objective);
  });

  test("retains conservative v1 raw-key validation", () => {
    const json = JSON.stringify(valid).replace('"objective":', '"obj\\u0065ctive":');
    expect(parseStructuredDistillHandoff(envelope(json))).toBeUndefined();
  });
});

function envelopeV3(value: unknown): string {
  return `\`\`\`distill-handoff-v3\n${JSON.stringify(value)}\n\`\`\``;
}

const validV3: Omit<StructuredDistillHandoffV3, "version"> = {
  ...validV2,
  tasks: validV2.tasks.map((task) => ({ ...task, requires: task.id === "T2" ? ["P1", "P2"] : [] })),
  preconditions: [
    { id: "P1", kind: "file-read-succeeded", path: "src/../src/parser.ts", cwd: "/tmp/project" },
    { id: "P2", kind: "verification-pass", runner: "Bash", command: " bun test lib/handoff.test.ts\n", cwd: "/tmp/project" },
  ],
};

describe("observed-readiness v3 handoff parser", () => {
  test("retains exact predicate identity and intact graph readiness", () => {
    const text = envelopeV3(validV3);
    const parsed = parseStructuredDistillHandoffV3(text)!;
    expect(parsed).toEqual({ version: 3, ...validV3 });
    expect(parseAnyStructuredDistillHandoff(text)).toEqual(parsed);
    expect(isStructuredDistillHandoffV3(parsed)).toBe(true);
    expect(readyDistillHandoffTasks(parsed).map((task) => task.id)).toEqual(["T2", "T3"]);
    expect(readyDistillHandoffTasks(parsed)[0].requires).toEqual(["P1", "P2"]);
    expect(parseStructuredDistillHandoffV2(text)).toBeUndefined();
    expect(isStructuredDistillHandoffV3({ version: 2, ...validV2 })).toBe(false);
  });

  test("permits empty predicates and requirements", () => {
    const value = { ...validV3, preconditions: [], tasks: validV3.tasks.map((task) => ({ ...task, requires: [] })) };
    expect(parseStructuredDistillHandoffV3(envelopeV3(value))).toEqual({ version: 3, ...value });
  });

  test("accepts the exact 32-predicate cap with unique complete references", () => {
    const preconditions = Array.from({ length: 32 }, (_, i) => ({ ...validV3.preconditions[0], id: `P${i}` }));
    const value = { ...validV3, preconditions, tasks: [{ ...validV3.tasks[0], status: "pending", requires: preconditions.map(({ id }) => id) }] };
    expect(parseStructuredDistillHandoffV3(envelopeV3(value))?.preconditions).toHaveLength(32);
  });

  test("rejects invalid, duplicated and unknown predicate identities and kinds", () => {
    const first = validV3.preconditions[0];
    const values = [
      { ...validV3, preconditions: [first, first] },
      { ...validV3, preconditions: [{ ...first, id: "1bad" }] },
      { ...validV3, preconditions: [{ ...first, kind: "file-exists" }] },
      { ...validV3, preconditions: Array.from({ length: 33 }, (_, i) => ({ ...first, id: `P${i}` })) },
      { ...validV3, tasks: [{ ...validV3.tasks[0], requires: ["missing"] }] },
      { ...validV3, tasks: [{ ...validV3.tasks[0], requires: ["P1", "P1"] }] },
      { ...validV3, tasks: [{ ...validV3.tasks[0], requires: "P1" }] },
      { ...validV3, tasks: [{ ...validV3.tasks[0], requires: [null] }] },
    ];
    for (const value of values) expect(parseAnyStructuredDistillHandoff(envelopeV3(value))).toBeUndefined();
  });

  test("requires exact predicate shapes and task requirement fields", () => {
    for (const predicate of validV3.preconditions) {
      for (const key of Object.keys(predicate)) {
        const missing = { ...predicate } as Record<string, unknown>;
        delete missing[key];
        expect(parseStructuredDistillHandoffV3(envelopeV3({ ...validV3, preconditions: [missing] }))).toBeUndefined();
      }
      expect(parseStructuredDistillHandoffV3(envelopeV3({ ...validV3, preconditions: [{ ...predicate, unknown: true }] }))).toBeUndefined();
    }
    const missing = { ...validV3.tasks[0] } as Record<string, unknown>;
    delete missing.requires;
    expect(parseStructuredDistillHandoffV3(envelopeV3({ ...validV3, tasks: [missing] }))).toBeUndefined();
    expect(parseStructuredDistillHandoffV3(envelopeV3({ ...validV3, unknown: true }))).toBeUndefined();
  });

  test("rejects unknown cwd, unsafe paths, incompatible runners and invalid commands", () => {
    const read = validV3.preconditions[0];
    const pass = validV3.preconditions[1];
    const invalid = [
      ...[".", "relative/dir", "unknown", " /tmp/project", "/tmp/\0project"].map((cwd) => ({ ...read, cwd })),
      ...["", " src/parser.ts", "src/\nparser.ts", "src/\0parser.ts"].map((path) => ({ ...read, path })),
      ...["", "read", "bash ", "exec_command"].map((runner) => ({ ...pass, runner })),
      ...["", "   ", "bun test\0", "x".repeat(2_049)].map((command) => ({ ...pass, command })),
    ];
    for (const predicate of invalid) {
      expect(parseStructuredDistillHandoffV3(envelopeV3({ ...validV3, preconditions: [predicate] }))).toBeUndefined();
    }
  });

  test("rejects cycles, duplicate dependencies and missing references without changing v2", () => {
    const tasks = [
      { ...validV3.tasks[0], "depends-on": ["T2"] },
      { ...validV3.tasks[1], "depends-on": ["T1"] },
    ];
    expect(parseStructuredDistillHandoffV3(envelopeV3({ ...validV3, tasks }))).toBeUndefined();
    for (const dependsOn of [["missing"], ["T1", "T1"], ["T2"]]) {
      expect(parseStructuredDistillHandoffV3(envelopeV3({ ...validV3, tasks: [validV3.tasks[0], { ...validV3.tasks[1], "depends-on": dependsOn }] }))).toBeUndefined();
    }
    const v2 = { ...validV2, tasks: [validV2.tasks[0], { ...validV2.tasks[1], "depends-on": ["T1", "T1"] }] };
    expect(parseStructuredDistillHandoffV2(envelopeV2(JSON.stringify(v2)))).toBeDefined();
  });

  test("rejects decoded duplicate predicate keys and trailing prose", () => {
    const text = envelopeV3(validV3);
    expect(parseStructuredDistillHandoffV3(text.replace('"kind":', '"k\\u0069nd":"duplicate","kind":'))).toBeUndefined();
    expect(parseStructuredDistillHandoffV3(`${text}\ntrailing prose`)).toBeUndefined();
    expect(parseStructuredDistillHandoffV3(text.replace('"kind":', '"k\\u0069nd":'))).toEqual({ version: 3, ...validV3 });
  });

  test("counts Unicode field boundaries without shortening predicate bytes", () => {
    const command = "😀".repeat(2_048);
    const value = { ...validV3, preconditions: [{ ...validV3.preconditions[1], command }], tasks: validV3.tasks.map((task) => ({ ...task, requires: [] })) };
    expect(parseStructuredDistillHandoffV3(envelopeV3(value))?.preconditions).toEqual(value.preconditions);
    expect(parseStructuredDistillHandoffV3(envelopeV3({ ...value, preconditions: [{ ...value.preconditions[0], command: `${command}😀` }] }))).toBeUndefined();
  });
});
