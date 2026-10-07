/** Real installed-host lifecycle, using only the isolated local scripted provider. */
import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { RpcClient, eventsOfType } from "./harness/rpc-client.ts";
import { makeTestDir, piEnv, scriptedArgs, latestSessionFile, type TestDir } from "./harness/env.ts";
import { assertCurrentCompaction } from "./harness/current-compaction.ts";

export function records(file: string): Array<Record<string, any>> {
  return readFileSync(file, "utf8").split("\n").filter(line => line.trim()).map(line => JSON.parse(line));
}
function walk(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? walk(join(dir, entry.name)) : [join(dir, entry.name)]) : [];
}
export function assertNoDistillArtifacts(t: TestDir, client: RpcClient): void {
  // Pi owns sessions/settings. The extension has no storage surface anywhere in this sandbox.
  const files = walk(t.dir);
  expect(files.filter(path => /(?:recall\.json|compact-log\.jsonl|diag\.log|(?:before|after)-dump|tool-output)/.test(path))).toEqual([]);
  expect(files.filter(path => path.includes("/data/dc-distill/"))).toEqual([]);
  expect(client.events.some(event => (event.message as any)?.customType === "dc-distill-continuation")).toBe(false);
}
async function prompt(client: RpcClient, message: string): Promise<void> {
  const since = client.mark();
  expect((await client.request({ type: "prompt", message })).success).toBe(true);
  await client.waitFor(event => event.type === "agent_settled", 30000, { since });
}

test("manual compaction and repeated predecessor carry use one flat current contract", async () => {
  const t = makeTestDir("manual", { keepRecentTokens: 1024 });
  let passed = false;
  try {
    const client = new RpcClient({ args: scriptedArgs(t), cwd: t.dir, logFile: t.logFile,
      env: piEnv(t, { DISTILL_FAKE_BASE: "3000", DISTILL_FAKE_STEP: "500", DISTILL_FAKE_WINDOW: "200000" }) });
    try {
      for (let i = 1; i <= 3; i++) await prompt(client,
        `Request ${i}: preserve useful excerpts 😀. ` + "discardable context material ".repeat(2000));
      const since = client.mark();
      const response = await client.request({ type: "compact", customInstructions: "Focus on useful excerpts 😀" });
      expect(response.success).toBe(true);
      const end = await client.waitFor(event => event.type === "compaction_end" && event.aborted === false,
        30000, { since });
      const result = end.result as Record<string, any>;
      const first = assertCurrentCompaction(result.summary, result.details);
      expect(first.focus).toBe("Focus on useful excerpts 😀");
      expect(first.latestRequest?.origin).toBe("current");
      expect(first.latestRequest?.text).toMatch(/Request [12]:/);
      const session = latestSessionFile(t)!;
      const committed = records(session).filter(entry => entry.type === "compaction");
      expect(committed).toHaveLength(1);
      expect(committed[0]?.summary).toBe(result.summary);
      expect(committed[0]?.details).toEqual(result.details);
      expect((response.data as any)?.details).toEqual(result.details);

      for (let i = 4; i <= 6; i++) await prompt(client,
        `Request ${i}: follow the next native user instruction. ` + "new discardable context ".repeat(2000));
      const nextSince = client.mark();
      expect((await client.request({ type: "compact" })).success).toBe(true);
      const nextEnd = await client.waitFor(event => event.type === "compaction_end" && event.aborted === false,
        30000, { since: nextSince });
      const next = nextEnd.result as Record<string, any>;
      const carried = assertCurrentCompaction(next.summary, next.details);
      expect(carried.focus).toBeNull();
      expect(carried.latestRequest?.text).toMatch(/Request [45]:/);
      expect(carried.latestRequest?.origin).toBe("current");
      expect(carried.records.some((row: any) => row.origin === "prior")).toBe(true);
      expect(carried.records.every((row: any) => !row.text.includes('"format":"dc-distill-summary"'))).toBe(true);
      expect(records(session).filter(entry => entry.type === "compaction")).toHaveLength(2);
      expect(records(t.traceFile).filter(entry => entry.kind === "summary")).toEqual([]);
      expect(records(t.traceFile)).toHaveLength(eventsOfType(client.events, "agent_start").length);
      assertNoDistillArtifacts(t, client);
      const commands = await client.request({ type: "get_commands" });
      expect(commands.success).toBe(true);
      expect(JSON.stringify(commands.data)).not.toContain("dc-distill");
      await prompt(client, "Continue from the compacted session.");
      assertNoDistillArtifacts(t, client);
    } finally { await client.close(); }
    passed = true;
  } finally { await t.finalize(passed); }
}, 120000);

// The older host locates a committed callback by the first equal summary in its
// full journal. This new branch intentionally reproduces that stale callback.
test("byte-identical abandoned sibling summary does not hide the new active commit", async () => {
  const t = makeTestDir("summary-collision", { keepRecentTokens: 1024 });
  let passed = false;
  try {
    const { seedSummaryCollision, collisionEnv, COLLISION_FOCUS, COMMIT_OBSERVER, readRecords } =
      await import("./harness/summary-collision.ts");
    const { session, abandoned, sibling } = await seedSummaryCollision(t);
    const telemetry = join(t.dir, "collision-observer.jsonl");
    const client = new RpcClient({ args: scriptedArgs(t, ["-e", COMMIT_OBSERVER], { session }),
      cwd: t.dir, logFile: t.logFile, env: collisionEnv(t, telemetry) });
    try {
      const since = client.mark();
      expect((await client.request({ type: "compact", customInstructions: COLLISION_FOCUS })).success).toBe(true);
      await client.waitFor(event => event.type === "compaction_end" && event.aborted === false,
        30000, { since });
      const compactions = readRecords(session).filter(entry => entry.type === "compaction");
      expect(compactions).toHaveLength(2);
      const current = compactions[1]!;
      assertCurrentCompaction(current.summary, current.details);
      expect(current.summary).toBe(abandoned.summary);
      expect(current.parentId).toBe(sibling);
      expect(current.details.attemptId).not.toBe(abandoned.details.attemptId);
      const callbacks = readRecords(telemetry).filter(row => row.kind === "commit");
      expect(callbacks).toHaveLength(1);
      expect(callbacks[0]?.fromExtension).toBe(true);
      expect(callbacks[0]?.sameSummary).toBe(true);
      expect(callbacks[0]?.newestId).toBe(current.id);
      expect(callbacks[0]?.newestAttempt).toBe(current.details.attemptId);
      // Both host implementations are valid: the historical callback must name
      // the abandoned entry; a fixed host may directly name the actual commit.
      expect([abandoned.id, current.id]).toContain(callbacks[0]?.eventId);
      expect(callbacks[0]?.eventAttempt).toBe(callbacks[0]?.eventId === abandoned.id
        ? abandoned.details.attemptId : current.details.attemptId);
      // Pi exposes its RPC UI bridge as hasUI:true. Observe the real notify
      // invocation independently; RPC telemetry does not prove rendered text.
      expect(callbacks[0]?.hasUI).toBe(true);
      const notifications = readRecords(telemetry).filter(row => row.kind === "notify");
      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.hasUI).toBe(true);
      expect(notifications[0]?.type).toBe("info");
      expect(notifications[0]?.message).toBe(
        `dc-distill compacted context to approximately ${current.details.tokensAfter} tokens.`);
      expect(readRecords(t.traceFile).filter(row => row.kind === "summary")).toEqual([]);
      assertNoDistillArtifacts(t, client);
    } finally { await client.close(); }
    passed = true;
  } finally { await t.finalize(passed); }
}, 120000);
