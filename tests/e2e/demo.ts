/**
 * Offline, human-readable demonstration of dc-distill's real-Pi manual
 * compaction lifecycle. It reuses the E2E RPC harness but is a runnable
 * artifact rather than a Bun test.
 */
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertCurrentCompaction } from "./harness/current-compaction.ts";
import { RpcClient, eventsOfType } from "./harness/rpc-client.ts";
import { latestSessionFile, makeTestDir, piEnv, scriptedArgs } from "./harness/env.ts";

function filler(i: number): string {
  return `Demo turn ${i}. DEMO-ANCHOR must survive compaction. `
    + `Background detail ${i}: ${"context material ".repeat(2000)}`;
}

function readJsonLines(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, "utf8").split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function fail(message: string): never {
  throw new Error(`dc-distill demo failed: ${message}`);
}

async function settle(client: RpcClient, since: number): Promise<void> {
  await client.waitFor((event) => event.type === "agent_settled", 60_000, { since });
}

async function main(): Promise<void> {
  const artifacts = makeTestDir("demo");
  let passed = false;
  try {
    const client = new RpcClient({
      args: scriptedArgs(artifacts),
      cwd: artifacts.dir,
      env: piEnv(artifacts, {
        DISTILL_FAKE_BASE: "3000",
        DISTILL_FAKE_STEP: "500",
        DISTILL_FAKE_WINDOW: "200000",
      }),
      logFile: artifacts.logFile,
    });

    try {
      for (let i = 1; i <= 4; i++) {
        const since = client.mark();
        const accepted = await client.request({ type: "prompt", message: filler(i) }, 60_000);
        if (accepted.success !== true) fail(`turn ${i} was rejected`);
        await settle(client, since);
      }

      const session = latestSessionFile(artifacts);
      if (!session) fail("Pi did not create a session ledger");
      const before = join(artifacts.dir, "before-compaction.jsonl");
      copyFileSync(session, before);

      const since = client.mark();
      const compact = await client.request({ type: "compact" }, 60_000);
      if (compact.success !== true) fail(`native compact command was rejected: ${String(compact.error ?? "unknown error")}`);
      const end = await client.waitFor(
        (event) => event.type === "compaction_end" && event.aborted === false,
        60_000,
        { since },
      );
      const details = (end.result as { details?: Record<string, unknown> } | undefined)?.details;
      if (details?.compactor !== "dc-distill") fail("Pi did not commit dc-distill details");
      if (details?.autonomous !== false) fail("manual demo unexpectedly queued autonomous continuation");

      const after = join(artifacts.dir, "after-compaction.jsonl");
      copyFileSync(session, after);
      const compactEntries = readJsonLines(after).filter(
        (entry) => entry.type === "compaction"
          && (entry.details as { compactor?: unknown } | undefined)?.compactor === "dc-distill",
      );
      if (compactEntries.length !== 1) fail(`expected one extension-owned ledger entry, found ${compactEntries.length}`);
      const committed = compactEntries[0]!;
      const committedDetails = committed.details as Record<string, unknown>;
      assertCurrentCompaction(committed.summary, committedDetails);
      const result = end.result as { summary?: unknown; details?: unknown };
      assertCurrentCompaction(result.summary, result.details);
      if (typeof committed.summary !== "string") fail("committed wire summary is missing");
      if (/\best\s*→.*\btokens\s*\([^\n]*% reduction\)|^Shrunk:/m.test(committed.summary)) {
        fail("committed wire summary contains a model-facing metric line");
      }
      const conversation = committed.summary.match(/## Conversation\n([\s\S]*?)(?=\n<(?:[a-z][a-z-]*)[>\s]|$)/)?.[1] ?? "";
      if (!conversation.includes("DEMO-ANCHOR must survive compaction.")) fail("conversation lost the exact demo request clause");
      // Native user text is source identity, not assistant background noise:
      // retain its exact excerpt and identify omitted source rather than demand
      // counted-repetition rewriting of potentially pinnable user bytes.
      if (!conversation.includes("context material context material")) fail("conversation lost the original native-user repetition excerpt");
      if (!/\[omitted source code points \d+\.\.\d+\]/.test(conversation)) fail("conversation did not disclose source-excerpt clipping");

      const requests = readJsonLines(artifacts.traceFile);
      const summaryRequests = requests.filter((entry) => entry.kind === "summary");
      if (summaryRequests.length !== 0) fail(`host requested ${summaryRequests.length} provider summaries`);
      const agentRuns = eventsOfType(client.events, "agent_start").length;
      if (requests.length !== agentRuns) {
        fail(`provider received ${requests.length} requests for ${agentRuns} agent runs`);
      }

      console.log("dc-distill scripted lifecycle demo: PASS");
      console.log(`Artifacts: ${artifacts.dir}`);
      console.log("  before-compaction.jsonl");
      console.log("  after-compaction.jsonl");
      console.log("  rpc.log");
      console.log("  provider-trace.jsonl");
      console.log(`Provider requests: ${requests.length}; summarizer requests: ${summaryRequests.length}`);
      console.log("Compaction: one v14 ledger entry; validated schema-v2 checkpoint, exact digests and 17-section ledger; metric-free manual lifecycle; original native-user excerpt, explicit source omission and exact request clause.");
    } finally {
      await client.close();
    }
    passed = true;
  } finally { await artifacts.finalize(passed); }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
