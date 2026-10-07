import { describe, expect, test } from "bun:test";
import { OrderedSet } from "./helpers.ts";
import { collectConversationToolCall, collectConversationToolResult, createEvidenceState } from "./tool-tracker.ts";
import type { PendingToolCall, ToolCallFingerprint, VerificationReceipt } from "./types.ts";

function tracker(sessionCwd?: string) {
  const state = createEvidenceState();
  const pending: PendingToolCall[] = [];
  const fingerprints = new Map<string, ToolCallFingerprint>();
  const receipts = new Map<string, VerificationReceipt>();
  const order: string[] = [];
  return {
    state, pending, receipts,
    submit(name: string, id: string, args: Record<string, unknown>) {
      collectConversationToolCall({ kind: "tool_call", name, callId: id, args }, pending, fingerprints, order, state, sessionCwd);
    },
    finish(name: string, id: string, isError: boolean | null = false, text = "12 passed") {
      collectConversationToolResult({ kind: "tool_result", name, callId: id, isError: isError === null ? undefined : isError, text }, pending, receipts,
        new OrderedSet(), new OrderedSet(), new OrderedSet(), new OrderedSet(), new OrderedSet(), new OrderedSet(), new OrderedSet(),
        [], [], 0, 0, sessionCwd, state.mutationEpoch, undefined, state);
    },
  };
}

describe("shell receipt collection", () => {
  test("quoted relative cd and conjunction retain exact runner, bytes and resolved cwd", () => {
    const tracked = tracker("/repo/work");
    const command = "cd '../other dir' && bun  test && tsc --noEmit";
    tracked.submit("functions.bash", "check", { command });
    tracked.finish("functions.bash", "check");
    expect([...tracked.receipts.keys()]).toEqual([JSON.stringify(["functions.bash", command, "/repo/other dir"])]);
    expect([...tracked.receipts.values()]).toEqual([{
      sourceSequence: undefined, status: "PASS", tool: "functions.bash", command, cwd: "/repo/other dir",
      evidence: "12 passed", mutationEpoch: 2, freshnessEstablished: true,
    }]);
  });

  test("unknown cwd cannot establish freshness or resolve a relative cd", () => {
    const tracked = tracker();
    tracked.submit("bash", "no-cwd", { command: "bun test" });
    tracked.finish("bash", "no-cwd");
    expect([...tracked.receipts.keys()]).toEqual([JSON.stringify(["bash", "bun test", null])]);
    expect([...tracked.receipts.values()][0]).toMatchObject({ cwd: undefined, status: "PASS", freshnessEstablished: false });
    tracked.submit("bash", "relative", { command: "cd '../other dir' && bun test" });
    tracked.finish("bash", "relative");
    expect(tracked.receipts.size).toBe(1);
    tracked.submit("bash", "absolute", { command: "cd '/repo/other dir' && bun test" });
    tracked.finish("bash", "absolute");
    expect(tracked.receipts.get(JSON.stringify(["bash", "cd '/repo/other dir' && bun test", "/repo/other dir"])))
      .toMatchObject({ status: "PASS", cwd: "/repo/other dir", freshnessEstablished: true });
  });

  test("pipelines, compounds, unsupported syntax and unsafe flags produce no verification receipt", () => {
    for (const command of ["bun test | cat", "bun test; git diff --check", "bun test || bun test", "bun test >result",
      "bun test $(echo unsafe)", "go test -exec=./hook", "git diff --check --output=result", "bun test --update-snapshots"]) {
      const tracked = tracker("/repo");
      tracked.submit("bash", "check", { command });
      tracked.finish("bash", "check");
      expect(tracked.receipts.size).toBe(0);
      expect(tracked.state.git).toEqual([]);
    }
  });

  test("scoped Git checks collect both identities, while incomplete and failed probes never record Git success", () => {
    const command = "cd '../other dir' && git diff --check -- src/a.ts";
    const tracked = tracker("/repo/work");
    tracked.submit("bash", "git", { command });
    tracked.finish("bash", "git", false, "");
    expect([...tracked.receipts.values()][0]).toMatchObject({ command, cwd: "/repo/other dir", status: "PASS", freshnessEstablished: true });
    expect(tracked.state.git).toEqual([{
      command, cwd: "/repo/other dir", scope: "worktree diff (unstaged tracked files) (path-limited); whitespace check",
      evidence: "no output from scoped probe; working-tree cleanliness not established", mutationEpoch: 2, freshnessEstablished: true,
    }]);
    for (const isError of [true, null]) {
      const rejected = tracker("/repo/work");
      rejected.submit("bash", "git", { command });
      rejected.finish("bash", "git", isError, "");
      expect([...rejected.receipts.values()][0].status).toBe(isError === true ? "FAIL" : "INCOMPLETE");
      expect(rejected.state.git).toEqual([]);
    }
  });

  test("failed, pending and overlapping mutations fence receipts until a new completed check", () => {
    const tracked = tracker("/repo");
    tracked.submit("patch_file", "write", { path: "a.ts" });
    tracked.submit("bash", "during", { command: "bun test" });
    tracked.finish("bash", "during");
    expect([...tracked.receipts.values()][0]).toMatchObject({ status: "PASS", freshnessEstablished: false });
    expect(tracked.pending.map((call) => call.callId)).toEqual(["write"]);
    tracked.finish("patch_file", "write", true, "failed");
    expect(tracked.state.risks[0]).toMatchObject({ failed: true });
    tracked.submit("bash", "after", { command: "bun test" });
    tracked.submit("patch_file", "later", { path: "b.ts" });
    tracked.finish("patch_file", "later", true, "failed");
    tracked.finish("bash", "after");
    expect([...tracked.receipts.values()][0]).toMatchObject({ status: "PASS", freshnessEstablished: false });
    tracked.submit("bash", "fresh", { command: "bun test" });
    tracked.finish("bash", "fresh");
    expect([...tracked.receipts.values()][0]).toMatchObject({ status: "PASS", freshnessEstablished: true });
    expect(tracked.state.risks).toHaveLength(2);
  });
});
