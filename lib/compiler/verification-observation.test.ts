import { expect, test } from "bun:test";
import { compileSessionJsonl } from "../local-compact.ts";
import { observeVerification } from "./verification-observation.ts";
import { compressToolResults } from "./normalizer.ts";
import { KIND_TOOL_RESULT, type NormalizedBlock, type PendingToolCall, type VerificationReceipt } from "./types.ts";
import { collectConversationToolResult } from "./tool-tracker.ts";
import { OrderedSet } from "./helpers.ts";

function compileVerification(output: string, isError = false) {
  return compileSessionJsonl([
    { type: "session", cwd: "/tmp/project" },
    { type: "message", message: { role: "user", content: "Verify the parser" } },
    { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "test-1", name: "bash", arguments: { command: "bun test lib/parser.test.ts" } }] } },
    { type: "message", message: { role: "toolResult", toolCallId: "test-1", toolName: "bash", isError, content: [{ type: "text", text: output }] } },
  ].map((entry) => JSON.stringify(entry)).join("\n"));
}

function middleOutput(marker: string) {
  const lines = Array.from({ length: 500 }, (_, index) => `passing case ${index + 1}`);
  lines[249] = marker;
  lines[499] = "499 passed, 0 failed";
  return lines.join("\n");
}

test("preserves middle verification failure before preview compression", () => {
  const summary = compileVerification(middleOutput("--- FAIL: TestParserMiddle")).summary;
  expect(summary).toContain("FAIL [bash cwd=/tmp/project]: bun test lib/parser.test.ts");
  expect(summary).toContain("— --- FAIL: TestParserMiddle");
});

for (const [marker, status] of [
  ["Command exited with code 17", "FAIL"],
  ["--- fail: lowercase parser", "FAIL"],
  ["parser failed unexpectedly", "FAIL"],
  ["SKIP: unsupported platform", "SKIP"],
  ["no tests to run", "SKIP"],
] as const) {
  test(`preserves middle ${marker} evidence despite a success footer`, () => {
    const summary = compileVerification(middleOutput(marker)).summary;
    expect(summary).toContain(`${status} [bash cwd=/tmp/project]: bun test lib/parser.test.ts — ${marker}`);
  });
}

test("failure takes precedence over earlier skip and later success", () => {
  const output = middleOutput("SKIP: unsupported case").replace("passing case 350", "--- FAIL: decisive parser");
  expect(compileVerification(output).summary).toContain("FAIL [bash cwd=/tmp/project]: bun test lib/parser.test.ts — --- FAIL: decisive parser");
  expect(observeVerification("SKIP: earlier\n--- FAIL: first\n--- FAIL: second", false)).toEqual({ status: "FAIL", evidence: "--- FAIL: first" });
  expect(observeVerification("skip: first\nno tests to run", false)).toEqual({ status: "SKIP", evidence: "skip: first" });
});

test("legitimate zero-failure totals preserve success evidence selection", () => {
  for (const total of ["0 failed", "0 failures", "0 failure", "failed: 0", "failures: 0", "fail: 0", "0 FAIL", "0 fail"]) {
    expect(observeVerification(`starting\n12 pass, ${total}\nfinished`, false)).toEqual({ status: "PASS", evidence: `12 pass, ${total}` });
    expect(compileVerification(middleOutput(total)).summary).toContain("PASS [bash cwd=/tmp/project]: bun test lib/parser.test.ts — 499 passed, 0 failed");
  }
});

test("host-only errors explicitly identify isError and preserve diagnostic evidence", () => {
  expect(compileVerification(middleOutput("SKIP: unsupported case"), true).summary).toContain("FAIL [bash cwd=/tmp/project]: bun test lib/parser.test.ts — tool result isError=true");
  expect(observeVerification("12 passed\n--- FAIL: textual cause", true)).toEqual({ status: "FAIL", evidence: "--- FAIL: textual cause" });
  expect(observeVerification("TypeError: cannot read property", true)).toEqual({ status: "FAIL", evidence: "tool result isError=true; TypeError: cannot read property" });
});

