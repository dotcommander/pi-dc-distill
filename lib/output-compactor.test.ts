import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ExtensionRunner } from "./sdk.ts";
import { compileSessionJsonl } from "./local-compact.ts";
import { tmpdir } from "node:os";
import {
  compactText,
  countLines,
  createOutputCompactor,
  DEFAULT_OUTPUT_COMPACTOR_CONFIG,
  previewOutput,
  shouldCompact,
} from "./output-compactor.ts";

const tempDirs: string[] = [];

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dc-distill-compactor-"));
  tempDirs.push(dir);
  return dir;
}

function ctx(cwd: string) {
  const notices: string[] = [];
  return {
    cwd,
    hasUI: true,
    notices,
    ui: {
      notify(message: string) {
        notices.push(message);
      },
    },
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("output compactor helpers", () => {
  test("counts trailing-newline lines the same way tools display them", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("a\nb\n")).toBe(2);
  });

  test("detects over-limit output by line count or char count", () => {
    expect(shouldCompact("short", DEFAULT_OUTPUT_COMPACTOR_CONFIG)).toBe(false);
    expect(shouldCompact("x".repeat(DEFAULT_OUTPUT_COMPACTOR_CONFIG.maxChars + 1), DEFAULT_OUTPUT_COMPACTOR_CONFIG)).toBe(true);
    expect(shouldCompact(Array.from({ length: DEFAULT_OUTPUT_COMPACTOR_CONFIG.maxLines + 1 }, (_, i) => `l${i}`).join("\n"), DEFAULT_OUTPUT_COMPACTOR_CONFIG)).toBe(true);
  });

  test("keeps literal head and tail lines with an omission marker", () => {
    const result = compactText("1\n2\n3\n4\n5", {
      headLines: 2,
      tailLines: 1,
      maxChars: 100,
    });

    expect(result.text).toBe("1\n2\n\n... omitted 2 lines ...\n\n5");
    expect(result.originalLines).toBe(5);
  });

  test("caps line-based previews by character budget", () => {
    const result = compactText(
      Array.from({ length: 8 }, (_, i) => `${i}: ${"x".repeat(40)}`).join("\n"),
      {
        headLines: 3,
        tailLines: 3,
        maxChars: 80,
      },
    );

    expect(Array.from(result.text).length).toBeLessThanOrEqual(80);
    expect(result.text).toContain("preview characters");
  });

  test("classifies deterministic fixture previews and preserves strategy evidence", () => {
    const policy = { headLines: 12, tailLines: 8, maxChars: 800 };
    const fixtures = [
      { strategy: "generic", text: Array.from({ length: 30 }, (_, i) => `plain-${i}`).join("\n"), anchors: ["plain-0", "plain-29"] },
      { strategy: "diagnostic", text: `build start\nError TS2345 at lib/parser.ts:42:7\nexpected string\n${"context\n".repeat(30)}final failure`, anchors: ["TS2345", "lib/parser.ts:42:7", "final failure"] },
      { strategy: "test", text: `bun test\nFAIL parser rejects cycles\nexpected true\n${"passing case\n".repeat(30)}12 pass\n1 fail\n2 skip`, anchors: ["FAIL parser rejects cycles", "12 pass", "1 fail", "2 skip"] },
      { strategy: "diff", text: `diff --git a/lib/a.ts b/lib/a.ts\n--- a/lib/a.ts\n+++ b/lib/a.ts\n@@ -1,2 +1,2 @@\n-old literal\n+new literal\n${" context\n".repeat(30)}`, anchors: ["diff --git", "@@ -1,2 +1,2 @@", "+new literal"] },
      { strategy: "json", text: JSON.stringify({ objective: "repair parser", tasks: Array.from({ length: 30 }, (_, i) => ({ id: `T${i}`, blocker: i === 4 ? "cycle" : "" })) }), anchors: ["objective", "repair parser", "tasks", "count"] },
      { strategy: "search", text: Array.from({ length: 20 }, (_, i) => `lib/parser.ts:${i + 1}:literal-${i}`).join("\n"), anchors: ["lib/parser.ts:1:literal-0", "omitted", "lib/parser.ts"] },
    ] as const;

    for (const fixture of fixtures) {
      const first = previewOutput(fixture.text, policy);
      const second = previewOutput(fixture.text, policy);
      expect(first).toEqual(second);
      expect(first.previewStrategy).toBe(fixture.strategy);
      expect(Array.from(first.text).length).toBeLessThanOrEqual(policy.maxChars);
      for (const anchor of fixture.anchors) expect(first.text).toContain(anchor);
    }
  });

  test("prioritizes late error-bearing fields in bounded JSON previews", () => {
    const value = Object.fromEntries([
      ...Array.from({ length: 40 }, (_, index) => [`ordinary-${index}`, `value-${index}`]),
      ["errorMessage", "late parser failure TS9999 at lib/parser.ts:88"],
    ]);

    const result = previewOutput(JSON.stringify(value), { headLines: 20, tailLines: 10, maxChars: 2_000 });
    expect(result.previewStrategy).toBe("json");
    expect(result.text).toContain("errorMessage");
    expect(result.text).toContain("late parser failure TS9999 at lib/parser.ts:88");
  });
});

