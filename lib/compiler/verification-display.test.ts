import { expect, test } from "bun:test";
import { emptyCheckpoint } from "./checkpoint.ts";
import { prioritizeVerificationDisplay, verificationEvictionIndex } from "./verification-display.ts";
import type { VerificationReceipt } from "./types.ts";

function receipt(command: string, status: VerificationReceipt["status"] = "PASS", tool = "bash"): VerificationReceipt & { id: string } {
  return { id: command, command, status, tool, cwd: "/repo", evidence: status === "FAIL" ? "middle-output failure retained" : "exit 0", mutationEpoch: 0, freshnessEstablished: true };
}
test("verification display prioritizes exact declared requirements, failures and distinct command categories", () => {
  const state = emptyCheckpoint();
  state.tasks = [{ id: "review", status: "pending", action: "Review", blocker: "", "depends-on": [], requires: ["types"] }];
  state.preconditions = [{ id: "types", kind: "verification-pass", runner: "bash", command: "bun x tsc --noEmit", cwd: "/repo" }];
  const observations = [receipt("bun x tsc --noEmit"), receipt("bun test regression", "FAIL"), receipt("bun run build"),
    receipt("bun run lint"), receipt("bun run distill:architecture"), receipt("git diff --check"),
    ...Array.from({ length: 20 }, (_, index) => receipt(`bun test case-${index}`))];
  state.evidence = { ...state.evidence, verification: observations };
  const before = JSON.stringify(state);
  const lines = prioritizeVerificationDisplay(state, 7);
  expect(lines[0]).toContain("bun x tsc --noEmit");
  expect(lines[1]).toContain("FAIL");
  expect(lines.join("\n")).toContain("middle-output failure retained");
  expect(lines.join("\n")).toContain("bun run build");
  expect(lines.join("\n")).toContain("bun run lint");
  expect(lines.join("\n")).toContain("distill:architecture");
  expect(lines.join("\n")).toContain("git diff --check");
  expect(JSON.stringify(state)).toBe(before);
  const removed = verificationEvictionIndex(lines, state);
  expect(lines[removed]).not.toContain("middle-output failure retained");
  expect(lines[removed]).not.toContain("bun x tsc --noEmit");
});
test("different runners and working directories remain distinct identities", () => {
  const state = emptyCheckpoint();
  state.evidence = { ...state.evidence, verification: [receipt("bun test", "PASS", "bash"), receipt("bun test", "FAIL", "exec_command"),
    { ...receipt("bun test"), cwd: "/other" }] };
  expect(prioritizeVerificationDisplay(state).filter(line => !line.startsWith("...")).length).toBe(3);
  expect(state.evidence.verification.length).toBe(3);
});

test("new observations move exact identity to current recency across a mutation frontier", () => {
  const state = emptyCheckpoint();
  state.evidence = { ...state.evidence, mutationEpoch: 1, verification: [
    receipt("bun test main"),
    ...Array.from({ length: 12 }, (_, index) => receipt(`bun test old-${index}`)),
    { ...receipt("bun test main"), mutationEpoch: 1 },
  ] };
  const lines = prioritizeVerificationDisplay(state, 10);
  expect(lines[0]).toContain("bun test main");
  expect(lines[0]).not.toContain("freshness: not established");
  expect(lines.join("\n")).toContain("stale verification receipts omitted");
  expect(state.evidence.verification).toHaveLength(14);
});

test("pending attempt preserves its preceding completed observation", () => {
  const state = emptyCheckpoint();
  state.evidence = { ...state.evidence, mutationEpoch: 1, verification: [
    receipt("bun test main"), { ...receipt("bun test main", "INCOMPLETE"), mutationEpoch: 1 },
  ] };
  const lines = prioritizeVerificationDisplay(state);
  expect(lines.join("\n")).toContain("INCOMPLETE [bash cwd=/repo]: bun test main");
  expect(lines.join("\n")).toContain("PASS [bash cwd=/repo]: [stale command sha256:");
  expect(state.evidence.verification).toHaveLength(2);
});
