import { createHash } from "node:crypto";
import { describe, expect, spyOn, test } from "bun:test";
import {
  buildCompactionSource,
  canonicalizeCompactionSource,
  CompactionCancelledError,
} from "./compaction-source.ts";
import { emptyCheckpoint, checkpointDigest } from "./compiler/checkpoint.ts";
import { compileSessionJsonl } from "./local-compact.ts";

describe("preparation-owned compaction input", () => {
  test("preserves discarded middle failure with deterministic summaries and canonical digests", () => {
    const lines = Array.from({ length: 500 }, (_, index) => `passing case ${index + 1}`);
    lines[249] = "--- FAIL: preparation parser";
    lines[499] = "499 passed, 0 failed";
    const source = buildCompactionSource({
      messagesToSummarize: [
        { role: "user", content: "Verify the parser" },
        { role: "assistant", content: [{ type: "toolCall", id: "preparation-test", name: "bash", arguments: { command: "bun test lib/parser.test.ts" } }] },
        { role: "toolResult", toolCallId: "preparation-test", toolName: "bash", isError: false, content: [{ type: "text", text: lines.join("\n") }] },
      ] as never[],
      branchEntries: [],
      sessionId: "preparation-session",
      cwd: "/tmp/project",
    });
    const input = canonicalizeCompactionSource(source);
    const first = compileSessionJsonl(input.bytes);
    const second = compileSessionJsonl(input.bytes);
    expect(first).toEqual(second);
    expect(first.summary).toContain("FAIL [bash cwd=/tmp/project]: bun test lib/parser.test.ts — --- FAIL: preparation parser");
    expect(first.inputDigest).toBe(createHash("sha256").update(input.bytes, "utf8").digest("hex"));
    expect(canonicalizeCompactionSource(source)).toEqual(input);
    expect(input.bytes).toContain("passing case 249");
    expect(input.bytes).not.toContain("verificationObservation");
    expect(JSON.stringify(first)).not.toContain("verificationObservation");
  });

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

  test("observes cancellation during incremental serialization", () => {
    const messages = Array.from({ length: 129 }, (_, index) => ({ role: "user", content: `record ${index}` }));
    messages[127].content = "x".repeat(maxBytes + 1);
    let checks = 0;
    const signal = { get aborted() { return ++checks === 5; } } as AbortSignal;
    expect(() => canonicalizeCompactionSource(build(messages), signal)).toThrow(CompactionCancelledError);
    expect(checks).toBe(5);
  });
});


