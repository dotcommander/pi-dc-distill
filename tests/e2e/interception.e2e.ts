/** Real-host spies for native automatic interception; no autonomous cooldown wait. */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { RpcClient, eventsOfType } from "./harness/rpc-client.ts";
import { makeTestDir, piEnv, scriptedArgs, latestSessionFile } from "./harness/env.ts";

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
        expect(result.details?.autonomous).toBe(false);
        expect(result.summary).not.toContain("FAKE-SUMMARY");

        // Include ALL compaction entries so a default or duplicate append cannot hide.
        const session = latestSessionFile(t)!;
        const committed = records(session).filter((entry) => entry.type === "compaction");
        expect(committed).toHaveLength(1);
        expect(committed[0]?.details?.compactor).toBe("dc-distill");
        expect(committed[0]?.details?.attemptId).toBe(result.details?.attemptId);

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