function compilePreview(output: string) {
  return compileSessionJsonl([
    { type: "session", cwd: "/tmp/project" },
    { type: "message", message: { role: "user", content: "Verify parser" } },
    { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "verify", name: "bash", arguments: { command: "bun test parser.test.ts" } }] } },
    { type: "message", message: { role: "toolResult", toolCallId: "verify", toolName: "bash", isError: false, content: [{ type: "text", text: output }] } },
  ].map((entry) => JSON.stringify(entry)).join("\n")).summary;
}

describe("decisive preview evidence", () => {
  test("retains final FAIL and outcome totals after 300 PASS lines through offline extraction", () => {
    const source = ["bun test", ...Array.from({ length: 300 }, (_, i) => `PASS parser ${i}`), "FAIL parser rejects cycles", "300 passed, 1 failed, 0 skipped"].join("\n");
    const policy = { headLines: 4, tailLines: 2, maxLines: 8, maxChars: 220 };
    const result = previewOutput(source, policy);
    expect(result.text).toContain("FAIL parser rejects cycles");
    expect(result.text).toContain("300 passed, 1 failed, 0 skipped");
    expect(result.previewChars).toBeLessThanOrEqual(policy.maxChars);
    expect(result.previewLines).toBeLessThanOrEqual(policy.maxLines);
    expect(compilePreview(result.text)).toContain("FAIL [bash cwd=/tmp/project]: bun test parser.test.ts");
  });

  test("reserves terminal causes despite saturated long diagnostic matches", () => {
    const source = [...Array.from({ length: 300 }, (_, i) => `src/parser.ts:${i + 1}: warning ${"context ".repeat(80)}`), "Error: parser rejected circular input", "caused by reference to root node"].join("\n");
    const policy = { headLines: 4, tailLines: 2, maxLines: 8, maxChars: 200 };
    const result = previewOutput(source, policy, true);
    expect(result.text).toContain("Error: parser rejected circular input");
    expect(result.text).toContain("caused by reference to root node");
    expect(result.previewChars).toBeLessThanOrEqual(policy.maxChars);
    expect(result.previewLines).toBeLessThanOrEqual(policy.maxLines);
    expect(result.text).toContain("omitted 300 lines");
  });

  test("reserves a diagnostic tail after saturated search matches", () => {
    const source = [...Array.from({ length: 300 }, (_, i) => `src/file-${i}.ts:1:match`), "terminal diagnostic: missing parser fixture", "exit=2"].join("\n");
    const result = previewOutput(source, { headLines: 4, tailLines: 2, maxLines: 8, maxChars: 200 });
    expect(result.text).toContain("terminal diagnostic: missing parser fixture");
    expect(result.text).toContain("exit=2");
    expect(compilePreview(result.text)).toContain("FAIL [bash cwd=/tmp/project]: bun test parser.test.ts");
  });
});

