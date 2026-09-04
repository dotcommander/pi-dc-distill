// Tests for dc-distill/lib/log.ts — logCompaction, logFailure, dumpCompaction
// Run: bun test extensions/dc-app/lib/knowledge/features/distill/lib/log.test.ts

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logCompaction, logFailure, dumpCompaction } from "./log.ts";
import type { CompactEvent } from "./types.ts";

let baseDir = "";
let logPath = "";
let dumpsDir = "";

// Unique prefix for test files to avoid colliding with production data
const TEST_PREFIX = `test-${Date.now()}`;

describe("log", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "dc-distill-log-test-"));
    logPath = join(baseDir, "compact-log.jsonl");
    dumpsDir = join(baseDir, "compact-dumps");
    process.env.DC_DISTILL_DATA_DIR = baseDir;
  });

  afterEach(() => {
    delete process.env.DC_DISTILL_DATA_DIR;
    try { rmSync(baseDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  // ── logCompaction ─────────────────────────────────────────────────────

  test("logCompaction appends a JSON line to compact-log.jsonl", () => {
    // Snapshot the log size before
    const before = existsSync(logPath) ? readFileSync(logPath, "utf-8").split("\n").length : 0;

    const event: CompactEvent = {
      ts: `${TEST_PREFIX}-compaction`,
      tier: 1,
      before: 100000,
      after: 2000,
      removed: 98000,
      toolTokens: 40000,
      idleS: 60,
      exchanges: 5,
      sessionCalls: 30,
    };

    logCompaction(event);

    const after = readFileSync(logPath, "utf-8").split("\n").length;
    expect(after).toBeGreaterThan(before);

    // The last non-empty line should be our event
    const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.ts).toBe(`${TEST_PREFIX}-compaction`);
    expect(last.tier).toBe(1);
    expect(last.before).toBe(100000);
  });

  test("logCompaction persists optional fields when provided", () => {
    const event: CompactEvent = {
      ts: `${TEST_PREFIX}-optional`,
      tier: 1,
      before: 80000,
      after: 1500,
      removed: 78500,
      toolTokens: 20000,
      idleS: 120,
      exchanges: 10,
      sessionCalls: 50,
      apiTokensBefore: 75000,
      summaryHead: "User asked about...",
      summaryLen: 6000,
      strategy: "algorithmic",
      sessionFile: "/path/to/session.jsonl",
    };

    logCompaction(event);

    const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.apiTokensBefore).toBe(75000);
    expect(last.strategy).toBe("algorithmic");
    expect(last.summaryHead).toBe("User asked about...");
  });

  // ── logFailure ────────────────────────────────────────────────────────

  test("logFailure appends a failure entry to compact-log.jsonl", () => {
    const before = existsSync(logPath) ? readFileSync(logPath, "utf-8").split("\n").length : 0;

    logFailure([`${TEST_PREFIX}-fail-reason`, "timeout"]);

    const after = readFileSync(logPath, "utf-8").split("\n").length;
    expect(after).toBeGreaterThan(before);

    const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.kind).toBe("failure");
    expect(last.reasons).toContain(`${TEST_PREFIX}-fail-reason`);
    expect(last.reasons).toContain("timeout");
  });

  // ── dumpCompaction ───────────────────────────────────────────────────

  test("dumpCompaction writes before.jsonl and after.txt", () => {
    const ts = `2026-05-14T01:23:45.678Z`;
    const slug = "20260514-012345";
    const beforeMessages = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ];
    const afterSummary = "User said hello, assistant replied world.";

    dumpCompaction(ts, beforeMessages, afterSummary);

    const beforePath = join(dumpsDir, `${slug}-before.jsonl`);
    const afterPath = join(dumpsDir, `${slug}-after.txt`);

    expect(existsSync(beforePath)).toBe(true);
    expect(existsSync(afterPath)).toBe(true);

    const beforeContent = readFileSync(beforePath, "utf-8");
    const beforeLines = beforeContent.split("\n").filter(Boolean);
    expect(beforeLines).toHaveLength(2);
    // Each line is valid JSON
    for (const line of beforeLines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    const afterContent = readFileSync(afterPath, "utf-8");
    expect(afterContent).toBe(afterSummary);
  });

  test("dumpCompaction handles un-JSON-ifiable messages gracefully", () => {
    const ts = `2026-05-14T02:00:00.000Z`;
    const slug = "20260514-020000";
    // Create a circular reference that makes JSON.stringify throw
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const beforeMessages = [
      { role: "user", content: "ok" },
      { role: "assistant", circular }, // JSON.stringify throws on circular refs
    ];
    const afterSummary = "Short summary.";

    // Should not throw
    expect(() => dumpCompaction(ts, beforeMessages, afterSummary)).not.toThrow();

    const beforePath = join(dumpsDir, `${slug}-before.jsonl`);
    expect(existsSync(beforePath)).toBe(true);

    // The circular-ref message should be filtered out (JSON.stringify throws → null)
    const beforeLines = readFileSync(beforePath, "utf-8").split("\n").filter(Boolean);
    expect(beforeLines.length).toBe(1);

    const afterPath = join(dumpsDir, `${slug}-after.txt`);
    expect(readFileSync(afterPath, "utf-8")).toBe(afterSummary);
  });

  // ── tsSlug (tested indirectly via dumpCompaction filenames) ────────────

  test("tsSlug produces filesystem-safe names from ISO timestamps", () => {
    // "2026-05-14T01:23:45.678Z" → "20260514-012345"
    const ts = `2026-05-14T01:23:45.678Z`;
    const slug = "20260514-012345";
    const beforePath = join(dumpsDir, `${slug}-before.jsonl`);

    dumpCompaction(ts, [{ role: "user", content: "test" }], "summary");
    expect(existsSync(beforePath)).toBe(true);
  });

  test("dumpCompaction can be disabled", () => {
    const dir = join(dumpsDir, `${TEST_PREFIX}-disabled`);
    mkdirSync(dir, { recursive: true });

    dumpCompaction("2026-05-14T03:00:00.000Z", [], "summary", {
      enabled: false,
      dumpsDir: dir,
    });

    expect(existsSync(join(dir, "20260514-030000-after.txt"))).toBe(false);
  });

  test("dumpCompaction prunes old dump pairs", () => {
    const dir = join(dumpsDir, `${TEST_PREFIX}-retention`);
    mkdirSync(dir, { recursive: true });

    dumpCompaction("2026-05-14T03:00:00.000Z", [], "one", {
      maxDumps: 2,
      dumpsDir: dir,
    });
    dumpCompaction("2026-05-14T03:01:00.000Z", [], "two", {
      maxDumps: 2,
      dumpsDir: dir,
    });
    dumpCompaction("2026-05-14T03:02:00.000Z", [], "three", {
      maxDumps: 2,
      dumpsDir: dir,
    });

    expect(existsSync(join(dir, "20260514-030000-after.txt"))).toBe(false);
    expect(existsSync(join(dir, "20260514-030100-after.txt"))).toBe(true);
    expect(existsSync(join(dir, "20260514-030200-after.txt"))).toBe(true);
  });

  // ── CompactEvent type acceptance ──────────────────────────────────────

  test("CompactEvent type accepts new optional fields at runtime", () => {
    const event: CompactEvent = {
      ts: `${TEST_PREFIX}-typecheck`,
      tier: 1,
      before: 100000,
      after: 2000,
      removed: 98000,
      toolTokens: 0,
      idleS: 60,
      exchanges: 5,
      sessionCalls: 30,
      summaryHead: "User asked about compaction...",
      summaryLen: 1500,
      strategy: "algorithmic",
      sessionFile: "/path/to/session.jsonl",
    };
    logCompaction(event);
    expect(event.summaryHead).toBeDefined();
    expect(event.strategy).toBe("algorithmic");
  });
});
