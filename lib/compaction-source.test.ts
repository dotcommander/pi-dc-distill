import { describe, expect, test } from "bun:test";
import { buildCompactionSource, type CompactionSourceInput } from "./compaction-source.ts";
import { digest, MAX_INPUT_BYTES, SUMMARY_FORMAT, SUMMARY_NOTICE } from "./compiler/helpers.ts";
import type { DcDistillSummary } from "./compiler/types.ts";
import { extractObservations } from "./compiler/tool-tracker.ts";

type Message = Record<string, unknown>;
function packet(messages: Message[], split = messages.length): CompactionSourceInput {
  const entries = [...messages, { role: "user", content: "RETAINED" }].map((message, index) => ({
    type: "message", id: `entry-${index}`, parentId: index ? `entry-${index - 1}` : null,
    timestamp: "2026-01-01T00:00:00.000Z", message,
  }));
  return { messagesToSummarize: messages.slice(0, split), turnPrefixMessages: messages.slice(split),
    firstKeptEntryId: `entry-${messages.length}`, branchEntries: entries as never[], sessionId: "source", cwd: "/tmp/project" };
}
function document(): DcDistillSummary {
  return { format: SUMMARY_FORMAT, notice: SUMMARY_NOTICE, focus: null, latestRequest: null,
    records: [{ kind: "assistant", text: "prior observation", shortened: false, origin: "current" }],
    files: { read: [], modified: [] }, commands: [],
    omitted: { inputRecords: 0, excerpts: 0, readFiles: 0, modifiedFiles: 0, commands: 0 } };
}
function withPrior(summary: string, details?: Record<string, unknown>): CompactionSourceInput {
  const input = packet([{ role: "user", content: "discarded" }]);
  const entries = input.branchEntries as unknown as Record<string, unknown>[];
  entries[0].parentId = "prior";
  entries.unshift({ type: "compaction", id: "prior", parentId: null, timestamp: "2026-01-01",
    summary, firstKeptEntryId: "prior", tokensBefore: 1000, details });
  return { ...input, previousSummary: summary };
}

