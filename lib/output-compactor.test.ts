import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  compactText,
  countLines,
  createOutputCompactor,
  DEFAULT_OUTPUT_COMPACTOR_CONFIG,
  shouldCompact,
} from "./output-compactor.ts";

const tempDirs: string[] = [];

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dc-shrink-compactor-"));
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
});

describe("output compactor", () => {
  test("returns undefined for small text output", async () => {
    const root = await tempRoot();
    const compactor = createOutputCompactor({
      artifactRoot: () => root,
      config: { maxChars: 100, maxLines: 10 },
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
    expect(text.text).toContain("[dc-shrink] Compacted bash output.");
    expect(text.text).toContain("... omitted 4 lines ...");
    expect(text.text).toContain("Full output saved; read this path if needed:");

    const details = patch?.details as Record<string, any>;
    expect(details.existing).toBe(true);
    expect(details.dcShrinkOutputCompactor.compacted).toBe(true);
    expect(details.dcShrinkOutputCompactor.originalLines).toBe(8);

    const artifactPath = details.dcShrinkOutputCompactor.artifactPath as string;
    expect(await readFile(artifactPath, "utf8")).toBe(fullText);

    const index = await readFile(join(root, "index.jsonl"), "utf8");
    const rows = index.trim().split("\n").map((line) => JSON.parse(line));
    expect(rows).toHaveLength(1);
    expect(rows[0].toolName).toBe("bash");
    expect(rows[0].artifactPath).toBe(artifactPath);
  });

  test("uses the larger error preview budget for failed tools", async () => {
    const root = await tempRoot();
    const fullText = Array.from({ length: 8 }, (_, i) => `line-${i + 1}`).join("\n");
    const compactor = createOutputCompactor({
      artifactRoot: () => root,
      config: {
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
      config: { maxChars: 1 },
      writeText: async () => {
        throw new Error("disk full");
      },
    });
    const callCtx = ctx(root);
    const event = { toolName: "bash", content: [{ type: "text", text: "large" }] };

    await expect(compactor.onToolResult(event, callCtx)).resolves.toBeUndefined();
    await expect(compactor.onToolResult(event, callCtx)).resolves.toBeUndefined();

    expect(callCtx.notices).toEqual(["dc-shrink output compactor failed open: disk full"]);
  });
});
