/** Real Pi RPC cancellation and transactional commit; no live provider calls. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTestDir, piEnv, scriptedArgs, latestSessionFile, REPO_ROOT } from "./harness/env.ts";
import { RpcClient, eventsOfType } from "./harness/rpc-client.ts";

function records(file: string): Array<Record<string, any>> {
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for sandbox barrier");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Success artifact bytes, excluding diagnostic logs and initialization data. */
function successArtifacts(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(root)) return result;
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === "compact-log.jsonl" || entry.name === "recall.json"
        || /-(before\.jsonl|after\.txt)$/.test(entry.name)) result[path] = readFileSync(path, "utf8");
    }
  }
  walk(root);
  return result;
}

test("busy manual compaction aborts the turn, prepares without artifacts, and commits exactly once", async () => {
  const t = makeTestDir("busy-compaction", { keepRecentTokens: 1024 });
  let passed = false;
  try {
    const control = join(t.dir, "compaction-barrier");
    const data = join(t.agentHome, "data", "dc-distill");
    const heldText = "Hold this scripted turn until manual compaction aborts it.";
    const client = new RpcClient({
      args: scriptedArgs(t, ["-e", join(REPO_ROOT, "tests/e2e/harness/compaction-barrier.ts")]),
      cwd: t.dir, logFile: t.logFile,
      env: piEnv(t, { DISTILL_FAKE_HOLD_TEXT: heldText, DISTILL_COMPACTION_BARRIER: control,
        DISTILL_FAKE_BASE: "4000", DISTILL_FAKE_STEP: "500", DISTILL_FAKE_POST_COMPACTION_USAGE: "5000",
        DC_DISTILL_DUMPS: "1" }),
    });
    try {
      for (let turn = 1; turn <= 3; turn++) {
        const since = client.mark();
        expect((await client.request({ type: "prompt", message: `Busy compaction background ${turn}. ` + "discarded context ".repeat(2000) })).success).toBe(true);
        await client.waitFor((event) => event.type === "agent_settled", 30_000, { since });
      }
      const baseline = successArtifacts(data);
      const since = client.mark();
      expect((await client.request({ type: "prompt", message: heldText })).success).toBe(true);
      await waitUntil(() => records(t.traceFile).some((entry) => entry.lastText === heldText));
      expect(eventsOfType(client.events.slice(since), "agent_settled")).toHaveLength(0);
      const compact = client.request({ type: "compact" }, 45_000);
      await waitUntil(() => existsSync(`${control}.prepared`));
      const session = latestSessionFile(t)!;
      const before = records(session);
      expect(before.filter((entry) => entry.type === "compaction")).toHaveLength(0);
      expect(successArtifacts(data)).toEqual(baseline);
      expect(eventsOfType(client.events.slice(since), "compaction_end")).toHaveLength(0);
      const aborted = before.findLast((entry) => entry.type === "message" && entry.message?.role === "assistant");
      expect(aborted?.message.stopReason).toBe("aborted");
      expect(records(t.traceFile).filter((entry) => entry.kind === "held-abort")).toEqual([
        expect.objectContaining({ aborted: true }),
      ]);

      writeFileSync(`${control}.release`, "release\n");
      expect((await compact).success).toBe(true);
      const end = await client.waitFor((event) => event.type === "compaction_end", 30_000, { since });
      expect(end.aborted).toBe(false);
      const result = end.result as Record<string, any>;
      await waitUntil(() => existsSync(`${control}.committed`));
      const committed = JSON.parse(readFileSync(`${control}.committed`, "utf8"));
      const ledger = records(session);
      const compactions = ledger.filter((entry) => entry.type === "compaction");
      expect(compactions).toHaveLength(1);
      expect(compactions[0]).toEqual(committed);
      expect(ledger.indexOf(compactions[0])).toBeGreaterThan(ledger.findIndex((entry) => entry.id === aborted?.id));
      expect(committed.summary).toBe(result.summary);
      expect(committed.firstKeptEntryId).toBe(result.firstKeptEntryId);
      expect(committed.details).toEqual(result.details);
      expect(committed.details).toMatchObject({ compactor: "dc-distill", version: 9, autonomous: false });
      expect(committed.details.attemptId).toBeString();
      expect(committed.details.summaryDigest).toBe(createHash("sha256").update(committed.summary).digest("hex"));

      const artifacts = successArtifacts(data);
      const log = records(join(data, "compact-log.jsonl"));
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ tier: 1, strategy: "algorithmic",
        after: committed.details.tokensAfter, summaryLen: committed.summary.length,
        summaryHead: committed.summary.slice(0, 200) });
      const recalls = Object.entries(artifacts).filter(([path]) => path.endsWith("/recall.json"));
      expect(recalls).toHaveLength(1);
      const recall = JSON.parse(recalls[0]![1]);
      expect(recall).toHaveLength(1);
      expect(recall[0].summary).toBe(committed.summary);
      const dumps = Object.entries(artifacts).filter(([path]) => /-(before\.jsonl|after\.txt)$/.test(path));
      expect(dumps).toHaveLength(2);
      expect(dumps.find(([path]) => path.endsWith("-after.txt"))?.[1]).toBe(committed.summary);
      const canonicalInput = dumps.find(([path]) => path.endsWith("-before.jsonl"))![1];
      expect(createHash("sha256").update(canonicalInput).digest("hex")).toBe(committed.details.inputDigest);
      for (const [path] of dumps) expect(path).toContain(committed.details.attemptId.slice(0, 8));

      const next = client.mark();
      expect((await client.request({ type: "prompt", message: "Continue explicitly after busy compaction." })).success).toBe(true);
      await client.waitFor((event) => event.type === "agent_settled", 30_000, { since: next });
      const trace = records(t.traceFile);
      expect(trace.filter((entry) => entry.kind === "turn")).toHaveLength(5);
      expect(trace.filter((entry) => entry.kind === "summary")).toHaveLength(0);
      expect(trace.findLast((entry) => entry.kind === "turn")?.usageTotal).toBe(5000);
      expect(records(session).filter((entry) => entry.type === "compaction")).toHaveLength(1);
      expect(eventsOfType(client.events, "compaction_end")).toHaveLength(1);
      expect(client.events.some((event) => (event.message as any)?.customType === "dc-distill-continuation")).toBe(false);
      expect(successArtifacts(data)).toEqual(artifacts);
    } finally {
      writeFileSync(`${control}.release`, "cleanup\n");
      await client.close();
    }

    passed = true;
  } finally { await t.finalize(passed); }
}, 60_000);
