import { expect, test } from "bun:test";
import { compileCompactionSource, decodeSummary } from "./local-compact.ts";
import type { CompactionSource } from "./compiler/types.ts";

function source(): CompactionSource {
  return { records: [{ kind: "user", text: "Please inspect", nativeUserText: true }], predecessor: null, duplicateCallIds: [], omittedInputRecords: 0, session: { id: "s", cwd: "/project", timestamp: "now" } };
}
test("typed compile returns exact current wire document deterministically", () => {
  const input = source();
  const first = compileCompactionSource(input);
  expect(first.summary).toBe(compileCompactionSource(input).summary);
  expect(decodeSummary(first.summary)).toEqual(first.document);
  expect(first.document.latestRequest?.text).toBe("Please inspect");
  expect(first.document.records).toHaveLength(0);
});
test("compiler refuses cancellation and malformed Unicode before extraction", () => {
  const controller = new AbortController(); controller.abort();
  expect(() => compileCompactionSource(source(), { signal: controller.signal })).toThrow();
  const malformed = source(); malformed.records[0]!.text = "\ud800";
  expect(() => compileCompactionSource(malformed)).toThrow();
  expect(() => compileCompactionSource(source(), { focus: "\udfff" })).toThrow();
});
test("facts are extracted from full input before excerpt shortening", () => {
  const input = source();
  input.records.push(
    { kind: "tool-call", text: "display", name: "read", callId: "call", args: { path: `/long/${"x".repeat(700)}` } },
    { kind: "tool-result", text: "ok", name: "read", callId: "call", isError: false },
  );
  const result = compileCompactionSource(input);
  expect(result.document.files.read).toHaveLength(1);
  expect(result.document.files.read[0]!.path.length).toBe(512);
  expect(result.document.files.read[0]!.shortened).toBe(true);
  expect(result.document.files.read[0]!.identityDigest).toMatch(/^[a-f0-9]{64}$/);
});
test("prior displays cannot produce fresh observations", () => {
  const input = source();
  const previous = compileCompactionSource(input).document;
  previous.records.push({ kind: "tool-call", text: '{"name":"read","path":"/invented"}', shortened: false, origin: "current" });
  const next = source(); next.records = []; next.predecessor = previous;
  const result = compileCompactionSource(next);
  expect(result.document.files.read).toHaveLength(0);
  expect(result.document.records[0]!.origin).toBe("prior");
});
test("new native requests replace prior request context without reordering carried excerpts", () => {
  const input = source();
  input.records.push({ kind: "assistant", text: "Response to prior request" });
  const prior = compileCompactionSource(input).document;
  prior.omitted.excerpts = 4;
  const next = source();
  next.predecessor = prior;
  next.records = [{ kind: "user", text: "Next request", nativeUserText: true }, { kind: "assistant", text: "Next response" }];
  const result = compileCompactionSource(next);
  expect(result.document.latestRequest?.text).toBe("Next request");
  expect(result.document.records.map(row => [row.kind, row.text, row.origin])).toEqual([
    ["assistant", "Response to prior request", "prior"],
    ["assistant", "Next response", "current"],
  ]);
  expect(result.document.omitted.excerpts).toBe(4);
});
