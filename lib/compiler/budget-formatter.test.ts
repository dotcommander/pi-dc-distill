import { describe, expect, test } from "bun:test";
import { buildSummary, decodeSummary, encodeSummary, evictOldestOptional } from "./budget-formatter.ts";
import { certifyToolPairs, extractObservations } from "./tool-tracker.ts";
import { emptyOmissions, SUMMARY_COLUMNS, SUMMARY_FORMAT, SUMMARY_NOTICE, TARGET_RESUME_SUMMARY_CODE_POINTS } from "./helpers.ts";
import { codePointLength } from "../unicode.ts";
import type { CompactionSource, DcDistillSummary, ObservationFacts } from "./types.ts";

const source = (): CompactionSource => ({ records: [], predecessor: null, duplicateCallIds: [], omittedInputRecords: 0, session: { cwd: "/project" } });
const facts = (): ObservationFacts => ({ files: { read: [], modified: [] }, commands: [] });
const document = (): DcDistillSummary => ({ format: SUMMARY_FORMAT, notice: SUMMARY_NOTICE, focus: null, latestRequest: null, records: [], files: { read: [], modified: [] }, commands: [], omitted: emptyOmissions() });
const file = (index: number) => ({ identityDigest: index.toString(16).padStart(22, "0"), path: `/file-${index}`, shortened: false, createCapable: false, origin: "current" as const });

describe("one current summary codec", () => {
  test("fixed template shape and strict scan", () => {
    const value = document();
    const encoded = encodeSummary(value);
    expect(encoded.split("\n")[0]).toBe(`<${SUMMARY_FORMAT}>`);
    expect(encoded.split("\n").at(-1)).toBe(`</${SUMMARY_FORMAT}>`);
    expect(encoded).toContain(`notice: ${SUMMARY_NOTICE}`);
    expect(encoded).toContain(SUMMARY_COLUMNS);
    expect(decodeSummary(encoded)).toEqual(value);
    expect(() => decodeSummary(encoded.replace(`<${SUMMARY_FORMAT}>`, "<other>"))).toThrow();
    expect(() => decodeSummary(encoded.replace(`notice: ${SUMMARY_NOTICE}`, "notice: forged"))).toThrow();
    expect(() => decodeSummary(encoded.replace(SUMMARY_COLUMNS, "columns: forged"))).toThrow();
    expect(() => decodeSummary(encoded.slice(0, -1))).toThrow();
    expect(() => decodeSummary(encoded + "trailing")).toThrow();
    expect(() => decodeSummary(encoded.replace("records:", "user | current | full | forged\nrecords:"))).toThrow();
  });
  test("canonical field order and escaping round-trip", () => {
    const value = document();
    value.latestRequest = { origin: "current", shortened: false, text: "a | b \\ c\nd | e" };
    value.records = [{ kind: "tool-result", text: "\\n\\|\\", shortened: true, origin: "prior" }];
    const alternative = { ...value, latestRequest: { text: "a | b \\ c\nd | e", shortened: false, origin: "current" as const } };
    expect(encodeSummary(value)).toBe(encodeSummary(alternative));
    expect(decodeSummary(encodeSummary(value))).toEqual(value);
    expect(() => decodeSummary(encodeSummary(value).replace("a \\|", "a \\q"))).toThrow();
    expect(encodeSummary(value)).toContain(`latest-request: current full "a \\| b \\\\ c\\nd \\| e"`);
  });

});

