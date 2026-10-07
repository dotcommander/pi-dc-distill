import { describe, expect, test } from "bun:test";
import { buildSummary, decodeSummary, encodeSummary, evictOldestOptional } from "./budget-formatter.ts";
import { emptyOmissions, SUMMARY_FORMAT, SUMMARY_NOTICE } from "./helpers.ts";
import { codePointLength } from "../unicode.ts";
import type { CompactionSource, DcDistillSummary, ObservationFacts } from "./types.ts";

const source = (): CompactionSource => ({ records: [], predecessor: null, duplicateCallIds: [], omittedInputRecords: 0, session: { id: "s", cwd: "/project", timestamp: "now" } });
const facts = (): ObservationFacts => ({ files: { read: [], modified: [] }, commands: [] });
const document = (): DcDistillSummary => ({ format: SUMMARY_FORMAT, notice: SUMMARY_NOTICE, focus: null, latestRequest: null, records: [], files: { read: [], modified: [] }, commands: [], omitted: emptyOmissions() });
const file = (index: number) => ({ identityDigest: index.toString(16).padStart(64, "0"), path: `/file-${index}`, shortened: false, createCapable: false, origin: "current" as const });

describe("one current summary codec", () => {
  test("fixed key bytes and strict current shape", () => {
    const value = document();
    expect(Object.keys(JSON.parse(encodeSummary(value)))).toEqual(["format", "notice", "focus", "latestRequest", "records", "files", "commands", "omitted"]);
    expect(decodeSummary(encodeSummary(value))).toEqual(value);
    expect(() => decodeSummary(JSON.stringify({ ...value, version: 1 }))).toThrow();
    expect(() => decodeSummary(JSON.stringify({ ...value, format: "other" }))).toThrow();
    expect(() => decodeSummary(JSON.stringify({ ...value, omitted: { ...value.omitted, commands: -1 } }))).toThrow();
    expect(() => decodeSummary('{"format":')).toThrow();
    expect(() => decodeSummary(JSON.stringify({ ...value, focus: "\ud800" }))).toThrow();
  });
  test("canonical nested key order", () => {
    const value = document();
    value.latestRequest = { origin: "current", shortened: false, text: "hello" };
    const alternative = { ...value, latestRequest: { text: "hello", shortened: false, origin: "current" as const } };
    expect(encodeSummary(value)).toBe(encodeSummary(alternative));
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
    expect(selected.omitted.excerpts).toBe(12);
    expect(decodeSummary(encodeSummary(selected))).toEqual(selected);
  });
  test("newest fitting excerpts survive; skipped rows count exactly once", () => {
    const input = source();
    input.records = [{ kind: "assistant", text: "old" }, { kind: "assistant", text: "\u0000".repeat(2048) }, { kind: "assistant", text: "new" }];
    input.omittedInputRecords = 4;
    const selected = buildSummary(input, facts());
    expect(selected.records.map(row => row.text)).toEqual(["old", "new"]);
    expect(selected.omitted).toEqual({ inputRecords: 4, excerpts: 1, readFiles: 0, modifiedFiles: 0, commands: 0 });
  });
  test("facts share a bounded serialized allowance and omission totals", () => {
    const observed = facts();
    observed.files.read = Array.from({ length: 70 }, (_, index) => file(index));
    observed.files.modified = Array.from({ length: 70 }, (_, index) => file(index + 100));
    observed.commands = Array.from({ length: 15 }, (_, index) => ({ identityDigest: "a".repeat(64), runner: "bash", command: `echo ${index}`, cwd: null, status: "unknown" as const, result: "", shortened: false, origin: "current" as const }));
    const selected = buildSummary(source(), observed);
    expect(codePointLength(JSON.stringify({ files: selected.files, commands: selected.commands }))).toBeLessThanOrEqual(2048);
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
    const input = source(); input.records = [{ kind: "user", nativeUserText: true, text: "\u0000".repeat(2048) }];
    const selected = buildSummary(input, facts(), { focus: "\u0000".repeat(2048) });
    expect(codePointLength(encodeSummary(selected))).toBeGreaterThan(8192);
    expect(codePointLength(encodeSummary(selected))).toBeLessThanOrEqual(65536);
    expect(selected.latestRequest?.text).toBe("\u0000".repeat(2048));
  });
});
