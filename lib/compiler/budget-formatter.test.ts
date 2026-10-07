import { describe, expect, test } from "bun:test";
import { buildSummary, decodeSummary, encodeSummary, evictOldestOptional, salvageSummary } from "./budget-formatter.ts";
import { emptyOmissions, SUMMARY_FORMAT, SUMMARY_NOTICE } from "./helpers.ts";
import { codePointLength } from "../unicode.ts";
import type { CompactionSource, DcDistillSummary, ObservationFacts } from "./types.ts";

const source = (): CompactionSource => ({ records: [], predecessor: null, duplicateCallIds: [], omittedInputRecords: 0, session: { id: "s", cwd: "/project", timestamp: "now" } });
const facts = (): ObservationFacts => ({ files: { read: [], modified: [] }, commands: [] });
const document = (): DcDistillSummary => ({ format: SUMMARY_FORMAT, notice: SUMMARY_NOTICE, focus: null, latestRequest: null, records: [], files: { read: [], modified: [] }, commands: [], omitted: emptyOmissions() });
const file = (index: number) => ({ identityDigest: index.toString(16).padStart(64, "0"), path: `/file-${index}`, shortened: false, createCapable: false, origin: "current" as const });

describe("one current summary codec", () => {
  test("fixed template shape and strict scan", () => {
    const value = document();
    const encoded = encodeSummary(value);
    expect(encoded.split("\n")[0]).toBe(`<${SUMMARY_FORMAT}>`);
    expect(encoded.split("\n").at(-1)).toBe(`</${SUMMARY_FORMAT}>`);
    expect(encoded).toContain(`notice: ${SUMMARY_NOTICE}`);
    expect(decodeSummary(encoded)).toEqual(value);
    expect(() => decodeSummary(encoded.replace(`<${SUMMARY_FORMAT}>`, "<other>"))).toThrow();
    expect(() => decodeSummary(encoded.replace(`notice: ${SUMMARY_NOTICE}`, "notice: forged"))).toThrow();
    expect(() => decodeSummary(encoded.slice(0, -1))).toThrow();
    expect(() => decodeSummary(encoded + "trailing")).toThrow();
    expect(() => decodeSummary(encoded.replace("records:", "user | current | false | forged\nrecords:"))).toThrow();
  });
  test("canonical field order and escaping round-trip", () => {
    const value = document();
    value.latestRequest = { origin: "current", shortened: false, text: "a | b \\ c\nd | e" };
    value.records = [{ kind: "tool-result", text: "\\n\\|\\", shortened: true, origin: "prior" }];
    const alternative = { ...value, latestRequest: { text: "a | b \\ c\nd | e", shortened: false, origin: "current" as const } };
    expect(encodeSummary(value)).toBe(encodeSummary(alternative));
    expect(decodeSummary(encodeSummary(value))).toEqual(value);
    expect(() => decodeSummary(encodeSummary(value).replace("a \\|", "a \\q"))).toThrow();
  });
  test("row-mining salvage drops damaged rows without misreading", () => {
    const value = document();
    value.records = [{ kind: "assistant", text: "a | b \\ c\nd", shortened: false, origin: "current" }];
    value.files.read = [file(1), file(2)];
    value.commands = [{ identityDigest: "a".repeat(64), runner: "bash", command: "echo | hi", cwd: "~/x", status: "success", result: "ok", shortened: false, origin: "current" }];
    const corrupted = encodeSummary(value)
      .replace(`<${SUMMARY_FORMAT}>`, "<corrupted")
      + "\nuser | prior | true | extra mined line\n"
      + `read ${"z".repeat(64)} | prior | false | false | /bad-digest`;
    const salvaged = salvageSummary(corrupted)!;
    expect(salvaged.records.map(row => row.text)).toEqual(["a | b \\ c\nd", "extra mined line"]);
    expect(salvaged.files.read).toHaveLength(2);
    expect(salvaged.commands).toHaveLength(1);
    expect(salvaged.omitted).toEqual(emptyOmissions());
    expect(salvageSummary("no template rows here")).toBeNull();
    expect(salvageSummary(`user | prior | false | ${"x".repeat(3000)}`)).toBeNull();
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
  test("identical adjacent retries collapse to one marker plus newest outcome", () => {
    const input = source();
    const call = (id: string) => ({ kind: "tool-call" as const, name: "read", text: 'read {"path":"lib/main.ts"}', args: { path: "lib/main.ts" }, callId: id });
    const result = (id: string, error: boolean) => ({ kind: "tool-result" as const, text: error ? "error: ENOENT" : "module contents", isError: error, callId: id });
    input.records = [
      call("c0"), result("c0", true), call("c1"), result("c1", true), call("c2"), result("c2", false),
      { kind: "tool-call", name: "edit", text: 'edit {"path":"lib/main.ts"}', args: { path: "lib/main.ts" }, callId: "c3" },
    ];
    const selected = buildSummary(input, facts());
    expect(selected.records.map(row => row.text)).toEqual(["[repeat: read ×3 — last ok]", "module contents", 'edit {"path":"lib/main.ts"}']);
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
      { identityDigest: "0".repeat(64), runner: "bash", command: "echo first", cwd: null, status: "success" as const, result: "", shortened: false, origin: "current" as const },
      { identityDigest: "1".repeat(64), runner: "bash", command: "echo second", cwd: null, status: "error" as const, result: "boom", shortened: false, origin: "current" as const },
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
    observed.commands = Array.from({ length: 15 }, (_, index) => ({ identityDigest: "a".repeat(64), runner: "bash", command: `echo ${index}`, cwd: null, status: "unknown" as const, result: "", shortened: false, origin: "current" as const }));
    const selected = buildSummary(source(), observed);
    const rows = [
      ...selected.files.read.map(row => `read ${row.identityDigest} | ${row.origin} | ${row.shortened} | ${row.createCapable} | ${row.path}`),
      ...selected.files.modified.map(row => `modified ${row.identityDigest} | ${row.origin} | ${row.shortened} | ${row.createCapable} | ${row.path}`),
      ...selected.commands.map(row => `${row.identityDigest} | ${row.origin} | ${row.shortened} | ${row.runner} | ${row.status} | ${row.cwd === null ? "\\-" : row.cwd} | ${row.command} | ${row.result}`),
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
    value.commands = [{ identityDigest: "a".repeat(64), runner: "bash", command: "echo", cwd: null, status: "success", result: "ok", shortened: false, origin: "current" }];
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