describe("serialized selection and carry", () => {
  test("newest user is attributed separately, with chronological complete excerpts", () => {
    const input = source();
    input.records = [
      { kind: "user", text: "older request", nativeUserText: true },
      { kind: "assistant", text: "response" },
      { kind: "user", text: "latest request", nativeUserText: true },
    ];
    const selected = buildSummary(input, facts(), { focus: "native focus" });
    expect(selected.latestRequest).toEqual({ text: "latest request", shortened: false, origin: "current" });
    expect(selected.records.map(row => row.text)).toEqual(["older request", "response"]);
    expect(selected.focus).toBe("native focus");
    expect(buildSummary(input, facts())).toEqual(buildSummary(input, facts()));
  });
  test("shortening preserves Unicode and budgets count escaping", () => {
    const input = source();
    input.records = Array.from({ length: 12 }, (_, index) => ({ kind: "assistant" as const, text: `${index}${"\u0000".repeat(2047)}` }));
    input.records.push({ kind: "user", text: "😀".repeat(3000), nativeUserText: true });
    const selected = buildSummary(input, facts());
    expect(codePointLength(selected.latestRequest!.text)).toBe(2048);
    expect(selected.latestRequest!.shortened).toBe(true);
    expect(codePointLength(encodeSummary(selected))).toBeLessThanOrEqual(8192);
    expect(selected.omitted.excerpts).toBe(12 - selected.records.length);
    expect(selected.records.length).toBeGreaterThan(0);
    expect(decodeSummary(encodeSummary(selected))).toEqual(selected);
  });
  test("signal priority: substantive rows claim budget before newer chatter", () => {
    const input = source();
    const diff = "diff --git a/src/x b/src/x\n--- a/src/x\n+++ b/src/x\n@@ -1 +1 @@\n-old\n+new";
    const chatter = "Let me check that for you right now. " + "x".repeat(2010);
    input.records = [ { kind: "assistant", text: diff },
      ...Array.from({ length: 4 }, () => ({ kind: "assistant" as const, text: chatter })) ];
    const selected = buildSummary(input, facts());
    expect(selected.records.some(row => row.text.includes("diff --git"))).toBe(true);
    expect(selected.records.length).toBeLessThan(5);
    expect(selected.omitted.excerpts).toBe(5 - selected.records.length);
    expect(decodeSummary(encodeSummary(selected))).toEqual(selected);
  });
  test("admission accounting stays exact at the operating boundary", () => {
    const input = source();
    input.records = [
      ...Array.from({ length: 40 }, (_, index) => ({ kind: "assistant" as const, text: index % 3 === 0 ? `diff --git a/x${index} b/x${index}\n--- a/x${index}\n+++ b/x${index}\n@@ -1 +1 @@\n-old\n+new ${index}\n context ` + "z".repeat(400) : index % 3 === 1 ? `note ${index} 😀 | \\ tail ` + "y".repeat(380) : `error: boom ${index}` })),
      { kind: "user", text: "newest request", nativeUserText: true },
    ];
    const document = buildSummary(input, (certifyToolPairs(input.records), extractObservations(input)));
    // No predecessor or facts, so the operating limit is exactly the target.
    expect(codePointLength(encodeSummary(document))).toBeLessThanOrEqual(TARGET_RESUME_SUMMARY_CODE_POINTS);
    const order = new Map(input.records.map((record, position) => [record.text, position]));
    const admitted = new Set(document.records.map(row => row.text));
    expect(admitted.size).toBeLessThan(input.records.length - 1); // rows were actually rejected
    for (const record of input.records) {
      if (record.kind === "user" && record.nativeUserText === true || admitted.has(record.text)) continue;
      // Inserting any rejected row (chronologically, counter adjusted) must
      // overflow the same target the selector accounted against.
      const trial: DcDistillSummary = { ...document,
        records: [...document.records, { kind: record.kind, text: record.text, shortened: false, origin: "current" as const }]
          .sort((a, b) => (order.get(a.text) ?? 0) - (order.get(b.text) ?? 0)),
        omitted: { ...document.omitted, excerpts: document.omitted.excerpts - 1 } };
      expect(codePointLength(encodeSummary(trial))).toBeGreaterThan(TARGET_RESUME_SUMMARY_CODE_POINTS);
    }
  });
  test("large-input excerpt timing smoke test", () => {
    const input = source();
    input.records = Array.from({ length: 64_000 }, (_, index) => ({ kind: "assistant" as const, text: `progress update ${index} ` + "x".repeat(100) }));
    input.records.push({ kind: "user", text: "latest request", nativeUserText: true });
    const start = performance.now();
    const document = buildSummary(input, facts());
    const elapsed = performance.now() - start;
    expect(document.records.length).toBeGreaterThan(0);
    expect(document.omitted.excerpts).toBe(64_000 - document.records.length);
    expect(elapsed).toBeLessThan(10_000);
  }, 10_000);
  test("identical adjacent retries render as their own rows without synthesized outcomes", () => {
    const input = source();
    const call = (id: string) => ({ kind: "tool-call" as const, name: "read", text: 'read {"path":"lib/main.ts"}', args: { path: "lib/main.ts" }, pairing: { state: "identified" as const, id }, callId: id });
    const result = (id: string, error: boolean) => ({ kind: "tool-result" as const, name: "read", text: error ? "error: ENOENT" : "module contents", isError: error, pairing: { state: "identified" as const, id }, callId: id });
    input.records = [
      call("c0"), result("c0", true), call("c1"), result("c1", true), call("c2"), result("c2", false),
      { kind: "tool-call", name: "edit", text: 'edit {"path":"lib/main.ts"}', args: { path: "lib/main.ts" }, pairing: { state: "identified", id: "c3" }, callId: "c3" },
    ];
    const selected = buildSummary(input, facts());
    expect(selected.records.map(row => row.text)).toEqual(['read {"path":"lib/main.ts"}', "error: ENOENT", 'read {"path":"lib/main.ts"}', "error: ENOENT", 'read {"path":"lib/main.ts"}', "module contents", 'edit {"path":"lib/main.ts"}']);
    expect(selected.records.map(row => row.kind)).toEqual(["tool-call", "tool-result", "tool-call", "tool-result", "tool-call", "tool-result", "tool-call"]);
    expect(selected.omitted.excerpts).toBe(0);
    expect(decodeSummary(encodeSummary(selected))).toEqual(selected);
  });
  test("signal-tiered whole-row eviction protects substantive rows and failure evidence", () => {
    const value = document();
    value.records = [
      { kind: "assistant", text: "ok.", shortened: false, origin: "current" },
      { kind: "assistant", text: "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-o\n+n", shortened: false, origin: "current" },
    ];
    value.commands = [
      { identityDigest: "0".repeat(22), runner: "bash", command: "echo first", cwd: null, status: "success" as const, result: "", shortened: false, origin: "current" as const },
      { identityDigest: "1".repeat(22), runner: "bash", command: "echo second", cwd: null, status: "error" as const, result: "boom", shortened: false, origin: "current" as const },
    ];
    value.files.read = [file(1)];
    value.files.modified = [file(2)];
    expect(evictOldestOptional(value)).toBe(true);
    expect(value.records.map(row => row.text)).toEqual([value.records[0]!.text]);
    expect(evictOldestOptional(value)).toBe(true);
    expect(value.commands.map(row => row.command)).toEqual(["echo second"]);
    expect(evictOldestOptional(value)).toBe(true);
    expect(value.records).toHaveLength(0);
    expect(evictOldestOptional(value)).toBe(true);
    expect(value.commands).toHaveLength(0);
    expect(evictOldestOptional(value)).toBe(true);
    expect(value.files.read).toHaveLength(0);
    expect(evictOldestOptional(value)).toBe(true);
    expect(value.files.modified).toHaveLength(0);
    expect(evictOldestOptional(value)).toBe(false);
    expect(value.omitted).toEqual({ inputRecords: 0, excerpts: 2, readFiles: 1, modifiedFiles: 1, commands: 2 });
  });
  test("newest fitting excerpts survive; skipped rows count exactly once", () => {
    const input = source();
    input.records = [{ kind: "assistant", text: "old" }, { kind: "assistant", text: "\u0000".repeat(2048) }, { kind: "assistant", text: "new" }];
    input.omittedInputRecords = 4;
    const selected = buildSummary(input, facts());
    expect(selected.records.map(row => row.text)).toEqual(["old", "\u0000".repeat(2048), "new"]);
    expect(selected.omitted).toEqual({ inputRecords: 4, excerpts: 0, readFiles: 0, modifiedFiles: 0, commands: 0 });
  });
  test("facts share a bounded serialized allowance and omission totals", () => {
    const observed = facts();
    observed.files.read = Array.from({ length: 70 }, (_, index) => file(index));
    observed.files.modified = Array.from({ length: 70 }, (_, index) => file(index + 100));
    observed.commands = Array.from({ length: 15 }, (_, index) => ({ identityDigest: "a".repeat(22), runner: "bash", command: `echo ${index}`, cwd: null, status: "unknown" as const, result: "", shortened: false, origin: "current" as const }));
    const selected = buildSummary(source(), observed);
    const rows = [
      ...selected.files.read.map(row => `read ${row.identityDigest} | ${row.origin} | ${row.shortened ? "cut" : "full"} | ${row.createCapable ? "yes" : "no"} | ${row.path}`),
      ...selected.files.modified.map(row => `modified ${row.identityDigest} | ${row.origin} | ${row.shortened ? "cut" : "full"} | ${row.createCapable ? "yes" : "no"} | ${row.path}`),
      ...selected.commands.map(row => `cmd ${row.identityDigest} | ${row.origin} | ${row.shortened ? "cut" : "full"} | ${row.runner} | ${row.status} | ${row.cwd === null ? "none" : row.cwd} | ${row.command} | ${row.result}`),
    ];
    expect(codePointLength(rows.join("\n"))).toBeLessThanOrEqual(2048);
    expect(selected.files.modified.at(-1)?.path).toBe("/file-169");
    expect(selected.commands.at(-1)?.command).toBe("echo 14");
    expect(selected.files.read.at(-1)?.path).toBe("/file-69");
    expect(selected.omitted.readFiles + selected.files.read.length).toBe(70);
    expect(selected.omitted.modifiedFiles + selected.files.modified.length).toBe(70);
    expect(selected.omitted.commands + selected.commands.length).toBe(15);
  });
  test("repeated carry is flat and counters are carried once", () => {
    const first = source();
    first.records = [{ kind: "assistant", text: "conversation" }, { kind: "user", text: "request", nativeUserText: true }];
    first.omittedInputRecords = 3;
    let prior = buildSummary(first, facts(), { focus: "temporary" });
    prior.omitted.excerpts = 7;
    for (let iteration = 0; iteration < 6; iteration++) {
      const next = source(); next.predecessor = decodeSummary(encodeSummary(prior));
      prior = buildSummary(next, facts());
      expect(prior.focus).toBeNull();
      expect(prior.records).toEqual([{ text: "conversation", shortened: false, origin: "prior", kind: "assistant" }]);
      expect(prior.latestRequest?.origin).toBe("prior");
      expect(prior.omitted.inputRecords).toBe(3);
      expect(prior.omitted.excerpts).toBe(7);
      expect(encodeSummary(prior)).not.toContain('\\"dc-distill-summary\\"');
    }
  });
  test("replacing the latest request preserves excerpt chronology without an omission", () => {
    const input = source(); input.predecessor = document();
    input.predecessor.latestRequest = { text: "old request", shortened: false, origin: "current" };
    input.predecessor.records = [{ kind: "assistant", text: "old response", shortened: false, origin: "current" }];
    input.predecessor.omitted.excerpts = 2;
    input.records = [{ kind: "assistant", text: "later response" }, { kind: "user", text: "new request", nativeUserText: true }];
    const selected = buildSummary(input, facts());
    expect(selected.records).toEqual([
      { text: "old response", shortened: false, origin: "prior", kind: "assistant" },
      { text: "later response", shortened: false, origin: "current", kind: "assistant" },
    ]);
    expect(selected.latestRequest?.text).toBe("new request");
    expect(selected.omitted.excerpts).toBe(2);
  });
  test("whole-row eviction order and saturating counters", () => {
    const value = document();
    value.records = [{ text: "excerpt", shortened: false, origin: "current", kind: "assistant" }];
    value.files.read = [file(1)]; value.files.modified = [file(2)];
    value.commands = [{ identityDigest: "a".repeat(22), runner: "bash", command: "echo", cwd: null, status: "success", result: "ok", shortened: false, origin: "current" }];
    value.omitted.excerpts = Number.MAX_SAFE_INTEGER;
    expect(evictOldestOptional(value)).toBe(true); expect(value.records).toHaveLength(0);
    expect(value.omitted.excerpts).toBe(Number.MAX_SAFE_INTEGER);
    expect(evictOldestOptional(value)).toBe(true); expect(value.commands).toHaveLength(0);
    expect(evictOldestOptional(value)).toBe(true); expect(value.files.read).toHaveLength(0);
    expect(evictOldestOptional(value)).toBe(true); expect(value.files.modified).toHaveLength(0);
    expect(evictOldestOptional(value)).toBe(false);
    expect(value.omitted.commands).toBe(1);
    expect(value.omitted.readFiles).toBe(1);
    expect(value.omitted.modifiedFiles).toBe(1);
  });
  test("mandatory escaped content may exceed the operating target without truncation", () => {
    // Field bounds cap mandatory content below the hard limit today; even its
    // most expensive escaping remains complete when it exceeds the soft target.
    const input = source(); input.records = [{ kind: "user", nativeUserText: true, text: "|".repeat(2048) }];
    const selected = buildSummary(input, facts(), { focus: "|".repeat(2048) });
    expect(codePointLength(encodeSummary(selected))).toBeGreaterThan(8192);
    expect(codePointLength(encodeSummary(selected))).toBeLessThanOrEqual(65536);
    expect(selected.latestRequest?.text).toBe("|".repeat(2048));
    expect(selected.focus).toBe("|".repeat(2048));
  });
});
  test("foreign tool results keep their own rows", () => {
    const input = source();
    input.records = [
      { kind: "tool-call", name: "edit", text: 'edit {"path":"a.ts"}', args: { path: "a.ts" }, pairing: { state: "identified", id: "c1" }, callId: "c1" },
      { kind: "tool-call", name: "edit", text: 'edit {"path":"a.ts"}', args: { path: "a.ts" }, pairing: { state: "identified", id: "c2" }, callId: "c2" },
      { kind: "tool-result", name: "read", text: "contents of UNRELATED file", isError: false, pairing: { state: "identified", id: "other" }, callId: "other" },
      { kind: "tool-result", name: "edit", text: "error: ENOENT a.ts", isError: true, pairing: { state: "identified", id: "c2" }, callId: "c2" },
    ];
    const texts = buildSummary(input, facts(), {}).records.map(row => row.text);
    // A result with an unrelated call id keeps its own row; no synthesized outcome claims exist.
    expect(texts).toContain("contents of UNRELATED file");
    expect(texts).toContain("error: ENOENT a.ts");
    expect(texts.filter(text => text.startsWith("[repeat:"))).toHaveLength(0);
    expect(texts.some(text => text.includes("last ok") || text.includes("last error") || text.includes("last unknown"))).toBe(false);
  });
  test("idless runs keep their own rows; foreign names never pair", () => {
    const input = source();
    input.records = [
      { kind: "tool-call", name: "edit", text: 'edit {"path":"a.ts"}', args: { path: "a.ts" }, pairing: { state: "unpairable" } },
      { kind: "tool-call", name: "edit", text: 'edit {"path":"a.ts"}', args: { path: "a.ts" }, pairing: { state: "unpairable" } },
      { kind: "tool-result", name: "read", text: "unrelated idless read output", pairing: { state: "unpairable" } },
    ];
    const texts = buildSummary(input, facts(), {}).records.map(row => row.text);
    expect(texts.filter(text => text === "unrelated idless read output")).toHaveLength(1);
    expect(texts.filter(text => text.startsWith("[repeat:"))).toHaveLength(0);
    const paired = source();
    paired.records = [
      { kind: "tool-call", name: "read", text: 'read {"path":"a.ts"}', args: { path: "a.ts" }, pairing: { state: "unpairable" } },
      { kind: "tool-call", name: "read", text: 'read {"path":"a.ts"}', args: { path: "a.ts" }, pairing: { state: "unpairable" } },
      { kind: "tool-result", name: "read", text: "module contents", pairing: { state: "unpairable" } },
    ];
    const pairedTexts = buildSummary(paired, facts(), {}).records.map(row => row.text);
    expect(pairedTexts).toEqual(['read {"path":"a.ts"}', 'read {"path":"a.ts"}', "module contents"]);
  });
  test("excerpt rows never synthesize tool outcomes the fact model rejects", () => {
    // The fact extractor refuses to pair every facet below; excerpt rows must
    // not assert an outcome for them either: absent isError, raw-name mismatch
    // on a matching call id, duplicate call ids, and an idless certificate that
    // forbids pairing.
    const absent = source();
    absent.records = [
      { kind: "tool-call", name: "read", text: 'read {"path":"a"}', args: { path: "a" }, pairing: { state: "identified", id: "k1" }, callId: "k1" },
      { kind: "tool-call", name: "read", text: 'read {"path":"a"}', args: { path: "a" }, pairing: { state: "identified", id: "k2" }, callId: "k2" },
      { kind: "tool-result", name: "read", text: "error: failed to open", pairing: { state: "identified", id: "k2" }, callId: "k2" },
    ];
    const mismatch = source();
    mismatch.records = [
      { kind: "tool-call", name: "read", text: 'read {"path":"a"}', args: { path: "a" }, pairing: { state: "identified", id: "k1" }, callId: "k1" },
      { kind: "tool-call", name: "read", text: 'read {"path":"a"}', args: { path: "a" }, pairing: { state: "identified", id: "k2" }, callId: "k2" },
      { kind: "tool-result", name: "view", text: "unrelated tool output", isError: false, pairing: { state: "identified", id: "k2" }, callId: "k2" },
    ];
    const duplicate = source();
    duplicate.duplicateCallIds = ["d1"];
    duplicate.records = [
      { kind: "tool-call", name: "read", text: 'read {"path":"a"}', args: { path: "a" }, pairing: { state: "identified", id: "d1" }, callId: "d1" },
      { kind: "tool-call", name: "read", text: 'read {"path":"a"}', args: { path: "a" }, pairing: { state: "identified", id: "d1" }, callId: "d1" },
      { kind: "tool-result", name: "read", text: "module contents", isError: false, pairing: { state: "identified", id: "d1" }, callId: "d1" },
    ];
    const forbidden = source();
    forbidden.records = [
      { kind: "tool-call", name: "read", text: 'read {"path":"a"}', args: { path: "a" }, pairing: { state: "unpairable" } },
      { kind: "tool-call", name: "read", text: 'read {"path":"a"}', args: { path: "a" }, pairing: { state: "unpairable" } },
      { kind: "tool-result", name: "read", text: "module contents", isError: false, pairing: { state: "unpairable" } },
    ];
    for (const input of [absent, mismatch, duplicate, forbidden]) {
      const document = buildSummary(input, (certifyToolPairs(input.records), extractObservations(input)));
      const encoded = encodeSummary(document);
      expect(encoded.includes("[repeat:")).toBe(false);
      expect(encoded.includes("last ok")).toBe(false);
      expect(document.files.read).toHaveLength(0);
      expect(decodeSummary(encoded)).toEqual(document);
    }
    // Recorded error-looking text stays its own row, with no adjacent success claim.
    expect(buildSummary(absent, extractObservations(absent)).records.map(row => row.text)).toContain("error: failed to open");
  });


