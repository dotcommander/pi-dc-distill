// Tests for dc-distill/lib/strategy.ts
// Run: bun test extensions/dc-app/lib/knowledge/features/distill/lib/strategy.test.ts

import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runStrategies } from "./strategy.ts";

async function writeSession(lines: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dc-distill-"));
  const file = join(dir, "session.jsonl");
  await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return file;
}

describe("runStrategies", () => {
  test("returns algorithmic summary and extracted file lists", async () => {
    const sessionFile = await writeSession([
      {
        type: "session",
        id: "s1",
        cwd: "/tmp/project",
        timestamp: "2026-06-01T00:00:00.000Z",
      },
      { type: "model_change", provider: "openai", modelId: "gpt-test" },
      {
        type: "message",
        message: {
          role: "user",
          content: "Keep working on recall TASK-88. Read extensions/dc-distill/index.ts",
          timestamp: 1,
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              name: "Read",
              arguments: { path: "extensions/dc-distill/index.ts" },
            },
            {
              type: "toolCall",
              name: "Edit",
              arguments: { path: "extensions/dc-distill/lib/recall.ts" },
            },
            {
              type: "toolCall",
              name: "Bash",
              arguments: { command: "bun test extensions/dc-distill" },
            },
          ],
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "Read",
          content: "source",
          isError: false,
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "Edit",
          content: "updated",
          isError: false,
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "Bash",
          content: "PASS dc-distill tests",
          isError: false,
        },
      },
    ]);

    const result = await runStrategies(
      { userFocus: "Keep working on recall.", sessionFile },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.summary).toContain("## User Focus\nKeep working on recall.");
    expect(result.summary).toContain("## Session");
    expect(result.summary).toContain("## Conversation");
    expect(result.readFiles).toEqual(["extensions/dc-distill/index.ts"]);
    expect(result.modifiedFiles).toEqual(["extensions/dc-distill/lib/recall.ts"]);
    expect(result.summary).toContain("<verification>\nPASS [Bash cwd=/tmp/project]: bun test extensions/dc-distill");
    expect(result.literalAnchors).toContain("TASK-88");
    expect(result.inputDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.summaryDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.digestScope).toBe("compaction-input");
  });

  test("returns stable digest fields and changes them at the right boundary", async () => {
    const baseLines = [
      {
        type: "session",
        id: "s1",
        cwd: "/tmp/project",
        timestamp: "2026-06-01T00:00:00.000Z",
      },
      {
        type: "message",
        message: {
          role: "user",
          content: "Track TASK-44 and port=5432.",
        },
      },
    ];
    const sessionFile = await writeSession(baseLines);
    const sameA = await runStrategies({ userFocus: "focus A", sessionFile });
    const sameB = await runStrategies({ userFocus: "focus A", sessionFile });
    if (!sameA.ok || !sameB.ok) throw new Error("expected ok results");

    expect(sameA.inputDigest).toBe(sameB.inputDigest);
    expect(sameA.summaryDigest).toBe(sameB.summaryDigest);

    const differentFocus = await runStrategies({ userFocus: "focus B", sessionFile });
    if (!differentFocus.ok) throw new Error("expected ok result");
    expect(differentFocus.inputDigest).toBe(sameA.inputDigest);
    expect(differentFocus.summaryDigest).not.toBe(sameA.summaryDigest);

    const changedSession = await writeSession([
      ...baseLines,
      {
        type: "message",
        message: {
          role: "assistant",
          content: "Changed summary content with decision ABC-9.",
        },
      },
    ]);
    const changed = await runStrategies({ userFocus: "focus A", sessionFile: changedSession });
    if (!changed.ok) throw new Error("expected ok result");
    expect(changed.inputDigest).not.toBe(sameA.inputDigest);
    expect(changed.summaryDigest).not.toBe(sameA.summaryDigest);
  });

  test("returns failure reason when session file is unavailable", async () => {
    const result = await runStrategies(
      { sessionFile: "/tmp/does-not-exist/dc-distill-session.jsonl" },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.cancelled).toBe(false);
    expect(result.reasons.join("\n")).toContain("no such file");
  });

  test("classifies an aborted signal as cancellation, not failure", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runStrategies(
      { userFocus: "focus", sessionFile: "/tmp/unused-session.jsonl" },
      controller.signal,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.cancelled).toBe(true);
    expect(result.reasons.join("\n")).toContain("algorithmic: compaction cancelled");
  });
});