// Exercise the real development SDK merge contract without a session/provider.
function runnerHarness(handler: (event: any, context: any) => unknown, context: any) {
  return {
    extensions: [{ path: "dc-distill", handlers: new Map([["tool_result", [handler]]]) }],
    createContext: () => context,
    emitError: (error: unknown) => { throw error; },
  };
}

describe("output compactor", () => {
  test("is off by default without inspecting text or touching storage", async () => {
    const root = await tempRoot();
    const existing = join(root, "existing.txt");
    await writeFile(existing, "preserved");
    let storageCalls = 0;
    const compactor = createOutputCompactor({
      artifactRoot: () => { storageCalls++; return root; },
      writeText: async () => { storageCalls++; },
      appendIndex: async () => { storageCalls++; },
    });
    const event = {
      get content(): never { throw new Error("disabled results must not be inspected"); },
    };
    const callCtx = ctx(root);
    expect(DEFAULT_OUTPUT_COMPACTOR_CONFIG.enabled).toBe(false);
    expect(await compactor.onToolResult(event, callCtx)).toBeUndefined();
    expect(storageCalls).toBe(0);
    expect(callCtx.notices).toEqual([]);
    expect(await readdir(root)).toEqual(["existing.txt"]);
    expect(await readFile(existing, "utf8")).toBe("preserved");
  });

  test("checks the session gate on each result and preserves output when disabled", async () => {
    const root = await tempRoot();
    let enabled = false;
    let gateCalls = 0;
    const callCtx = ctx(root);
    const compactor = createOutputCompactor({
      config: { enabled: true, maxChars: 5 },
      artifactRoot: () => root,
      isEnabled: (currentCtx) => {
        expect(currentCtx).toBe(callCtx);
        gateCalls++;
        return enabled;
      },
    });
    const image = { type: "image", data: "preserved-image" };
    const fullText = "complete Unicode output 🐈";
    const event = {
      toolName: "bash",
      toolCallId: "gate-test",
      content: [image, { type: "text", text: fullText }],
      details: { existing: "preserved-detail" },
    };
    expect(await compactor.onToolResult(event, callCtx)).toBeUndefined();
    expect(await readdir(root)).toEqual([]);
    expect(event.content).toEqual([image, { type: "text", text: fullText }]);
    expect(callCtx.notices).toEqual([]);

    enabled = true;
    const patch = await compactor.onToolResult(event, callCtx);
    expect(gateCalls).toBe(2);
    expect(patch?.content?.[0]).toEqual(image);
    const details = patch?.details as Record<string, any>;
    expect(details.existing).toBe("preserved-detail");
    const receipt = details.dcDistillOutputCompactor;
    expect(await readFile(receipt.artifactPath, "utf8")).toBe(fullText);
    expect(receipt.contentSha256).toBe(createHash("sha256").update(fullText, "utf8").digest("hex"));
    expect(receipt.bytes).toBe(Buffer.byteLength(fullText, "utf8"));
    const files = await readdir(root);
    enabled = false;
    expect(await compactor.onToolResult(event, callCtx)).toBeUndefined();
    expect(await readdir(root)).toEqual(files);
    expect(await readFile(receipt.artifactPath, "utf8")).toBe(fullText);
  });

  test("nested machine returns bypass content, gates, and storage even for an empty parent id", async () => {
    let calls = 0;
    const compactor = createOutputCompactor({
      config: { enabled: true, maxChars: 1 },
      isEnabled: () => { calls++; return true; },
      writeText: async () => { calls++; },
      appendIndex: async () => { calls++; },
    });
    for (const parentToolCallId of ["parent", ""]) {
      const event = { parentToolCallId, get content(): never { throw new Error("nested content inspected"); } };
      expect(await compactor.onToolResult(event, {})).toBeUndefined();
    }
    expect(calls).toBe(0);
    const content = [{ type: "text", text: "machine-facing output" }];
    const structuredContent = { literal: "unchanged", values: [1, 2] };
    const event = { type: "tool_result", toolName: "custom", toolCallId: "parent/0", parentToolCallId: "parent", input: {}, content, structuredContent, isError: false };
    const result = await ExtensionRunner.prototype.emitToolResult.call(runnerHarness(compactor.onToolResult, {}) as any, event as any);
    expect(result).toBeUndefined();
    expect(event.content).toBe(content);
    expect(event.structuredContent).toBe(structuredContent);
    expect(calls).toBe(0);
  });

  test("top-level preview preserves structured content through the SDK runner", async () => {
    const saved: string[] = [];
    const compactor = createOutputCompactor({
      config: { enabled: true, maxChars: 80, maxLines: 4 },
      artifactRoot: () => "/tmp/unused-artifacts",
      writeText: async (_path, text) => { saved.push(text); },
      appendIndex: async () => {},
    });
    const structuredContent = { records: [{ exact: "machine payload" }], count: 1 };
    const text = "complete output\n".repeat(100);
    const event = { type: "tool_result", toolName: "custom", toolCallId: "top", input: {}, content: [{ type: "text", text }], structuredContent, isError: false };
    const result = await ExtensionRunner.prototype.emitToolResult.call(runnerHarness(compactor.onToolResult, { cwd: "/tmp/project" }) as any, event as any);
    expect(result?.structuredContent).toBe(structuredContent);
    expect(result?.content).not.toEqual(event.content);
    expect(saved).toEqual([text]);
    expect(event.content[0].text).toBe(text);
  });

  test("returns undefined for small text output", async () => {
    const root = await tempRoot();
    const compactor = createOutputCompactor({
      artifactRoot: () => root,
      config: { enabled: true, maxChars: 100, maxLines: 10 },
    });

    const patch = await compactor.onToolResult(
      { toolName: "bash", content: [{ type: "text", text: "small" }] },
      ctx(root),
    );

    expect(patch).toBeUndefined();
  });

  test("compacts large text output and writes a recoverable artifact", async () => {
    const root = await tempRoot();
    const fullText = Array.from({ length: 8 }, (_, i) => `line-${i + 1}`).join("\n");
    const compactor = createOutputCompactor({
      artifactRoot: () => root,
      config: {
        enabled: true,
        maxLines: 5,
        headLines: 2,
        tailLines: 2,
      },
    });

    const patch = await compactor.onToolResult(
      {
        toolName: "bash",
        toolCallId: "call/1",
        input: { command: "printf lines" },
        content: [
          { type: "image", data: "kept" },
          { type: "text", text: fullText },
        ],
        details: { existing: true },
      },
      ctx(root),
    );

    const content = patch?.content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "image", data: "kept" });
    const text = content[1] as { type: "text"; text: string };
    expect(text.text).toContain("[dc-distill] Compacted bash output.");
    expect(text.text).toContain("... omitted 4 lines ...");
    expect(text.text).toContain("Full output saved; read this path if needed:");

    const details = patch?.details as Record<string, any>;
    expect(details.existing).toBe(true);
    expect(details.dcDistillOutputCompactor.compacted).toBe(true);
    expect(details.dcDistillOutputCompactor.originalLines).toBe(8);

    const artifactPath = details.dcDistillOutputCompactor.artifactPath as string;
    expect(await readFile(artifactPath, "utf8")).toBe(fullText);
    const digest = createHash("sha256").update(fullText, "utf8").digest("hex");
    expect(details.dcDistillOutputCompactor.contentSha256).toBe(digest);
    expect(details.dcDistillOutputCompactor.bytes).toBe(Buffer.byteLength(fullText, "utf8"));
    expect(details.dcDistillOutputCompactor.previewStrategy).toBe("generic");
    // Anchors parsed by extractOutputArtifactReceipt in lib/local-compact.ts must stay
    // line-exact so session compaction keeps recognizing artifact receipts.
    expect(text.text.startsWith("[dc-distill] Compacted bash output.")).toBe(true);
    expect(text.text.split("\n")).toContain(
      `Full output saved; read this path if needed: ${artifactPath}`,
    );
    expect(text.text.split("\n")).toContain(
      `Receipt: sha256=${digest} bytes=${Buffer.byteLength(fullText, "utf8")} strategy=generic`,
    );
    // Agent-directed guidance states the policy, the recovery path, and chunked reads.
    expect(text.text).toContain(
      `over ${DEFAULT_OUTPUT_COMPACTOR_CONFIG.maxChars} chars or 5 lines`,
    );
    expect(text.text).toContain("nothing was lost");
    expect(text.text).toContain("read it there when you need the rest");
    expect(text.text).toContain("chunked reads (offset/limit)");

    const index = await readFile(join(root, "index.jsonl"), "utf8");
    const rows = index.trim().split("\n").map((line) => JSON.parse(line));
    expect(rows).toHaveLength(1);
    expect(rows[0].toolName).toBe("bash");
    expect(rows[0].artifactPath).toBe(artifactPath);
    expect(rows[0].contentSha256).toBe(digest);
    expect(rows[0].bytes).toBe(Buffer.byteLength(fullText, "utf8"));
    expect(rows[0].previewStrategy).toBe("generic");
  });

  test("uses the larger error preview budget for failed tools", async () => {
    const root = await tempRoot();
    const fullText = Array.from({ length: 8 }, (_, i) => `line-${i + 1}`).join("\n");
    const compactor = createOutputCompactor({
      artifactRoot: () => root,
      config: {
        enabled: true,
        maxLines: 6,
        headLines: 1,
        tailLines: 1,
        errorHeadLines: 3,
        errorTailLines: 2,
      },
    });

    const patch = await compactor.onToolResult(
      { toolName: "bash", isError: true, content: [{ type: "text", text: fullText }] },
      ctx(root),
    );

    const content = patch?.content as Array<Record<string, unknown>>;
    const text = content[0] as { type: "text"; text: string };
    expect(text.text).toContain("line-1\nline-2\nline-3");
    expect(text.text).toContain("... omitted 3 lines ...");
    expect(text.text).toContain("line-7\nline-8");
  });

  test("fails open and warns once when artifact writing fails", async () => {
    const root = await tempRoot();
    const compactor = createOutputCompactor({
      artifactRoot: () => root,
      config: { enabled: true, maxChars: 1 },
      writeText: async () => {
        throw new Error("disk full");
      },
    });
    const callCtx = ctx(root);
    const event = { toolName: "bash", content: [{ type: "text", text: "large" }] };

    await expect(compactor.onToolResult(event, callCtx)).resolves.toBeUndefined();
    await expect(compactor.onToolResult(event, callCtx)).resolves.toBeUndefined();

    expect(callCtx.notices).toEqual(["dc-distill output compactor failed open: disk full"]);
  });
});