test("user constraint survives 24 diffs, continue, and repeated current-format carry", () => {
  const input = source();
  const constraint = "Keep the public API unchanged.";
  input.records = [
    { kind: "user", text: constraint, nativeUserText: true },
    ...Array.from({ length: 24 }, (_, index) => ({ kind: "assistant" as const,
      text: `diff --git a/file-${index} b/file-${index}\n--- old\n+++ new\n@@ -1 +1 @@\n-removed\n+added ` + "x".repeat(1700) })),
    { kind: "user", text: "continue", nativeUserText: true },
  ];
  let selected = buildSummary(input, facts());
  expect(selected.latestRequest?.text).toBe("continue");
  expect(selected.records[0]?.text).toBe(constraint);
  expect(selected.omitted.excerpts).toBeGreaterThan(0);
  for (let iteration = 0; iteration < 4; iteration++) {
    const next = source(); next.predecessor = decodeSummary(encodeSummary(selected));
    next.records = Array.from({ length: 24 }, (_, index) => ({ kind: "assistant" as const,
      text: `diff --git a/new-${iteration}-${index} b/new\n@@ -1 +1 @@\n-old\n+new ` + "z".repeat(1700) }));
    selected = buildSummary(next, facts());
    expect(selected.records.some(row => row.kind === "user" && row.text === constraint && row.origin === "prior")).toBe(true);
    expect(selected.latestRequest?.text).toBe("continue");
    expect(codePointLength(encodeSummary(selected))).toBeLessThanOrEqual(8192);
  }
});