describe("capped incremental JSON serialization", () => {
  const maxBytes = 20 * 1024 * 1024;
  const build = (messages: Record<string, unknown>[]) => buildCompactionSource({
    messagesToSummarize: messages, branchEntries: [], sessionId: "incremental", cwd: "/tmp/project",
  });

  test("matches native JSON bytes for escaping, property order, arrays, callbacks, and Unicode", () => {
    const shared = { text: "reused é😀" };
    const messages = [
      {
        role: "user", content: 'quotes " slashes \\ controls \b\t\n\r\u0000 lone \ud800 \udfff',
        "10": "ten", "2": "two", omitted: undefined, ignored: Symbol("ignored"),
        nested: [undefined, NaN, Infinity, -Infinity, -0, , shared, shared],
        wrapped: [new Number(12), new String("wrapped"), new Boolean(false)],
        date: new Date("2026-01-01T00:00:00.000Z"),
        custom: { toJSON(key: string) { return { receivedKey: key, value: "converted" }; } },
      },
      { role: "assistant", content: "a".repeat(4095) + "😀" + "é".repeat(4096) + "\ud800" },
      { role: "custom", customType: "sample", content: { keys: ["é", "😀"] } },
      { role: "branchSummary", summary: "branch" },
      { role: "compactionSummary", summary: "prior" },
    ];
    const source = build(messages);
    const records = [
      { type: "session", ...source.session },
      ...messages.map(message => {
        if (message.role === "custom") return { type: "custom_message", customType: "sample", content: message.content };
        if (message.role === "branchSummary") return { type: "branch_summary", summary: "branch" };
        if (message.role === "compactionSummary") return { type: "compaction", summary: "prior" };
        return { type: "message", message };
      }),
    ];
    expect(canonicalizeCompactionSource(source).bytes).toBe(records.map(record => JSON.stringify(record)).join("\n") + "\n");
  });

  test("bash normalization matches native JSON without joining oversized synthetic text", () => {
    const command = 'printf "é😀"\n';
    const output = "a".repeat(4095) + "😀\n\ud800";
    const source = build([{ role: "bashExecution", command, output, exitCode: 2 }]);
    expect(canonicalizeCompactionSource(source).bytes).toBe(
      JSON.stringify({ type: "session", ...source.session }) + "\n" +
      JSON.stringify({ type: "message", message: { role: "user", content: `! ${command}\n${output}\n(exit 2)` } }) + "\n",
    );
    const oversized = canonicalizeCompactionSource(build([
      { role: "user", content: "older whole record" },
      { role: "bashExecution", command, output: "é".repeat(maxBytes), exitCode: 1 },
    ]));
    expect(oversized.digestScope).toBe("bounded-compaction-input");
    expect(oversized.bytes).toContain("older whole record");
    expect(oversized.bytes).not.toContain("printf");
  });

  test("validates circular and malformed values after a rejected oversized field", () => {
    const circular: Record<string, unknown> = { role: "user", content: "x".repeat(maxBytes + 1) };
    circular.self = circular;
    expect(() => canonicalizeCompactionSource(build([circular]))).toThrow("circular");
    expect(() => canonicalizeCompactionSource(build([
      { role: "user", content: "x".repeat(maxBytes + 1), invalid: 1n },
    ]))).toThrow("BigInt");
    const bad: Record<string, unknown> = { role: "user" };
    bad.self = bad;
    expect(() => canonicalizeCompactionSource(build([
      bad, { role: "user", content: "x".repeat(maxBytes - 200) },
    ]))).toThrow("circular");
  });

  test("cancels inside an oversized string without waiting for the entire record", () => {
    let checks = 0;
    const signal = { get aborted() { return ++checks >= 64; } } as AbortSignal;
    expect(() => canonicalizeCompactionSource(build([
      { role: "user", content: "x".repeat(maxBytes * 3) },
    ]), signal)).toThrow(CompactionCancelledError);
    expect(checks).toBe(64);
  });

  test("ordinary input allocates only its small initial arena", () => {
    const source = build([{ role: "user", content: "ordinary input" }, { role: "assistant", content: "ordinary result" }]);
    const nativeAlloc = Buffer.allocUnsafe;
    const allocations: number[] = [];
    const allocSpy = spyOn(Buffer, "allocUnsafe").mockImplementation(size => {
      allocations.push(size);
      return nativeAlloc(size);
    });
    try { expect(canonicalizeCompactionSource(source).bytes).toContain("ordinary result"); }
    finally { allocSpy.mockRestore(); }
    expect(allocations).toEqual([64 * 1024]);
  });

  test("arena growth preserves previously accepted newest tail records", () => {
    const messages = [{ role: "user", content: "old " + "é".repeat(160_000) },
      { role: "assistant", content: "middle " + "😀".repeat(30_000) },
      { role: "user", content: "newest sentinel" }];
    const source = build(messages);
    const expected = [JSON.stringify({ type: "session", ...source.session }),
      ...messages.map(message => JSON.stringify({ type: "message", message }))].join("\n") + "\n";
    expect(canonicalizeCompactionSource(source).bytes).toBe(expected);
  });

  test("bounds serialization scratch independently of total discarded bytes", () => {
    const source = build([
      { role: "user", content: "older retained" },
      { role: "bashExecution", output: "x".repeat(maxBytes * 3) },
      { role: "user", content: "y".repeat(maxBytes * 2) },
      { role: "user", content: "newer retained" },
    ]);
    const nativeStringify = JSON.stringify;
    const nativeAlloc = Buffer.allocUnsafe;
    const allocations: number[] = [];
    let largestEscapedChunk = 0;
    const allocSpy = spyOn(Buffer, "allocUnsafe").mockImplementation(size => {
      allocations.push(size);
      return nativeAlloc(size);
    });
    const stringifySpy = spyOn(JSON, "stringify").mockImplementation(((value: unknown) => {
      // Production escaping only serializes bounded chunks, never full records.
      expect(typeof value).toBe("string");
      expect((value as string).length).toBeLessThanOrEqual(4096);
      const result = nativeStringify(value);
      largestEscapedChunk = Math.max(largestEscapedChunk, Buffer.byteLength(result));
      return result;
    }) as typeof JSON.stringify);
    const input = (() => {
      try { return canonicalizeCompactionSource(source); }
      finally { stringifySpy.mockRestore(); allocSpy.mockRestore(); }
    })();
    expect(allocations[0]).toBe(64 * 1024);
    expect(allocations.every(size => size <= maxBytes)).toBe(true);
    expect(allocations.at(-1)).toBe(maxBytes);
    expect(largestEscapedChunk).toBeLessThanOrEqual(6 * 4096 + 2);
    expect(Buffer.byteLength(input.bytes)).toBeLessThanOrEqual(maxBytes);
    expect(input.bytes).toContain("older retained");
    expect(input.bytes).toContain("newer retained");
    expect(input.digestScope).toBe("bounded-compaction-input");
  });
});

