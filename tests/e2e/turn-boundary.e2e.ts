/** Opt-in real-host turn-boundary ordering; scripted provider, no paid calls.
 * DISTILL_PI_PACKAGE / DISTILL_PI_EXPECT_VERSION select dev 0.99.2 or installed 1.0.3.
 */
import { expect, test } from "bun:test";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTestDir, piEnv, scriptedArgs, latestSessionFile, REPO_ROOT, EXTENSION } from "./harness/env.ts";
import { RpcClient } from "./harness/rpc-client.ts";
import { assertCurrentCompaction } from "./harness/current-compaction.ts";

const records = (file: string): any[] => existsSync(file)
  ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
// Failure reporting intentionally shares this journal. Exclude only its exact
// tagged records, so every other newly written record remains an artifact.
const successLogs = (file: string): any[] => records(file).filter((entry) => entry.kind !== "failure");
const isContinuation = (entry: { type?: unknown; customType?: unknown }): boolean =>
  entry.type === "custom_message" && entry.customType === "dc-distill-continuation";
async function waitUntil(predicate: () => boolean) {
  const deadline = Date.now() + 30_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Boundary scenario timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("owned compiler failure pauses later urgent turns until a validated manual commit", async () => {
  const t = makeTestDir("turn-boundary-compiler-pause", { keepRecentTokens: 1024 });
  let passed = false;
  const offset = join(t.dir, "clock-offset");
  const boundaryTrace = join(t.dir, "boundary-trace.jsonl");
  const usage = join(t.dir, "usage");
  const fault = join(t.dir, "compiler-fault");
  const toolFile = join(t.dir, "tool-input.txt");
  writeFileSync(offset, "0");
  writeFileSync(usage, "4000");
  writeFileSync(toolFile, "Bounded sibling tool output.\n".repeat(100));
  const args = scriptedArgs(t)
    .map((arg) => arg === EXTENSION ? join(REPO_ROOT, "tests/e2e/harness/turn-boundary-extension.ts") : arg);
  const client = new RpcClient({ args, cwd: t.dir, logFile: t.logFile,
    env: piEnv(t, { DISTILL_TEST_CLOCK_OFFSET: offset, DISTILL_TEST_BOUNDARY_TRACE: boundaryTrace,
      DISTILL_TEST_COMPILER_FAULT: fault, DISTILL_FAKE_USAGE_FILE: usage,
      DISTILL_FAKE_BOUNDARY_FILE: toolFile }) });
  const settle = async (message: string) => {
    const since = client.mark();
    expect((await client.request({ type: "prompt", message })).success).toBe(true);
    await client.waitFor((event) => event.type === "agent_settled", 30_000, { since });
  };
  try {
    for (let turn = 0; turn < 3; turn++) await settle(`Seed ${turn}. ` + "discarded context ".repeat(2000));
    expect((await client.request({ type: "compact" }, 45_000)).success).toBe(true);
    const session = latestSessionFile(t)!;
    const logFile = join(t.agentHome, "data", "dc-distill", "compact-log.jsonl");
    const diagnosticFile = join(t.agentHome, "data", "dc-distill", "diag.log");
    const baselineLogs = successLogs(logFile).length;
    expect(records(session).filter((entry) => entry.type === "compaction")).toHaveLength(1);
    writeFileSync(offset, "121000");
    // Establish an extension-owned failure below the native trigger. At urgent
    // usage the host can start native threshold preparation before settlement.
    writeFileSync(usage, "135000");
    writeFileSync(fault, "unicode");
    const since = client.mark();
    expect((await client.request({ type: "prompt", message: "RUN_BOUNDARY_BATCHES: exercise urgent compiler failure." })).success).toBe(true);
    const failure = await client.waitFor((event) => event.type === "compaction_end", 30_000, { since });
    expect(failure.aborted).toBe(true);
    await waitUntil(() => existsSync(diagnosticFile) && readFileSync(diagnosticFile, "utf8").includes("compiler-paused"));
    expect(records(boundaryTrace).filter((entry) => entry.kind === "abort")).toHaveLength(1);
    expect(records(boundaryTrace).filter((entry) => entry.kind === "compact")).toHaveLength(1);
    writeFileSync(usage, "190000"); // genuine urgent usage, above the resolved floor183616
    for (let turn = 0; turn < 3; turn++) await settle(`New ordinary user prompt ${turn}: acknowledge only.`);
    // Changed user entries and fresh urgent usage leave the pause armed. The
    // assistant settles normally: no repeated extension abort or submission.
    expect(records(boundaryTrace).filter((entry) => entry.kind === "abort")).toHaveLength(1);
    expect(records(boundaryTrace).filter((entry) => entry.kind === "compact")).toHaveLength(1);
    const pausedDiagnostics = readFileSync(diagnosticFile, "utf8").split("\n")
      .filter((line) => line.includes("auto-check blocked reason=compiler-paused"));
    expect(pausedDiagnostics.some((line) => /tokens=19\d{4}\b/.test(line)
      && line.includes("headroomFloor=183616"))).toBe(true);
    expect(records(session).filter((entry) => entry.type === "compaction")).toHaveLength(1);
    expect(records(session).filter(isContinuation)).toHaveLength(0);
    expect(successLogs(logFile)).toHaveLength(baselineLogs);

    // Manual compaction stays reachable; its failure cannot clear the pause.
    expect((await client.request({ type: "compact" }, 45_000)).success).toBe(false);
    await settle("New prompt after failed manual compaction: acknowledge only.");
    expect(records(boundaryTrace).filter((entry) => entry.kind === "abort")).toHaveLength(1);
    expect(records(boundaryTrace).filter((entry) => entry.kind === "compact")).toHaveLength(1);
    expect(records(session).filter((entry) => entry.type === "compaction")).toHaveLength(1);
    expect(successLogs(logFile)).toHaveLength(baselineLogs);
    expect(records(session).filter(isContinuation)).toHaveLength(0);

    // Removing the input fault does not itself emit a reset event. A later
    // native threshold callback could now commit, so recover explicitly through
    // the manual host operation and validate the actual newest branch entry.
    unlinkSync(fault);
    expect(records(boundaryTrace).filter((entry) => entry.kind === "compact")).toHaveLength(1);
    writeFileSync(usage, "5000");
    expect((await client.request({ type: "compact" }, 45_000)).success).toBe(true);
    const recovered = records(session).filter((entry) => entry.type === "compaction");
    expect(recovered).toHaveLength(2);
    assertCurrentCompaction(recovered[1].summary, recovered[1].details);
    expect(recovered[1].details.autonomous).toBe(false);
    expect(records(session).filter(isContinuation)).toHaveLength(0);
    expect(successLogs(logFile)).toHaveLength(baselineLogs + 1);
    writeFileSync(usage, "135000");
    writeFileSync(offset, "242000"); // restored ordinary admission still honors cooldown
    const recoverySince = client.mark();
    expect((await client.request({ type: "prompt", message: "RUN_BOUNDARY_BATCHES: resume after validated manual recovery." })).success).toBe(true);
    const recoveryEnd = await client.waitFor((event) => event.type === "compaction_end", 30_000, { since: recoverySince });
    expect(recoveryEnd.aborted).toBe(false);
    await waitUntil(() => records(session).some(isContinuation));
    const final = records(session).filter((entry) => entry.type === "compaction");
    expect(final).toHaveLength(3);
    assertCurrentCompaction(final[2].summary, final[2].details);
    expect(final[2].details.autonomous).toBe(true);
    expect(records(boundaryTrace).filter((entry) => entry.kind === "abort")).toHaveLength(2);
    expect(records(boundaryTrace).filter((entry) => entry.kind === "compact")).toHaveLength(2);
    expect(records(t.traceFile).filter((entry) => entry.kind === "summary")).toHaveLength(0);
    passed = true;
  } finally {
    await client.close();
    await t.finalize(passed);
  }
}, 90_000);

for (const scenario of ["commit", "cancel", "supersede", "expired", "backward-clock"] as const) {
  const mode = scenario === "expired" || scenario === "backward-clock" ? "commit" : scenario;
  test(`persisted tool batches stop before final settlement: ${scenario}`, async () => {
    const t = makeTestDir(`turn-boundary-${scenario}`, { keepRecentTokens: 1024 });
    let passed = false;
    const control = join(t.dir, "boundary-barrier");
    const offset = join(t.dir, "clock-offset");
    const boundaryTrace = join(t.dir, "boundary-trace.jsonl");
    const toolFile = join(t.dir, "tool-input.txt");
    writeFileSync(offset, "0");
    writeFileSync(toolFile, "Bounded sibling tool output.\n".repeat(100));
    writeFileSync(`${control}.release`, "seed\n");
    const args = scriptedArgs(t, ["-e", join(REPO_ROOT, "tests/e2e/harness/compaction-barrier.ts")])
      .map((arg) => arg === EXTENSION ? join(REPO_ROOT, "tests/e2e/harness/turn-boundary-extension.ts") : arg);
    const client = new RpcClient({ args, cwd: t.dir, logFile: t.logFile,
      env: piEnv(t, { DISTILL_TEST_CLOCK_OFFSET: offset, DISTILL_COMPACTION_BARRIER: control,
        DISTILL_TEST_BOUNDARY_TRACE: boundaryTrace,
        ...(scenario === "expired" ? { DISTILL_TEST_SETTLEMENT_CLOCK_SHIFT: "31001" } : {}),
        ...(scenario === "backward-clock" ? { DISTILL_TEST_SETTLEMENT_CLOCK_SHIFT: "-1000" } : {}),
        DISTILL_FAKE_BOUNDARY_FILE: toolFile, DISTILL_FAKE_BASE: "4000", DISTILL_FAKE_STEP: "500",
        DISTILL_FAKE_POST_COMPACTION_USAGE: "5000" }) });
    try {
      for (let turn = 0; turn < 3; turn++) {
        const since = client.mark();
        expect((await client.request({ type: "prompt", message: `Seed ${turn}. ` + "discarded context ".repeat(2000) })).success).toBe(true);
        await client.waitFor((event) => event.type === "agent_settled", 30_000, { since });
      }
      expect((await client.request({ type: "compact" }, 45_000)).success).toBe(true);
      await waitUntil(() => existsSync(`${control}.committed`));
      const session = latestSessionFile(t)!;
      const seed = records(session).filter((entry) => entry.type === "compaction");
      expect(seed).toHaveLength(1);
      assertCurrentCompaction(seed[0].summary, seed[0].details);
      const logFile = join(t.agentHome, "data", "dc-distill", "compact-log.jsonl");
      const baselineLogs = records(logFile).length;
      for (const suffix of ["prepared", "committed", "release"]) unlinkSync(`${control}.${suffix}`);
      // Advances the supported deterministic controller clock only. The seed
      // is a genuine valid host compaction, not a synthetic tokensAfter baseline.
      writeFileSync(offset, "121000");
      const since = client.mark();
      expect((await client.request({ type: "prompt", message: "RUN_BOUNDARY_BATCHES: complete four sibling read batches." })).success).toBe(true);
      await waitUntil(() => existsSync(`${control}.prepared`));
      const before = records(session);
      expect(before.filter((entry) => entry.type === "compaction")).toHaveLength(1);
      expect(records(logFile)).toHaveLength(baselineLogs);
      expect(before.filter(isContinuation)).toHaveLength(0);
      const batches = records(t.traceFile).filter((entry) => entry.kind === "batch");
      expect(batches.map((entry) => entry.batch)).toEqual([0, 1]); // no wait for natural four-batch completion
      expect(batches.every((entry) => entry.usageTotal < 183_616)).toBe(true); // native warn line
      const diagnostics = readFileSync(join(t.agentHome, "data", "dc-distill", "diag.log"), "utf8");
      expect(diagnostics).toContain("source=turn_end");
      expect(diagnostics).toContain("source=agent_settled");
      const observations = records(boundaryTrace);
      const abortIndex = observations.findIndex((entry) => entry.kind === "abort");
      const submissionIndex = observations.findIndex((entry, index) => index > abortIndex && entry.kind === "compact");
      expect(abortIndex).toBeGreaterThanOrEqual(0);
      expect(submissionIndex).toBeGreaterThan(abortIndex);
      expect(observations.filter((entry) => entry.kind === "abort")).toHaveLength(1);
      expect(observations.filter((entry) => entry.kind === "compact")).toHaveLength(1);
      const submission = observations[submissionIndex];
      const freshSamples = observations.slice(abortIndex + 1, submissionIndex)
        .filter((entry) => entry.kind === "getContextUsage" && entry.source === "agent_settled");
      expect(freshSamples.some((entry) => Number.isFinite(entry.tokens) && entry.tokens > 0
        && entry.leaf === submission.leaf)).toBe(true);
      if (scenario === "expired" || scenario === "backward-clock") {
        const shiftIndex = observations.findIndex((entry) => entry.kind === "settlement-clock-shift");
        expect(shiftIndex).toBeGreaterThan(abortIndex);
        expect(shiftIndex).toBeLessThan(submissionIndex);
        const age = submission.at - observations[abortIndex].at;
        if (scenario === "expired") expect(age).toBeGreaterThan(30_000);
        else expect(age).toBeLessThan(0);
      }
      if (mode !== "commit") expect((await client.request({ type: "abort" })).success).toBe(true);
      writeFileSync(`${control}.release`, "release\n");
      const end = await client.waitFor((event) => event.type === "compaction_end", 30_000, { since });
      if (mode === "commit") {
        expect(end.aborted).toBe(false);
        await waitUntil(() => records(session).some(isContinuation));
        await waitUntil(() => records(t.traceFile).some((entry) => entry.kind === "turn"
          && entry.lastText.includes("Context was compacted to free space.")));
        await waitUntil(() => {
          const journal = records(session);
          const delivery = journal.findIndex(isContinuation);
          return delivery >= 0 && journal.slice(delivery + 1).some((entry) => entry.message?.role === "assistant"
            && entry.message.stopReason !== "error" && entry.message.stopReason !== "aborted");
        });
      } else {
        expect(end.aborted).toBe(true);
        if (mode === "supersede") {
          const next = client.mark();
          expect((await client.request({ type: "prompt", message: "Superseding user request: acknowledge only." })).success).toBe(true);
          await client.waitFor((event) => event.type === "agent_settled", 30_000, { since: next });
        }
      }
      const ledger = records(session);
      const committed = ledger.filter((entry) => entry.type === "compaction");
      expect(committed).toHaveLength(mode === "commit" ? 2 : 1);
      const continuations = ledger.filter(isContinuation);
      expect(continuations).toHaveLength(mode === "commit" ? 1 : 0);
      expect(records(logFile)).toHaveLength(baselineLogs + (mode === "commit" ? 1 : 0));
      if (mode === "commit") {
        const current = committed[1];
        assertCurrentCompaction(current.summary, current.details);
        expect(current.details).toMatchObject({ version: 14, autonomous: true, checkpoint: { version: 2 } });
        expect(continuations[0].details.attemptId).toBe(current.details.attemptId);
        // The standard preparation hook must anchor after any aborted assistant.
        const parent = ledger.find((entry) => entry.id === current.parentId);
        expect(parent).toBeDefined();
        expect(current.parentId).toBe(submission.leaf);
      }
      const calls = new Map<string, number>();
      const results = new Map<string, number>();
      for (const entry of ledger) {
        for (const block of entry.message?.role === "assistant" ? entry.message.content : []) {
          if (block.type === "toolCall" && block.id.startsWith("boundary-")) calls.set(block.id, (calls.get(block.id) ?? 0) + 1);
        }
        if (entry.message?.role === "toolResult" && entry.message.toolCallId.startsWith("boundary-")) {
          results.set(entry.message.toolCallId, (results.get(entry.message.toolCallId) ?? 0) + 1);
        }
      }
      expect([...results].sort()).toEqual([...calls].sort());
      expect([...results.values()].every((count) => count === 1)).toBe(true);
      expect(records(t.traceFile).filter((entry) => entry.kind === "summary")).toHaveLength(0);
      // Invocation != actual work: an already-aborted next stream is permitted.
      expect(records(t.traceFile).filter((entry) => entry.kind === "batch")).toHaveLength(2);
      passed = true;
    } finally {
      writeFileSync(`${control}.release`, "cleanup\n");
      await client.close();
      await t.finalize(passed);
    }
  }, 60_000);
}
