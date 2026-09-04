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