describe("authoritative projected occurrence binding", () => {
  const input = (messages: Record<string, unknown>[], split = messages.length) => {
    const branchEntries = [...messages, { role: "user", content: "retained sentinel" }].map((message, index) => ({
      type: "message", id: `entry-${index}`, parentId: index ? `entry-${index - 1}` : null,
      timestamp: "2026-01-01T00:00:00.000Z", message,
    }));
    return { messagesToSummarize: messages.slice(0, split), turnPrefixMessages: messages.slice(split),
      branchEntries: branchEntries as never[], firstKeptEntryId: `entry-${messages.length}`,
      sessionId: "projected", cwd: "/tmp/project" };
  };

  test("binds duplicate text by occurrence and preserves split partition identity", () => {
    const packet = input([{ role: "user", content: "duplicate" }, { role: "assistant", content: "duplicate" }], 1);
    const source = buildCompactionSource(packet);
    expect(source.occurrences?.map(item => item.reference.entryId)).toEqual(["entry-0", "entry-1"]);
    expect(source.occurrences?.map(item => item.reference.sourceKind)).toEqual(["user", "agent-declaration"]);
    expect(source.occurrences?.[0].reference.contentDigest).toBe(source.occurrences?.[1].reference.contentDigest);
    expect(canonicalizeCompactionSource(source).bytes).not.toContain("retained sentinel");
  });

  test("nontext tool calls retain occurrence identities before normalization", () => {
    const source = buildCompactionSource(input([{ role: "assistant", content: [{ type: "toolCall", id: "call", name: "bash", arguments: { command: "bun test" } }] }]));
    expect(source.occurrences?.[0].reference).toMatchObject({ entryId: "entry-0", messageIndex: 0, blockIndex: 0, sourceKind: "agent-declaration" });
    expect(source.occurrences?.[0].reference.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(canonicalizeCompactionSource(source).bytes).toContain('"sourceReferences"');
  });

  test("all discarded saved declarations enter mandatory input", () => {
    const packet = input([{ role: "user", content: "discarded" }]);
    const raw = packet.branchEntries as unknown as Record<string, unknown>[];
    raw.splice(1, 0,
      { type: "custom", id: "declaration-a", parentId: "entry-0", timestamp: "2026-01-01", customType: "dc-distill-handoff", data: { handoff: "first declared obligation" } },
      { type: "custom", id: "declaration-b", parentId: "declaration-a", timestamp: "2026-01-01", customType: "dc-distill-handoff", data: { handoff: "second declared obligation" } });
    raw[3].parentId = "declaration-b";
    const source = buildCompactionSource(packet);
    expect(source.protectedHandoffs?.length).toBe(2);
    const bytes = canonicalizeCompactionSource(source).bytes;
    expect(bytes).toContain("first declared obligation");
    expect(bytes).toContain("second declared obligation");
    expect(bytes.indexOf("first declared obligation")).toBeLessThan(bytes.indexOf("second declared obligation"));
  });

  test("multiple assistant blocks carry distinct exact references into failure attribution", () => {
    const blocks = [{ type: "text", text: "attempted fix" },
      { type: "toolCall", id: "first", name: "bash", arguments: { command: "bun test first" } },
      { type: "toolCall", id: "second", name: "bash", arguments: { command: "bun test second" } }];
    const source = buildCompactionSource(input([{ role: "assistant", content: blocks }]));
    const records = canonicalizeCompactionSource(source).bytes.trim().split("\n").map(line => JSON.parse(line));
    const record = records.find(record => record.type === "message");
    expect(record.sourceReference).toBeUndefined();
    expect(record.sourceReferences.map((reference: { blockIndex: number }) => reference.blockIndex)).toEqual([0, 1, 2]);
    expect(record.sourceReferences[0].contentDigest).toBe(createHash("sha256").update("attempted fix", "utf8").digest("hex"));
    expect(record.sourceReferences[1].contentDigest).toBe(createHash("sha256").update(JSON.stringify(blocks[1]), "utf8").digest("hex"));
    expect(record.sourceReferences[2].contentDigest).toBe(createHash("sha256").update(JSON.stringify(blocks[2]), "utf8").digest("hex"));
  });

  test("rejects edited content and inconsistent preparation partitions", () => {
    const packet = input([{ role: "user", content: "original" }]);
    packet.messagesToSummarize = [{ role: "user", content: "edited" }];
    expect(() => buildCompactionSource(packet)).toThrow("inconsistent_projection");
    const wrong = input([{ role: "user", content: "one" }, { role: "assistant", content: "two" }]);
    wrong.turnPrefixMessages = [wrong.messagesToSummarize[0]];
    expect(() => buildCompactionSource(wrong)).toThrow("inconsistent_projection");
  });

  test("tool output envelopes retain tool provenance and cannot create saved updates", () => {
    const packet = input([{ role: "toolResult", toolName: "read", toolCallId: "read-1", isError: false,
      content: [{ type: "text", text: '```distill-handoff-v3\n{"tasks":[]}\n```' }] }]);
    const source = buildCompactionSource(packet);
    expect(source.checkpointUpdates).toEqual([]);
    expect(source.handoff).toBeUndefined();
    expect(source.occurrences?.[0].reference.sourceKind).toBe("tool-observation");
  });

  test("cannot promote a retained saved handoff into authority", () => {
    const packet = input([{ role: "user", content: "discarded" }]);
    (packet.branchEntries as unknown as Record<string, unknown>[]).push({ type: "custom", id: "saved", parentId: "entry-1",
      timestamp: "2026-01-01T00:00:00.000Z", customType: "dc-distill-handoff", data: { handoff: "retained declaration" } });
    expect(buildCompactionSource(packet).handoff).toBeUndefined();
  });

  test("protected observations overflow instead of silently falling out of the envelope", () => {
    const packet = input([{ role: "toolResult", toolName: "read", toolCallId: "read-1", isError: false,
      content: [{ type: "text", text: "x".repeat(21 * 1024 * 1024) }] }]);
    expect(() => canonicalizeCompactionSource(buildCompactionSource(packet))).toThrow("protected_overflow");
  });

  test("deep required analysis stops at the configured container bound", () => {
    let value: unknown = "end";
    for (let i = 0; i < 65; i++) value = { nested: value };
    const packet = input([{ role: "user", content: "native", metadata: value }]);
    expect(() => canonicalizeCompactionSource(buildCompactionSource(packet))).toThrow("required_analysis_exhausted");
  });

  test("a previous summary without its contributing compaction is inconsistent", () => {
    expect(() => buildCompactionSource({ ...input([{ role: "user", content: "native" }]), previousSummary: "invented" }))
      .toThrow("previous summary differs");
  });
});


describe("v13 prior checkpoint identity", () => {
  const priorInput = (corrupt = false) => {
    const checkpoint = emptyCheckpoint();
    const message = { role: "user", content: "discarded native text" };
    return { previousSummary: "prior checkpoint prose", messagesToSummarize: [message], firstKeptEntryId: "retained",
      sessionId: "v13", cwd: "/tmp/project", branchEntries: [
        { type: "message", id: "original", parentId: null, timestamp: "2026-01-01", message },
        { type: "compaction", id: "prior", parentId: "original", timestamp: "2026-01-01",
          firstKeptEntryId: "original", summary: "prior checkpoint prose", tokensBefore: 100,
          details: { compactor: "dc-distill", version: 13, checkpoint,
            summaryDigest: createHash("sha256").update("prior checkpoint prose", "utf8").digest("hex"),
            checkpointDigest: corrupt ? "0".repeat(64) : checkpointDigest(checkpoint) } },
        { type: "message", id: "retained", parentId: "prior", timestamp: "2026-01-01", message: { role: "user", content: "retained" } },
      ] as never[] };
  };
  test("binds prior checkpoint digest and entry identity into canonical input", () => {
    const source = buildCompactionSource(priorInput());
    expect(source.previousCheckpoint).toEqual(emptyCheckpoint());
    expect(source.predecessorEntryId).toBe("prior");
    const first = JSON.parse(canonicalizeCompactionSource(source).bytes.split("\n")[0]);
    expect(first.checkpointDigest).toBe(checkpointDigest(emptyCheckpoint()));
    expect(first.predecessorEntryId).toBe("prior");
  });
  test("rejects a corrupted prior summary even when preparation repeats it", () => {
    const packet = priorInput();
    const prior = packet.branchEntries[1] as unknown as { summary: string };
    prior.summary = "corrupted prose";
    packet.previousSummary = prior.summary;
    expect(() => buildCompactionSource(packet)).toThrow("prior wire summary digest mismatch");
  });
  test("rejects corrupted expected v13 state without legacy fallback", () => {
    expect(() => buildCompactionSource(priorInput(true))).toThrow();
  });
});