describe("preparation-owned typed input", () => {
  test("keeps exact split partitions and excludes retained and abandoned text", () => {
    const input = packet([{ role: "user", content: "duplicate" }, { role: "assistant", content: "duplicate" }], 1);
    const entries = input.branchEntries as unknown as Record<string, unknown>[];
    entries.splice(0, 0, { type: "message", id: "abandoned", parentId: null, timestamp: "2026-01-01", message: { role: "user", content: "ABANDONED" } });
    const source = buildCompactionSource(input);
    expect(source.records.map(record => record.text)).toEqual(["duplicate", "duplicate"]);
    expect(JSON.stringify(source)).not.toContain("RETAINED");
    expect(JSON.stringify(source)).not.toContain("ABANDONED");
  });
  test("rejects mismatching preparation, duplicate IDs, missing cut and predecessor disagreement", () => {
    const mismatch = packet([{ role: "user", content: "original" }]);
    mismatch.messagesToSummarize = [{ role: "user", content: "different" }];
    expect(() => buildCompactionSource(mismatch)).toThrow("inconsistent_projection");
    const duplicate = packet([{ role: "user", content: "original" }]);
    duplicate.branchEntries[1].id = duplicate.branchEntries[0].id;
    expect(() => buildCompactionSource(duplicate)).toThrow("duplicate");
    expect(() => buildCompactionSource({ ...packet([]), firstKeptEntryId: "missing" })).toThrow("discarded boundary");
    expect(() => buildCompactionSource({ ...withPrior("prior"), previousSummary: "other" })).toThrow("previous summary");
  });
  test("uses effective context edits while excluding raw discarded text", () => {
    const input = packet([{ role: "user", content: "original" }]);
    const entries = input.branchEntries as unknown as Record<string, unknown>[];
    entries.push({ type: "context_edit", id: "edit", parentId: "entry-1", timestamp: "2026-01-01",
      targetId: "entry-0", replacement: { content: "replacement" } });
    input.messagesToSummarize = [{ role: "user", content: "replacement" }];
    expect(buildCompactionSource(input).records[0].text).toBe("replacement");
  });
  test("preserves custom, branch and native summary records without deriving authority", () => {
    const messages = [{ role: "custom", content: "custom" }, { role: "branchSummary", summary: "branch" },
      { role: "compactionSummary", summary: "native" }];
    expect(buildCompactionSource(packet(messages)).records.map(record => record.kind)).toEqual(["custom", "branch-summary", "native-summary"]);
  });
  test("only current authenticated owned predecessor shape is admitted", () => {
    const summary = JSON.stringify(document());
    expect(buildCompactionSource(withPrior(summary, { compactor: "dc-distill", summaryDigest: digest(summary) })).predecessor).toEqual(document());
    expect(() => buildCompactionSource(withPrior(summary, { compactor: "dc-distill", summaryDigest: "0".repeat(64) }))).toThrow("unauthenticated");
    expect(() => buildCompactionSource(withPrior(summary, { compactor: "dc-distill", version: 15, summaryDigest: digest(summary) }))).toThrow("incompatible");
    const incompatible = JSON.stringify({ ...document(), version: 1 });
    expect(() => buildCompactionSource(withPrior(incompatible, { compactor: "dc-distill", summaryDigest: digest(incompatible) }))).toThrow("shape");
  });
  test("native and foreign summaries remain attributed text", () => {
    const native = buildCompactionSource(withPrior("native prose"));
    expect(native.predecessor).toBeNull();
    expect(native.records[0]).toEqual({ kind: "native-summary", text: "native prose" });
    expect(buildCompactionSource(withPrior("foreign prose", { compactor: "other" })).records[0].text).toBe("foreign prose");
  });
  test("refuses active old handoffs including retained entries", () => {
    for (const customType of ["dc-distill-handoff", "dc-shrink-handoff"]) {
      const input = packet([{ role: "user", content: "discarded" }]);
      (input.branchEntries as unknown as Record<string, unknown>[]).push({ type: "custom", id: "handoff", parentId: "entry-1",
        timestamp: "2026-01-01", customType, data: { handoff: "legacy" } });
      expect(() => buildCompactionSource(input)).toThrow("active legacy handoff");
    }
  });
  test("superseded incompatible state and handoffs outside projection do not block", () => {
    const input = withPrior("native predecessor");
    const entries = input.branchEntries as unknown as Record<string, unknown>[];
    entries[0].parentId = "old-handoff";
    entries.unshift({ type: "compaction", id: "old", parentId: null, timestamp: "2026-01-01", summary: "old summary",
      firstKeptEntryId: "old", tokensBefore: 1, details: { compactor: "dc-distill", version: 15 } },
      { type: "custom", id: "old-handoff", parentId: "old", timestamp: "2026-01-01", customType: "dc-distill-handoff" });
    expect(buildCompactionSource(input).records[0].text).toBe("native predecessor");
  });
  test("observes cancellation and the message-count guard", () => {
    const controller = new AbortController(); controller.abort();
    expect(() => buildCompactionSource({ ...packet([]), signal: controller.signal })).toThrow("cancelled");
    const input = packet([]); input.messagesToSummarize = Array.from({ length: 50001 }, () => ({ role: "user", content: "x" }));
    expect(() => buildCompactionSource(input)).toThrow("record limit");
  });
});