function trackResult(block: NormalizedBlock, calls: PendingToolCall[]) {
  const verification = new Map<string, VerificationReceipt>();
  collectConversationToolResult(block, calls, verification,
    new OrderedSet(), new OrderedSet(), new OrderedSet(), new OrderedSet(),
    new OrderedSet(), new OrderedSet(), new OrderedSet(), [], [], 0, 0, "/tmp/project", 0);
  return [...verification.values()];
}

test("unannotated full output fallback preserves decisive failure", () => {
  const receipts = trackResult({ kind: KIND_TOOL_RESULT, name: "bash", callId: "test-1", isError: false, text: middleOutput("--- FAIL: fallback parser") },
    [{ name: "bash", callId: "test-1", args: { command: "bun test" } }]);
  expect(receipts).toHaveLength(1);
  expect(receipts[0].status).toBe("FAIL");
  expect(receipts[0].evidence).toStartWith("--- FAIL: fallback parser");
});

test("observations cannot bypass unambiguous pairing or verification-command checks", () => {
  const block: NormalizedBlock = { kind: KIND_TOOL_RESULT, name: "bash", text: "compressed preview", verificationObservation: { status: "FAIL", evidence: "--- FAIL: full output" } };
  expect(trackResult(block, [])).toEqual([]);
  expect(trackResult(block, [{ name: "bash", args: { command: "bun test first" } }, { name: "bash", args: { command: "bun test second" } }])).toEqual([]);
  expect(trackResult(block, [{ name: "Bash", args: { command: "bun test" } }])).toEqual([]);
  expect(trackResult(block, [{ name: "bash", args: { command: "cat logs.txt" } }])).toEqual([]);
});

test("long Unicode evidence retains decisive markers within 300 code points", () => {
  for (const marker of ["--- FAIL: unicode parser", "Command exited with code 23", "SKIP: unicode case"]) {
    const line = `${"😀".repeat(600)} ${marker} ${"🧪".repeat(600)}`;
    const observed = observeVerification(line, false);
    expect(Array.from(observed.evidence).length).toBeLessThanOrEqual(300);
    expect(observed.evidence).toContain(marker);
    expect(observed.evidence).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
    expect(compileVerification(middleOutput(line)).summary).toContain(`— ${observed.evidence}`);
  }
});

test("observation leaves compressed previews unchanged and retains no full output", () => {
  const output = middleOutput("--- FAIL: hidden middle");
  const [block] = compressToolResults([{ kind: KIND_TOOL_RESULT, text: output, isError: false, name: "Bash" }]);
  expect(block.text).toBe("passing case 1\n499 passed, 0 failed\n...(498 lines omitted)");
  expect(block.name).toBe("Bash");
  expect(block.verificationObservation?.status).toBe("FAIL");
  expect(block.verificationObservation?.evidence).toStartWith("--- FAIL: hidden middle");
  expect(Array.from(block.verificationObservation?.evidence ?? "").length).toBeLessThanOrEqual(300);
  expect(JSON.stringify(block)).not.toContain("passing case 248");
  expect(compressToolResults([block])).toEqual([block]);
});

for (const marker of ["Exit code: 2", "exit=2", "exit code = 17", "exit=-1", "2 failures", "failed: 3", "FAIL parser suite", "(fail) parser"]) {
  test(`alternate failure outcome ${marker} remains decisive`, () => {
    expect(observeVerification(`PASS parser\n${marker}\n12 passed, 0 failed`, false)).toEqual({ status: "FAIL", evidence: marker });
    expect(compileVerification(middleOutput(marker)).summary).toContain(`FAIL [bash cwd=/tmp/project]: bun test lib/parser.test.ts — ${marker}`);
  });
}

