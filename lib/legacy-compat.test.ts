import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDistillData } from "./data-migration.ts";
import { buildCompactionSource } from "./compaction-source.ts";
import { parseStructuredDistillHandoff, parseStructuredDistillHandoffV2 } from "./handoff.ts";
import { recoverContinuation } from "./continuation-recovery.ts";
import { compileSessionJsonl } from "./local-compact.ts";
import { dumpsEnabled } from "./settings.ts";
import { compactionCardSpec } from "./compaction-card.ts";
import { LEGACY_DATA_NAMESPACE, LEGACY_MIGRATION_FLAG } from "./legacy.ts";

const oldV1 = '```shrink-handoff-v1\n{"objective":"Preserve historical state","done":[],"next":["Verify rename"],"blocker":[],"decision":[],"verification-needed":[]}\n```';
const oldV2 = '```shrink-handoff-v2\n{"objective":"Preserve historical graph","invariants":[],"decisions":[],"rejected-hypotheses":[],"tasks":[],"verification-needed":[]}\n```';

describe("historical rename compatibility", () => {
  test("reads old handoff entry types and both old structured fences", () => {
    expect(parseStructuredDistillHandoff(oldV1)?.objective).toBe("Preserve historical state");
    expect(parseStructuredDistillHandoffV2(oldV2)?.objective).toBe("Preserve historical graph");
    const source = buildCompactionSource({
      sessionId: "historical", cwd: "/project", branchEntries: [
        { type: "custom", customType: "dc-shrink-handoff", data: { handoff: oldV1 } } as never,
      ],
    });
    expect(source.handoff).toBe(oldV1);
    const compiled = compileSessionJsonl([
      JSON.stringify({ type: "session", id: "historical", cwd: "/project" }),
      JSON.stringify({ type: "custom", customType: "dc-shrink-handoff", data: { handoff: oldV1 } }),
    ].join("\n"));
    expect(compiled.summary).toContain("Preserve historical state");
  });

  test("recovers historical autonomous continuations without redelivering answered attempts", () => {
    const compact = { type: "compaction", details: { compactor: "dc-shrink", autonomous: true, version: 8, attemptId: "old-1" } };
    const delivery = { type: "custom_message", customType: "dc-shrink-continuation", details: { attemptId: "old-1" } };
    expect(recoverContinuation([compact])).toEqual({ phase: "committed", action: "deliver", attemptId: "old-1" });
    expect(recoverContinuation([compact, delivery])).toEqual({ phase: "delivered", action: "resume", attemptId: "old-1" });
    expect(recoverContinuation([compact, delivery, { type: "message", message: { role: "assistant" } }]).action).toBe("none");
  });


  test("renders old custom-card details and retains old output artifact receipts", () => {
    expect(JSON.stringify(compactionCardSpec({ content: "historical summary", details: { compactor: "dc-shrink", version: 8 } }, true))).toContain("dc-distill v8");
    const digest = "a".repeat(64);
    const receipt = ["[dc-shrink] Compacted bash output.",
      "Full output saved; read this path if needed: /historical/artifact.txt",
      `Receipt: sha256=${digest} bytes=10000 strategy=diagnostic`].join("\n");
    const compiled = compileSessionJsonl([
      JSON.stringify({ type: "session", id: "old-output", cwd: "/project" }),
      JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "Keep the artifact receipt" }] } }),
      JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "large-output" } }] } }),
      JSON.stringify({ type: "message", message: { role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: receipt }], isError: false } }),
    ].join("\n"));
    expect(compiled.summary).toContain(`artifact: /historical/artifact.txt sha256=${digest}`);
  });

  test("legacy dump opt-in works but the new environment variable takes precedence", () => {
    expect(dumpsEnabled({ DC_SHRINK_DUMPS: "1" })).toBe(true);
    expect(dumpsEnabled({ DC_SHRINK_DUMPS: "1", DC_DISTILL_DUMPS: "0" })).toBe(false);
    expect(dumpsEnabled({ DC_DISTILL_DUMPS: "1" })).toBe(true);
  });

  test("copies prior project recall and artifacts, preserves sources, and does not repeat migration", () => {
    const root = mkdtempSync(join(tmpdir(), "dc-distill-rename-"));
    const priorDir = join(root, LEGACY_DATA_NAMESPACE);
    const currentDir = join(root, "dc-distill");
    const relative = join("projects", "project-12345678");
    mkdirSync(join(priorDir, relative, "tool-output"), { recursive: true });
    mkdirSync(join(currentDir, relative), { recursive: true });
    const old = { ts: "2026-01-01", before: 10, after: 2, summary: "old", project: "/project" };
    const current = { ...old, ts: "2026-02-01", summary: "new" };
    writeFileSync(join(priorDir, relative, "recall.json"), JSON.stringify([old]));
    writeFileSync(join(currentDir, relative, "recall.json"), JSON.stringify([current]));
    writeFileSync(join(priorDir, relative, "tool-output", "old.txt"), "Full original output");
    writeFileSync(join(priorDir, ".migrated-from-legacy-shrink"), "{}");
    writeFileSync(join(priorDir, "settings.json"), "{}");
    const options = { legacyDir: join(root, "absent"), priorDir, currentDir };
    const first = migrateDistillData(options);
    expect(first.status).toBe("migrated");
    expect(JSON.parse(readFileSync(join(currentDir, relative, "recall.json"), "utf8")).map((x: { summary: string }) => x.summary)).toEqual(["old", "new"]);
    expect(readFileSync(join(currentDir, relative, "tool-output", "old.txt"), "utf8")).toBe("Full original output");
    expect(readFileSync(join(priorDir, relative, "tool-output", "old.txt"), "utf8")).toBe("Full original output");
    expect(existsSync(join(currentDir, "settings.json"))).toBe(false);
    expect(existsSync(join(currentDir, ".migrated-from-legacy-shrink"))).toBe(false);
    expect(existsSync(join(currentDir, LEGACY_MIGRATION_FLAG))).toBe(true);
    expect(migrateDistillData(options).status).toBe("skipped");
  });

  test("failed prior-namespace migration remains retryable and preserves conflicting data", () => {
    const root = mkdtempSync(join(tmpdir(), "dc-distill-conflict-"));
    const priorDir = join(root, LEGACY_DATA_NAMESPACE);
    const currentDir = join(root, "dc-distill");
    mkdirSync(priorDir); mkdirSync(currentDir);
    writeFileSync(join(priorDir, "recall.json"), "malformed");
    writeFileSync(join(currentDir, "recall.json"), "[]");
    writeFileSync(join(priorDir, "note.txt"), "historical");
    writeFileSync(join(currentDir, "note.txt"), "current");
    const options = { legacyDir: join(root, "absent"), priorDir, currentDir };
    expect(migrateDistillData(options).status).toBe("failed");
    expect(existsSync(join(currentDir, LEGACY_MIGRATION_FLAG))).toBe(false);
    expect(readFileSync(join(currentDir, "note.txt"), "utf8")).toBe("current");
    expect(readFileSync(join(currentDir, ".legacy-migration-conflicts", LEGACY_DATA_NAMESPACE, "note.txt"), "utf8")).toBe("historical");
    writeFileSync(join(priorDir, "recall.json"), "[]");
    expect(migrateDistillData(options).status).toBe("migrated");
  });
});