describe("20 MiB whole-message envelope", () => {
  const idlessCall = (name: string, args: Record<string, unknown>): Message => ({ role: "assistant", content: [{ type: "toolCall", name, arguments: args }] });
  const idlessResult = (name: string, content = "success"): Message => ({ role: "toolResult", toolName: name, isError: false, content });
  for (const name of ["read", "shell"]) {
    test(`oversized omitted ID-less ${name} call cannot make an ambiguous pair valid`, () => {
      const args = name === "read" ? { path: "file" } : { command: "echo success" };
      const source = buildCompactionSource(packet([
        idlessCall(name, { ...args, extra: "x".repeat(21 * 1024 * 1024) }),
        idlessCall(name, args), idlessResult(name),
      ]));
      expect(source.records.map(record => record.idlessPairingKey)).toEqual([null, null]);
      expect(source.omittedInputRecords).toBe(1);
      expect(Buffer.byteLength(JSON.stringify(source))).toBeLessThanOrEqual(MAX_INPUT_BYTES);
      const facts = extractObservations(source);
      expect(facts.files.read).toEqual([]);
      expect(facts.commands).toEqual([]);
    });
  }
  test("omitting an earlier successful result never redirects a later result", () => {
    const source = buildCompactionSource(packet([
      idlessCall("read", { path: "first" }), idlessResult("read", "x".repeat(21 * 1024 * 1024)),
      idlessResult("read"), idlessCall("read", { path: "second" }), idlessResult("read"),
    ]));
    expect(source.records.map(record => record.idlessPairingKey)).toEqual([0, null, 1, 1]);
    expect(extractObservations(source).files.read.map(row => row.path)).toEqual(["second"]);
    expect(source.omittedInputRecords).toBe(1);
    expect(Buffer.byteLength(JSON.stringify(source))).toBeLessThanOrEqual(MAX_INPUT_BYTES);
  });
  test("omitting a unique paired call preserves later sequential pairing", () => {
    const source = buildCompactionSource(packet([
      idlessCall("read", { path: "first", extra: "x".repeat(21 * 1024 * 1024) }), idlessResult("read"),
      idlessCall("read", { path: "second" }), idlessResult("read"),
    ]));
    expect(source.records.map(record => record.idlessPairingKey)).toEqual([0, 1, 1]);
    expect(extractObservations(source).files.read.map(row => row.path)).toEqual(["second"]);
    expect(source.omittedInputRecords).toBe(1);
    expect(Buffer.byteLength(JSON.stringify(source))).toBeLessThanOrEqual(MAX_INPUT_BYTES);
  });
  test("keeps newest fitting complete records and skips one oversized newest record", () => {
    const input = withPrior("mandatory native prior");
    const source = buildCompactionSource(packet([{ role: "user", content: "older complete" },
      { role: "user", content: "x".repeat(21 * 1024 * 1024) }]));
    expect(source.records.map(record => record.text)).toEqual(["older complete"]);
    expect(source.omittedInputRecords).toBe(1);
    expect(Buffer.byteLength(JSON.stringify(source))).toBeLessThanOrEqual(MAX_INPUT_BYTES);
    expect(buildCompactionSource(input).records[0].text).toBe("mandatory native prior");
  });
  test("admits the exact byte boundary including multibyte characters", () => {
    const empty = buildCompactionSource(packet([{ role: "user", content: "" }]));
    // nativeUserText changes from false to true, freeing one serialized byte.
    const available = MAX_INPUT_BYTES - Buffer.byteLength(JSON.stringify(empty)) + 1;
    const text = "é".repeat(Math.floor(available / 2)) + "x".repeat(available % 2);
    const exact = buildCompactionSource(packet([{ role: "user", content: text }]));
    expect(Buffer.byteLength(JSON.stringify(exact))).toBe(MAX_INPUT_BYTES);
    expect(exact.omittedInputRecords).toBe(0);
    const overflow = buildCompactionSource(packet([{ role: "user", content: `${text}x` }]));
    expect(overflow.records).toEqual([]);
    expect(overflow.omittedInputRecords).toBe(1);
  });
  test("validates malformed Unicode, cycles and accessors in records that would be omitted", () => {
    const malformed = { role: "user", content: `${"x".repeat(21 * 1024 * 1024)}\ud800` };
    expect(() => buildCompactionSource(packet([malformed]))).toThrow("Unicode");
    const cyclic: Message = { role: "user", content: "x" }; cyclic.self = cyclic;
    expect(() => buildCompactionSource(packet([cyclic]))).toThrow("cyclic");
    const accessor: Message = { role: "user", content: "x" }; Object.defineProperty(accessor, "extra", { get() { throw new Error("executed getter"); }, enumerable: true });
    expect(() => buildCompactionSource(packet([accessor]))).toThrow("accessor");
  });
  test("captures duplicate call and result IDs before oversized record removal", () => {
    const source = buildCompactionSource(packet([
      { role: "assistant", content: [{ type: "toolCall", id: "same", name: "read", arguments: { path: "file", extra: "x".repeat(21 * 1024 * 1024) } }] },
      { role: "assistant", content: [{ type: "toolCall", id: "same", name: "read", arguments: { path: "file" } }] },
      { role: "toolResult", toolName: "read", toolCallId: "same", isError: false, content: "output" },
    ]));
    expect(source.duplicateCallIds).toEqual(["same"]);
    expect(source.records.filter(record => record.kind === "tool-call")).toHaveLength(1);
    expect(source.omittedInputRecords).toBe(1);
  });
  test("never splits an assistant message to admit just one of its blocks", () => {
    const source = buildCompactionSource(packet([{ role: "assistant", content: [
      { type: "text", text: "small" }, { type: "text", text: "x".repeat(21 * 1024 * 1024) },
    ] }]));
    expect(source.records).toEqual([]);
    expect(source.omittedInputRecords).toBe(2);
  });
  test("mandatory predecessor cannot fall out of the envelope", () => {
    expect(() => buildCompactionSource(withPrior("x".repeat(21 * 1024 * 1024)))).toThrow("mandatory metadata");
  });
});
