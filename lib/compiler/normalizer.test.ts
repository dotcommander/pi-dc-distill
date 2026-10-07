import { describe, expect, test } from "bun:test";
import { normalizeMessage } from "./normalizer.ts";

describe("typed message normalization", () => {
  test("joins native user text and does not treat image-only input as a request", () => {
    expect(normalizeMessage({ role: "user", content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] }))
      .toEqual([{ kind: "user", text: "one\ntwo", nativeUserText: true }]);
    expect(normalizeMessage({ role: "user", content: [{ type: "image", mimeType: "image/png" }] })[0]).toMatchObject({ nativeUserText: false });
  });
  test("retains full lexical tool identities with bounded display text", () => {
    const path = `./${"😀".repeat(600)}`;
    const record = normalizeMessage({ role: "assistant", content: [
      { type: "toolCall", id: "exact-id", name: "read_file", arguments: { file_path: path } },
    ] })[0];
    expect(record).toMatchObject({ kind: "tool-call", name: "read_file", callId: "exact-id", args: { file_path: path } });
    expect(record.text).toContain("😀"); // display fits: no clip, no provenance flag
    expect(record.textShortened).toBeUndefined();
    const output = "x".repeat(3000);
    const result = normalizeMessage({ role: "toolResult", toolName: "read_file", toolCallId: "exact-id", isError: false,
      content: [{ type: "text", text: output }] })[0];
    expect(result).toMatchObject({ kind: "tool-result", text: "x".repeat(2048), isError: false });
    expect(result.textShortened).toBe(true);
  });
  test("missing outcome is unknown and native bash retains integer exit/cancellation", () => {
    expect(normalizeMessage({ role: "toolResult", toolName: "bash", content: "PASS" })[0]).toHaveProperty("isError", undefined);
    const bash = normalizeMessage({ role: "bashExecution", command: "bun test", output: "PASS", exitCode: 1, cancelled: true, cwd: "/tmp" })[0];
    expect(bash).toMatchObject({ kind: "bash", command: "bun test", output: "PASS", exitCode: 1, cancelled: true, cwd: "/tmp" });
    expect(normalizeMessage({ role: "bashExecution", command: "cmd", output: "", exitCode: 0.5 })[0]).toHaveProperty("exitCode", undefined);
  });
  test("custom text and summaries never acquire native user attribution", () => {
    for (const message of [{ role: "custom", content: "user-looking text" }, { role: "branchSummary", summary: "branch" },
      { role: "compactionSummary", summary: "summary" }]) expect(normalizeMessage(message)[0]).not.toHaveProperty("nativeUserText");
  });
  test("retains role-specific validation without repeating source structural certification", () => {
    expect(() => normalizeMessage({ role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: null }] })).toThrow("tool call");
  });
});
