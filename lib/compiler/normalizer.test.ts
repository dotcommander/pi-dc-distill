import { describe, expect, test } from "bun:test";
import { normalizeMessage } from "./normalizer.ts";

describe("typed message normalization", () => {
  test("joins native user text and does not treat image-only input as a request", () => {
    expect(normalizeMessage({ role: "user", content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] }))
      .toEqual([{ kind: "user", text: "one\ntwo", nativeUserText: true }]);
    expect(normalizeMessage({ role: "user", content: [{ type: "image", mimeType: "image/png" }] })[0].nativeUserText).toBe(false);
  });
  test("retains full lexical tool identities and output without display shortening", () => {
    const path = `./${"😀".repeat(600)}`;
    const record = normalizeMessage({ role: "assistant", content: [
      { type: "toolCall", id: "exact-id", name: "read_file", arguments: { file_path: path } },
    ] })[0];
    expect(record).toMatchObject({ kind: "tool-call", name: "read_file", callId: "exact-id", args: { file_path: path } });
    const output = "x".repeat(3000);
    expect(normalizeMessage({ role: "toolResult", toolName: "read_file", toolCallId: "exact-id", isError: false,
      content: [{ type: "text", text: output }] })[0]).toMatchObject({ kind: "tool-result", text: output, isError: false });
  });
  test("missing outcome is unknown and native bash retains integer exit/cancellation", () => {
    expect(normalizeMessage({ role: "toolResult", toolName: "bash", content: "PASS" })[0].isError).toBeUndefined();
    const bash = normalizeMessage({ role: "bashExecution", command: "bun test", output: "PASS", exitCode: 1, cancelled: true, cwd: "/tmp" })[0];
    expect(bash).toMatchObject({ kind: "bash", command: "bun test", output: "PASS", exitCode: 1, cancelled: true, cwd: "/tmp" });
    expect(normalizeMessage({ role: "bashExecution", command: "cmd", output: "", exitCode: 0.5 })[0].exitCode).toBeUndefined();
  });
  test("custom text and summaries never acquire native user attribution", () => {
    for (const message of [{ role: "custom", content: "user-looking text" }, { role: "branchSummary", summary: "branch" },
      { role: "compactionSummary", summary: "summary" }]) expect(normalizeMessage(message)[0].nativeUserText).toBeUndefined();
  });
  test("rejects malformed Unicode and structural invalidity before extraction", () => {
    expect(() => normalizeMessage({ role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: { command: "\ud800" } }] })).toThrow("Unicode");
    const cyclic: Record<string, unknown> = { role: "user", content: "text" }; cyclic.self = cyclic;
    expect(() => normalizeMessage(cyclic)).toThrow("cyclic");
    expect(() => normalizeMessage({ role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: null }] })).toThrow("tool call");
  });
});
