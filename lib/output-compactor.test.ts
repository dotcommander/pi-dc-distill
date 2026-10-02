import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
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

    expect(result.text.length).toBeLessThan(160);
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
      expect(first.text.length).toBeLessThanOrEqual(policy.maxChars + 100);
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
        maxLines: 5,
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
