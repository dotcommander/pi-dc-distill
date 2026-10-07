/** Real-host spies for native automatic interception; no autonomous cooldown wait. */
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RpcClient, eventsOfType } from "./harness/rpc-client.ts";
import { assertCurrentCompaction } from "./harness/current-compaction.ts";
import { makeTestDir, piEnv, scriptedArgs, latestSessionFile, REPO_ROOT } from "./harness/env.ts";

function records(file: string): Array<Record<string, any>> {
  return readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
}

for (const scenario of [
  { reason: "threshold", step: "186000", usage: 190000, retry: false },
  { reason: "overflow", step: "198000", usage: 202000, retry: false },
  { reason: "overflow", step: "198000", usage: 202000, retry: true },
] as const) {
  test(`native ${scenario.reason}${scenario.retry ? " error retry" : ""} uses only dc-distill, without an LLM summary request`, async () => {
    const t = makeTestDir(`interception-${scenario.reason}${scenario.retry ? "-error-retry" : ""}`, { keepRecentTokens: 1024 });
    let passed = false;
    try {
      const client = new RpcClient({
        args: scriptedArgs(t), cwd: t.dir, logFile: t.logFile,
        env: piEnv(t, {
          DISTILL_FAKE_WINDOW: "200000", DISTILL_FAKE_BASE: "4000",
          DISTILL_FAKE_OVERFLOW_ERROR: scenario.retry ? "1" : "0",
          DISTILL_FAKE_STEP: scenario.step, DISTILL_FAKE_POST_COMPACTION_USAGE: "5000",
        }),
      });
      try {
        for (let i = 1; i <= 2; i++) {
          const since = client.mark();
          const response = await client.request({ type: "prompt", message:
            `TASK-13 native interception turn ${i}. ` + "discardable background material ".repeat(2000) });
          expect(response.success).toBe(true);
          await client.waitFor((event) => event.type === "agent_settled", 30000, { since });
        }
        const ends = eventsOfType(client.events, "compaction_end");
        expect(ends).toHaveLength(1);
        expect(ends[0]?.reason).toBe(scenario.reason);
        expect(ends[0]?.aborted).toBe(false);
        expect(ends[0]?.willRetry).toBe(scenario.retry);
        const result = ends[0]?.result as Record<string, any>;
        expect(result.details?.compactor).toBe("dc-distill");
        assertCurrentCompaction(result.summary, result.details);
        expect(result.summary).not.toContain("FAKE-SUMMARY");

        // Include ALL compaction entries so a default or duplicate append cannot hide.
        const session = latestSessionFile(t)!;
        const committed = records(session).filter((entry) => entry.type === "compaction");
        expect(committed).toHaveLength(1);
        expect(committed[0]?.details?.compactor).toBe("dc-distill");
        expect(committed[0]?.details?.attemptId).toBe(result.details?.attemptId);
        assertCurrentCompaction(committed[0]?.summary, committed[0]?.details);
        expect(existsSync(join(t.agentHome, "data", "dc-distill"))).toBe(false);

        // The real converted native summary drives the fake provider's low usage.
        const since = client.mark();
        expect((await client.request({ type: "prompt", message: "Continue TASK-13 after compaction." })).success).toBe(true);
        await client.waitFor((event) => event.type === "agent_settled", 30000, { since });
        const trace = records(t.traceFile);
        expect(trace.filter((request) => request.kind === "summary")).toHaveLength(0);
        expect(trace.filter((request) => request.kind === "turn")).toHaveLength(scenario.retry ? 4 : 3);
        expect(trace.map((request) => request.usageTotal)).toEqual(scenario.retry ? [4000, scenario.usage, 5000, 5000] : [4000, scenario.usage, 5000]);
        expect(trace).toHaveLength(eventsOfType(client.events, "agent_start").length);
        expect(eventsOfType(client.events, "compaction_end")).toHaveLength(1);
        expect(records(session).filter((entry) => entry.type === "compaction")).toHaveLength(1);
      } finally {
        await client.close();
      }

      passed = true;
    } finally { await t.finalize(passed); }
  }, 60000);
}