test("user excerpts claim admission newest first, including image placeholders", () => {
  const input = source();
  input.records = [
    ...Array.from({ length: 5 }, (_, index) => ({ kind: "user" as const, text: `${index} [image] ` + "x".repeat(2000) })),
    { kind: "assistant", text: "error: evidence " + "y".repeat(2000) },
    { kind: "user", text: "continue", nativeUserText: true },
  ];
  const selected = buildSummary(input, facts());
  expect(selected.records.map(row => row.text[0])).toEqual(["2", "3", "4"]);
  expect(selected.latestRequest?.text).toBe("continue");
});

test("capacity eviction exhausts other optional rows before user excerpts", () => {
  const value = document();
  value.latestRequest = { text: "continue", shortened: false, origin: "current" };
  value.records = [
    { kind: "user", text: "old constraint", shortened: false, origin: "prior" },
    { kind: "assistant", text: "ok", shortened: false, origin: "current" },
    { kind: "assistant", text: "error: preserve evidence", shortened: false, origin: "current" },
    { kind: "user", text: "new constraint", shortened: false, origin: "current" },
  ];
  value.commands = [
    { identityDigest: "a".repeat(22), runner: "bash", command: "error command", cwd: null, status: "error", result: "error", shortened: false, origin: "current" },
    { identityDigest: "b".repeat(22), runner: "bash", command: "unknown command", cwd: null, status: "unknown", result: "", shortened: false, origin: "current" },
  ];
  value.files.read = [file(1)]; value.files.modified = [file(2)];
  const remaining = () => [value.records.map(row => row.text), value.commands.map(row => row.command), value.files.read.length, value.files.modified.length];
  expect(evictOldestOptional(value)).toBe(true);
  expect(remaining()).toEqual([["old constraint", "error: preserve evidence", "new constraint"], ["error command", "unknown command"], 1, 1]);
  expect(evictOldestOptional(value)).toBe(true); expect(value.commands.map(row => row.command)).toEqual(["error command"]);
  expect(evictOldestOptional(value)).toBe(true); expect(value.records.map(row => row.text)).toEqual(["old constraint", "new constraint"]);
  expect(evictOldestOptional(value)).toBe(true); expect(value.commands).toHaveLength(0);
  expect(evictOldestOptional(value)).toBe(true); expect(value.files.read).toHaveLength(0);
  expect(evictOldestOptional(value)).toBe(true); expect(value.files.modified).toHaveLength(0);
  expect(evictOldestOptional(value)).toBe(true); expect(value.records.map(row => row.text)).toEqual(["new constraint"]);
  expect(evictOldestOptional(value)).toBe(true); expect(value.records).toHaveLength(0);
  expect(evictOldestOptional(value)).toBe(false);
  expect(value.latestRequest?.text).toBe("continue");
});