test("line counting preserves interior blanks, terminal LF, and CR semantics", () => {
  for (const text of ["", "\n", "\n\n", "a\n\nb", "a\n\n", "\r", "a\rb", "a\r\nb\r\n", "\n\r", "😀\né\n"]) {
    const expected = text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    expect(countLines(text)).toBe(expected);
  }
});

test("live tool-output index waits for the same destination lock as migration", async () => {
  const { Fs } = await import("./fs-support.ts");
  const root = await tempRoot();
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const holding = Fs.withLock(join(root,"index.jsonl.lock"),"migration",async () => {
    entered(); await new Promise<void>(resolve => { release=resolve; });
  });
  await ready;
  let written!: () => void;
  const artifactPublished = new Promise<void>(resolve => { written = resolve; });
  const compactor = createOutputCompactor({artifactRoot:()=>root,
    writeText:async (path,text)=>{await Fs.write(path,text);written();},
    config:{enabled:true,maxLines:2,headLines:1,tailLines:1}});
  const result = compactor.onToolResult({toolName:"bash",toolCallId:"locked-index",content:[{type:"text",text:"one\ntwo\nthree\nfour"}]},ctx(root));
  await artifactPublished;
  expect(await readdir(root)).not.toContain("index.jsonl");
  release(); await holding;
  expect(await result).toBeDefined();
  const rows=(await readFile(join(root,"index.jsonl"),"utf8")).trim().split("\n").map(line=>JSON.parse(line));
  expect(rows).toHaveLength(1);
  expect(rows[0].toolCallId).toBe("locked-index");
});

