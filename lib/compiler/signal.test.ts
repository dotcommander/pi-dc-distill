import { describe, expect, test } from "bun:test";
import { errorSignal, excerptScore, signalScore, SUBSTANTIVE_THRESHOLD } from "./signal.ts";

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