test("incremental fact admission matches full serialization across escaping and counter digits", () => {
  // Independent cost oracle: serialize every complete trial and count the
  // actual fact lines, rather than deriving incremental costs or digit deltas.
  for (const carried of [0, 9, 99, Number.MAX_SAFE_INTEGER - 1]) {
    for (const focus of [null, "|".repeat(1500)]) {
      const input = source(); input.predecessor = document();
      input.predecessor.omitted = { inputRecords: 0, excerpts: 0, readFiles: carried, modifiedFiles: carried, commands: carried };
      input.records = [{ kind: "user", text: "|".repeat(2048), nativeUserText: true }];
      const observed = facts();
      observed.files.read = Array.from({ length: 12 }, (_, index) => ({ ...file(index), path: `read${index} 😀 | \\ ` + "x".repeat(index * 5) }));
      observed.files.modified = Array.from({ length: 12 }, (_, index) => ({ ...file(index + 20), path: `modified${index} | ` + "y".repeat(index * 8) }));
      observed.commands = Array.from({ length: 12 }, (_, index) => ({ identityDigest: "a".repeat(22), runner: "bash", command: `echo ${index} | 😀`, cwd: "x|y", status: "unknown" as const, result: "\n", shortened: false, origin: "current" as const }));
      observed.commands[11] = { ...observed.commands[11]!, runner: "|".repeat(128), command: "|".repeat(512), cwd: "|".repeat(512), result: "|".repeat(300) };
      const expected = buildSummary(input, facts(), { focus });
      const count = (category: "readFiles" | "modifiedFiles" | "commands", total: number, admitted: number) => {
        expected.omitted[category] = Math.min(Number.MAX_SAFE_INTEGER, carried + (total - admitted));
      };
      count("readFiles", 12, 0); count("modifiedFiles", 12, 0); count("commands", 12, 0);
      const limit = Math.max(8192, codePointLength(encodeSummary(expected)));
      for (let offset = 1; offset <= 12; offset++) {
        for (const [candidate, rows, max, counter] of [
          [observed.files.modified.at(-offset), expected.files.modified, 50, "modifiedFiles"],
          [observed.commands.at(-offset), expected.commands, 10, "commands"],
          [observed.files.read.at(-offset), expected.files.read, 50, "readFiles"],
        ] as const) {
          if (!candidate || rows.length >= max) continue;
          (rows as (typeof candidate)[]).unshift(candidate);
          count(counter, 12, rows.length);
          const trial = encodeSummary(expected);
          const factLines = trial.split("\n").filter(line => /^(read |modified |cmd )/.test(line));
          if (codePointLength(factLines.join("\n")) > 2048 || codePointLength(trial) > limit) {
            rows.shift(); count(counter, 12, rows.length);
          }
        }
      }
      const selected = buildSummary(input, observed, { focus });
      expect(selected).toEqual(expected);
      expect(selected.commands.some(row => row.command === "|".repeat(512))).toBe(false);
      expect(selected.commands.length).toBeGreaterThan(0);
      expect(selected.files.modified.at(-1)?.path).toBe(observed.files.modified.at(-1)?.path);
      expect(selected.files.read.at(-1)?.path).toBe(observed.files.read.at(-1)?.path);
      expect(decodeSummary(encodeSummary(selected))).toEqual(selected);
    }
  }
});