describe("Unicode preview budgets", () => {
  const points = (text: string) => Array.from(text).length;
  const validUnicode = (text: string) => {
    // Remove valid surrogate pairs; no surrogate may remain in valid input previews.
    expect(text.replace(/[\ud800-\udbff][\udc00-\udfff]/g, "")).not.toMatch(/[\ud800-\udfff]/);
  };

  test("thresholds and counters count code points", () => {
    const config = { ...DEFAULT_OUTPUT_COMPACTOR_CONFIG, maxChars: 4 };
    expect(shouldCompact("😀".repeat(4), config)).toBe(false);
    expect(shouldCompact("😀".repeat(5), config)).toBe(true);
    const preview = compactText("😀".repeat(4), { headLines: 1, tailLines: 0, maxChars: 4 });
    expect(preview).toMatchObject({ originalChars: 4, previewChars: 4, text: "😀".repeat(4) });
  });

  test("first-pass frames reserve digit transitions and report actual code-point omissions", () => {
    for (const size of [99, 100, 999, 1000]) {
      const source = "😀".repeat(size);
      for (const budget of [0, 1, 2, 32, 36, 37, 38, 39, 40, 80]) {
        const preview = compactText(source, { headLines: 1, tailLines: 0, maxChars: budget });
        expect(preview.originalChars).toBe(size);
        expect(preview.previewChars).toBe(points(preview.text));
        expect(points(preview.text)).toBeLessThanOrEqual(budget);
        validUnicode(preview.text);
        const match = /\n\n\.\.\. omitted (\d+) characters \.\.\.\n\n/.exec(preview.text);
        if (match) {
          const retained = preview.text.replace(match[0], "");
          expect(Number(match[1])).toBe(size - points(retained));
        } else expect(preview.text).toBe(budget > 0 ? "…" : "");
      }
    }
  });

  test("second-pass cuts keep line markers complete and truthful preview omissions", () => {
    const source = ["😀".repeat(12), ...Array.from({ length: 100 }, () => "middle"), "𝄞".repeat(90)].join("\n");
    const first = compactText(source, { headLines: 1, tailLines: 1, maxChars: 200 }).text;
    expect(first).toContain("... omitted 100 lines ...");
    for (const budget of [0, 1, 49, 50, 55, 65, 80, 100]) {
      const preview = compactText(source, { headLines: 1, tailLines: 1, maxChars: budget });
      expect(points(preview.text)).toBeLessThanOrEqual(budget);
      validUnicode(preview.text);
      const match = /\n\n\.\.\. omitted (\d+) preview characters \.\.\.\n\n/.exec(preview.text);
      if (!match) { expect(preview.text).toBe(budget > 0 ? "…" : ""); continue; }
      const retained = preview.text.replace(match[0], "");
      expect(Number(match[1])).toBe(points(first) - points(retained));
      for (const line of retained.split("\n")) {
        if (/omitted|\.\.\.|lines/.test(line)) expect(line).toBe("... omitted 100 lines ...");
      }
    }
  });

  test("zero tail allocations do not accidentally retain every line", () => {
    const preview = compactText("one\ntwo\nthree", { headLines: 1, tailLines: 0, maxChars: 100 });
    expect(preview.text).toContain("omitted 2 lines");
    expect(preview.text).not.toContain("two");
    expect(preview.text).not.toContain("three");
  });

  test("diagnostic UTF-16 offsets become code-point context windows", () => {
    const source = `${"😀".repeat(100)} FAIL: parser terminal failure ${"𝄞".repeat(200)}`;
    const preview = previewOutput(source, { headLines: 1, tailLines: 0, maxChars: 150 }, true);
    expect(preview.previewStrategy).toBe("diagnostic");
    expect(preview.text).toContain(`…${"😀".repeat(19)} FAIL: parser terminal failure`);
    expect(preview.previewChars).toBe(points(preview.text));
    expect(points(preview.text)).toBeLessThanOrEqual(150);
    validUnicode(preview.text);
    expect(() => compilePreview(preview.text)).not.toThrow();
  });

  test("selected line suffixes and tiny framing budgets remain bounded", () => {
    const source = ["diff --git a/a b/a", "--- a/a", "+++ b/a", "@@ -1 +1 @@", `+${"😀".repeat(80)}TAIL`].join("\n");
    const preview = previewOutput(source, { headLines: 1, tailLines: 0, maxChars: 60 });
    expect(preview.previewStrategy).toBe("diff");
    // First selected complete record fits; exercise suffix fallback with an oversized first record.
    const oversized = [`diff --git ${"😀".repeat(80)}TAIL`, `@@ -1 +1 @@ ${"😀".repeat(80)}`, `+${"😀".repeat(80)}`].join("\n");
    const suffix = previewOutput(oversized, { headLines: 1, tailLines: 0, maxChars: 60 });
    expect(suffix.text).toContain("TAIL");
    expect(points(suffix.text)).toBeLessThanOrEqual(60);
    validUnicode(suffix.text);
    for (const budget of [0, 1, 2]) {
      const tiny = previewOutput(oversized, { headLines: 1, tailLines: 0, maxChars: budget });
      expect(points(tiny.text)).toBeLessThanOrEqual(budget);
      validUnicode(tiny.text);
    }
  });

  test("JSON string excerpts retain complete code points at every depth", () => {
    const value = { top: "😀".repeat(300), a: { b: { message: "𝄞".repeat(200), c: { error: "😀".repeat(200) } } } };
    const preview = previewOutput(JSON.stringify(value), { headLines: 100, tailLines: 0, maxChars: 2000 });
    expect(preview.previewStrategy).toBe("json");
    const parsed = JSON.parse(preview.text);
    expect(parsed.preview.top).toBe("😀".repeat(256));
    expect(parsed.preview.a.b.message).toBe("𝄞".repeat(160));
    expect(parsed.preview.a.b.c.errorValues.error).toBe("😀".repeat(160));
    validUnicode(preview.text);
  });

  test("generated tool receipts keep artifact bytes and hashes while bounding input and preview", async () => {
    const source = "😀".repeat(300);
    let stored = "";
    let record: any;
    const compactor = createOutputCompactor({
      config: { enabled: true, maxChars: 80, headLines: 1, tailLines: 0 },
      artifactRoot: () => "/tmp/preview-artifacts",
      writeText: async (_path, text) => { stored = text; },
      appendIndex: async (_path, text) => { record = JSON.parse(text); },
    });
    const patch = await compactor.onToolResult({ toolName: "bash", toolCallId: "unicode-preview", input: { command: "😀".repeat(600) }, content: [{ type: "text", text: source }] }, { cwd: "/tmp/project", hasUI: false });
    expect(stored).toBe(source);
    expect(record.chars).toBe(300);
    expect(record.bytes).toBe(Buffer.byteLength(source, "utf8"));
    expect(record.contentSha256).toBe(createHash("sha256").update(source, "utf8").digest("hex"));
    const receipt = (patch?.details as any).dcDistillOutputCompactor;
    expect(receipt.originalChars).toBe(300);
    expect(receipt.previewChars).toBeLessThanOrEqual(80);
    if (!Array.isArray(patch?.content)) throw new Error("Expected generated preview content array");
    const wire = (patch.content.find((part: any) => part.type === "text") as { text: string }).text;
    const input = wire.split("\n").find((line) => line.startsWith("Input: "))!.slice(7);
    expect(points(input)).toBe(500);
    expect(input.endsWith("...")).toBe(true);
    validUnicode(wire);
    expect(() => compilePreview(wire)).not.toThrow();
  });
});
