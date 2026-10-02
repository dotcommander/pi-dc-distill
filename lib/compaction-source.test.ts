import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  buildCompactionSource,
  canonicalizeCompactionSource,
  CompactionCancelledError,
} from "./compaction-source.ts";
import { compileSessionJsonl } from "./local-compact.ts";

describe("preparation-owned compaction input", () => {
  test("serializes discarded and split-prefix messages without retained or abandoned branches", () => {
    const source = buildCompactionSource({
      previousSummary: "PREVIOUS",
      messagesToSummarize: [{ role: "user", content: "DISCARDED" }],
      turnPrefixMessages: [{ role: "assistant", content: [{ type: "text", text: "PREFIX" }] }],
      branchEntries: [
        { type: "custom", customType: "dc-distill-handoff", data: { handoff: "ACTIVE HANDOFF" } },
        { type: "message", message: { role: "user", content: "RETAINED" } },
      ] as never[],
      sessionId: "session-1",
      cwd: "/tmp/project",
    });
    const input = canonicalizeCompactionSource(source);
    expect(input.bytes).toContain("PREVIOUS");
    expect(input.bytes).toContain("DISCARDED");
    expect(input.bytes).toContain("PREFIX");
    expect(input.bytes).toContain("ACTIVE HANDOFF");
    expect(input.bytes).not.toContain("RETAINED");
    expect(input.bytes).not.toContain("ABANDONED");

    const compiled = compileSessionJsonl(input.bytes);
    expect(compiled.summary).toContain("ACTIVE HANDOFF");
    expect(compiled.inputDigest).toBe(
      createHash("sha256").update(input.bytes, "utf8").digest("hex"),
    );
  });

  test("permits a previous-summary-only preparation", () => {
    const input = canonicalizeCompactionSource(buildCompactionSource({
      previousSummary: "Prior compacted context with useful state.",
      branchEntries: [],
      sessionId: "session-1",
      cwd: "/tmp/project",
    }));
    const result = compileSessionJsonl(input.bytes);
    expect(result.usefulRecordCount).toBe(1);
    expect(result.summary).toContain("Prior compacted context with useful state.");
  });

  test("preserves direct branch and compaction summary messages", () => {
    const input = canonicalizeCompactionSource(buildCompactionSource({
      messagesToSummarize: [
        { role: "branchSummary", summary: "BRANCH-SUMMARY-SENTINEL" },
        { role: "compactionSummary", summary: "COMPACTION-SUMMARY-SENTINEL" },
      ],
      branchEntries: [],
      sessionId: "session-1",
      cwd: "/tmp/project",
    }));
    const result = compileSessionJsonl(input.bytes);
    expect(result.summary).toContain("BRANCH-SUMMARY-SENTINEL");
    expect(result.summary).toContain("COMPACTION-SUMMARY-SENTINEL");
  });

  test("observes cancellation between compiler batches", async () => {
    let checks = 0;
    const signal = {
      get aborted() { return ++checks >= 3; },
    } as AbortSignal;
    const lines = Array.from({ length: 300 }, (_, index) => JSON.stringify({
      type: "message",
      message: { role: "user", content: `record ${index}` },
    })).join("\n");
    const result = await (await import("./strategy.ts")).runStrategies({
      canonicalInput: lines,
      digestScope: "compaction-input",
    }, signal);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected cancellation");
    expect(result.cancelled).toBe(true);
  });

  test("skips one oversized newest record and retains older whole records", () => {
    const input = canonicalizeCompactionSource(buildCompactionSource({
      previousSummary: "PRIOR-SENTINEL",
      messagesToSummarize: [
        { role: "user", content: "OLDER-DISCARDED-SENTINEL" },
        { role: "user", content: "x".repeat(21 * 1024 * 1024) },
      ],
      branchEntries: [],
      sessionId: "session-1",
      cwd: "/tmp/project",
    }));
    expect(input.digestScope).toBe("bounded-compaction-input");
    expect(input.bytes).toContain("PRIOR-SENTINEL");
    expect(input.bytes).toContain("OLDER-DISCARDED-SENTINEL");
    expect(input.bytes).not.toContain("x".repeat(1024));
  });

  test("cancellation is distinct", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => canonicalizeCompactionSource(buildCompactionSource({
      branchEntries: [],
      sessionId: "session-1",
      cwd: "/tmp/project",
    }), controller.signal)).toThrow(CompactionCancelledError);
  });
});

describe("whole-record UTF-8 envelope boundaries", () => {
  const maxBytes = 20 * 1024 * 1024;
  const build = (messages: Record<string, unknown>[]) => buildCompactionSource({
    previousSummary: "Prior é😀 state", messagesToSummarize: messages,
    branchEntries: [], sessionId: "boundary", cwd: "/tmp/é😀",
  });

  test("includes an exact-boundary multibyte record and skips it when one byte larger", () => {
    const empty = canonicalizeCompactionSource(build([{ role: "user", content: "" }]));
    const available = maxBytes - Buffer.byteLength(empty.bytes);
    const payload = "é".repeat(Math.floor(available / 2)) + "x".repeat(available % 2);
    const exact = canonicalizeCompactionSource(build([{ role: "user", content: payload }]));
    expect(Buffer.byteLength(exact.bytes)).toBe(maxBytes);
    expect(exact.digestScope).toBe("compaction-input");
    expect(exact.recordCount).toBe(2);
    const over = canonicalizeCompactionSource(build([{ role: "user", content: payload + "x" }]));
    expect(over.digestScope).toBe("bounded-compaction-input");
    expect(over.recordCount).toBe(1);
    expect(over.bytes).toBe(canonicalizeCompactionSource(build([])).bytes);
  });

  test("retains chronological order while skipping non-fitting newest and middle records", () => {
    const source = build([
      { role: "user", content: "OLDER 😀" },
      { role: "assistant", content: "x".repeat(maxBytes + 1) },
      { role: "user", content: "NEWER é" },
      { role: "assistant", content: "y".repeat(maxBytes + 1) },
    ]);
    const actual = canonicalizeCompactionSource(source);
    const expected = canonicalizeCompactionSource(build([source.messagesToSummarize[0], source.messagesToSummarize[2]]));
    expect(actual.bytes).toBe(expected.bytes);
    expect(actual.recordCount).toBe(expected.recordCount);
    expect(actual.digestScope).toBe("bounded-compaction-input");
  });

  test("required metadata overflow rejects rather than dropping the previous summary", () => {
    const source = build([]);
    source.previousSummary = "é".repeat(maxBytes / 2);
    expect(() => canonicalizeCompactionSource(source)).toThrow("required compaction metadata exceeds");
  });

  test("retains the reverse-scan accepted-record cancellation checkpoint", () => {
    const messages = Array.from({ length: 129 }, (_, index) => ({ role: "user", content: `record ${index}` }));
    messages[127].content = "x".repeat(maxBytes + 1);
    let checks = 0;
    const signal = { get aborted() { return ++checks === 5; } } as AbortSignal;
    expect(() => canonicalizeCompactionSource(build(messages), signal)).toThrow(CompactionCancelledError);
    expect(checks).toBe(5);
  });
});
