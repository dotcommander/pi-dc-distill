import { describe, expect, test } from "bun:test";
import { errorSignal, excerptClass, excerptScore, signalScore, SUBSTANTIVE_THRESHOLD } from "./signal.ts";

describe("content signal rubric", () => {
  test("diffs, code, tables, errors, architecture language score substantive", () => {
    const diff = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new";
    expect(signalScore(diff)).toBeGreaterThanOrEqual(SUBSTANTIVE_THRESHOLD);
    expect(signalScore("```ts\nconst x = 1;\n```")).toBeGreaterThanOrEqual(4);
    expect(signalScore("| a | b |\n|---|---|\n| 1 | 2 |")).toBeGreaterThanOrEqual(4);
    expect(signalScore("the build failed with error: exit status 1")).toBeGreaterThanOrEqual(4);
    expect(signalScore("we chose fail-closed instead of retrying: an invariant here")).toBeGreaterThanOrEqual(SUBSTANTIVE_THRESHOLD);
    expect(signalScore("# Plan\n1. first\n2. second\n3. third\n4. fourth")).toBeGreaterThanOrEqual(SUBSTANTIVE_THRESHOLD);
  });
  test("chatter is penalized", () => {
    expect(signalScore("ok.")).toBeLessThan(0);
    expect(signalScore("Let me check the file.")).toBeLessThanOrEqual(0);
    expect(signalScore("done!")).toBeLessThan(0);
  });
  test("excerpt scoring is kind-aware", () => {
    expect(excerptScore({ kind: "user", text: "continue" })).toBe(SUBSTANTIVE_THRESHOLD);
    expect(excerptScore({ kind: "native-summary", text: "anything" })).toBe(SUBSTANTIVE_THRESHOLD);
    expect(excerptScore({ kind: "tool-result", text: "error: boom" })).toBe(4);
    expect(excerptScore({ kind: "tool-result", text: "fine" })).toBe(0);
    expect(errorSignal("panic: runtime error")).toBe(true);
    expect(errorSignal("all good")).toBe(false);
  });
});

test("modernization preserves path, numbered-heading and error signals exactly", () => {
  expect(signalScore("lib/example.ts")).toBe(1);
  expect(signalScore("1. first action")).toBe(2);
  expect(signalScore("fatal failure in lib/example.ts")).toBe(5);
  expect(excerptScore({ kind: "tool-result", text: "fatal failure in lib/example.ts" })).toBe(4);
  expect(errorSignal("cannot open resource")).toBe(true);
});


test("admission classes exhaustively separate context from operations", () => {
  expect(excerptClass("user")).toBe(3);
  for (const kind of ["assistant", "native-summary", "branch-summary", "custom"] as const) expect(excerptClass(kind)).toBe(2);
  for (const kind of ["tool-call", "tool-result", "bash"] as const) expect(excerptClass(kind)).toBe(1);
});