for (const output of ["PASS handles FailedResponse", "PASS Failed request returns retry", "ok TestFailedResult", "✓ FailedResponse is retried", "(pass) Failed to parse input is handled", "12 passed, 0 failed, 0 skipped", "passed: 12, failed: 0, skipped: 0"]) {
  test(`benign failure or skip wording passes: ${output}`, () => {
    expect(observeVerification(output, false)).toEqual({ status: "PASS", evidence: output });
    expect(compileVerification(output).summary).toContain("PASS [bash cwd=/tmp/project]");
    expect(observeVerification(output, true).status).toBe("FAIL");
  });
}

for (const marker of ["2 skipped", "skipped: 1", "skip: 2"]) {
  test(`positive skip count ${marker} is not a pass`, () => {
    expect(observeVerification(`PASS parser\n${marker}\n0 skipped`, false)).toEqual({ status: "SKIP", evidence: marker });
  });
}


test("zero outcome counts do not hide later explicit markers on the same line", () => {
  for (const zero of ["0 skipped", "0 skip", "skipped: 0", "skip: 0", "SKIPPED: 0"]) {
    expect(observeVerification(zero, false).status).toBe("PASS");
    const line = `${zero}; SKIP: unsupported platform`;
    expect(observeVerification(line, false)).toEqual({ status: "SKIP", evidence: line });
  }
  for (const zero of ["0 failed", "fail: 0", "failed: 0", "failures: 0"]) {
    const line = `${zero}; FAIL: parser`;
    expect(observeVerification(line, false)).toEqual({ status: "FAIL", evidence: line });
  }
});


for (const output of [
  "PASS returns FAIL: as expected for invalid input",
  "(pass) counts 2 failures from an expected-negative fixture",
  "ok 4 - handles FAIL and Command exited with code 2",
  "test rejects_FAILED_value ... ok",
  "tests/test_parser.py::test_FAIL_in_description PASSED [100%]",
]) {
  test(`runner-owned passing test names are not failure outcomes: ${output}`, () => {
    expect(observeVerification(output, false).status).toBe("PASS");
    expect(observeVerification(`${output}\n--- FAIL: actual outcome`, false).status).toBe("FAIL");
  });
}

for (const marker of ["not ok 3 - expected-negative case", "✖ reports expected FAIL correctly", "FAILED tests/test_parser.py::test_parse", "==== FAILURES ====", "test parser ... FAILED"]) {
  test(`runner terminal failure remains decisive: ${marker}`, () => {
    const observed = observeVerification(`${marker}\n12 passed, 0 failed`, false);
    expect(observed.status).toBe("FAIL");
    expect(observed.evidence).toStartWith(marker);
  });
}

test("oversized evidence leads with the failure and includes bounded adjacent context", () => {
  const output = `${"noise\n".repeat(100)}before parser assertion\n--- FAIL: parser assertion\nafter parser details\n${"noise\n".repeat(100)}12 passed`;
  const observed = observeVerification(output, false);
  expect(observed.evidence).toStartWith("--- FAIL: parser assertion");
  expect(observed.evidence).toContain("before parser assertion");
  expect(observed.evidence).toContain("after parser details");
  expect(observed.evidence).toEndWith("…");
  expect(Array.from(observed.evidence).length).toBeLessThanOrEqual(300);
});

test("missing host status cannot conceal a supplied decisive failure", () => {
  expect(observeVerification("--- FAIL: actual outcome", undefined).status).toBe("FAIL");
  expect(observeVerification("12 passed", undefined).status).toBe("INCOMPLETE");
});

test("unavailable host bytes cannot prove a pass but do not conceal failure", () => {
  for (const notice of ["Output truncated", "Warning: output was truncated", "[output truncated: 1200 bytes]", "...(900 bytes omitted)"]) {
    expect(observeVerification(`${notice}\n12 passed`, false).status).toBe("INCOMPLETE");
    expect(observeVerification(`${notice}\n--- FAIL: parser`, false).status).toBe("FAIL");
  }
  expect(observeVerification("PASS handles output truncated notices", false).status).toBe("PASS");
});