// Mutate the host preparation before dc-distill runs. Unlike a throwing hook,
// this exercises dc-distill's own catch/cancel boundary rather than Pi's
// extension-error fallback behavior.
for (const fault of ["previous-summary", "discarded-partition", "unicode"] as const) {
  test(`preparation fault ${fault} cancels without default summarization or success artifacts`, async () => {
    const t = makeTestDir(`preparation-${fault}`, { keepRecentTokens: 1024 });
    let passed = false;
    try {
      const args = scriptedArgs(t);
      args.splice(args.indexOf("-e"), 0, "-e", join(REPO_ROOT, "tests/e2e/harness/preparation-fault.ts"));
      const client = new RpcClient({ args, cwd: t.dir, logFile: t.logFile,
        env: piEnv(t, { DISTILL_PREPARATION_FAULT: fault, DISTILL_FAKE_BASE: "4000", DISTILL_FAKE_STEP: "500" }) });
      try {
        for (let i = 0; i < 3; i++) {
          const since = client.mark();
          expect((await client.request({ type: "prompt", message: `TASK-13 turn ${i}. ` + "source material ".repeat(3000) })).success).toBe(true);
          await client.waitFor((event) => event.type === "agent_settled", 30000, { since });
        }
        const compact = await client.request({ type: "compact" }, 30000);
        expect(compact.success).toBe(false);
        expect(records(t.traceFile).filter((entry) => entry.kind === "summary")).toHaveLength(0);
        expect(records(latestSessionFile(t)!).filter((entry) => entry.type === "compaction")).toHaveLength(0);
        expect(eventsOfType(client.events, "compaction_end").every((event) => event.aborted === true)).toBe(true);
        expect(existsSync(join(t.agentHome, "data", "dc-distill"))).toBe(false);
        expect(client.events.some((event) => (event.message as any)?.customType === "dc-distill-continuation")).toBe(false);
        // A cancelled attempt must still leave a usable native session.
        const since = client.mark();
        expect((await client.request({ type: "prompt", message: "Proceed with the user request after cancelled preparation." })).success).toBe(true);
        await client.waitFor((event) => event.type === "agent_settled", 30000, { since });
        expect(records(t.traceFile).filter((entry) => entry.kind === "summary")).toHaveLength(0);
      } finally { await client.close(); }
      passed = true;
    } finally { await t.finalize(passed); }
  }, 60000);
}

// The retained native user message alone exceeds this deliberately small window.
// The extension must cancel after whole-row eviction cannot fit mandatory context.
test("known capacity failure cancels without provider fallback or append", async () => {
  const t = makeTestDir("capacity-failure", { enabled: false, keepRecentTokens: 1024 });
  let passed = false;
  try {
    const client = new RpcClient({ args: scriptedArgs(t), cwd: t.dir, logFile: t.logFile,
      env: piEnv(t, { DISTILL_FAKE_WINDOW: "4096", DISTILL_FAKE_BASE: "1000", DISTILL_FAKE_STEP: "100" }) });
    try {
      for (let i = 0; i < 3; i++) {
        const since = client.mark();
        expect((await client.request({ type: "prompt", message: `Large retained user turn ${i}: `
          + "mandatory native retained tail ".repeat(3000) })).success).toBe(true);
        await client.waitFor(event => event.type === "agent_settled", 30000, { since });
      }
      expect((await client.request({ type: "compact", customInstructions: "Preserve native retained context" })).success).toBe(false);
      expect(records(t.traceFile).filter(entry => entry.kind === "summary")).toEqual([]);
      expect(records(latestSessionFile(t)!).filter(entry => entry.type === "compaction")).toEqual([]);
      expect(existsSync(join(t.agentHome, "data", "dc-distill"))).toBe(false);
    } finally { await client.close(); }
    passed = true;
  } finally { await t.finalize(passed); }
}, 60000);
