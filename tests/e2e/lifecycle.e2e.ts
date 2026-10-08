/** Real installed-host lifecycle, using only the isolated local scripted provider. */
import { readRecords as records, hostRecord, object } from "./harness/records.ts";
import { expect, test } from "bun:test";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RpcClient, eventsOfType } from "./harness/rpc-client.ts";
import { makeTestDir, piEnv, scriptedArgs, latestSessionFile, REPO_ROOT, type TestDir } from "./harness/env.ts";
import { assertCurrentCompaction } from "./harness/current-compaction.ts";

function walk(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? walk(join(dir, entry.name)) : [join(dir, entry.name)]) : [];
}
export function assertNoDistillArtifacts(t: TestDir, client: RpcClient): void {
  // Pi owns sessions/settings. The extension has no storage surface anywhere in this sandbox.
  const files = walk(t.dir);
  expect(files.filter(path => /(?:recall\.json|compact-log\.jsonl|diag\.log|(?:before|after)-dump|tool-output)/.test(path))).toEqual([]);
  expect(files.filter(path => path.includes("/data/dc-distill/"))).toEqual([]);
  expect(client.events.some(event => (event.message === undefined ? undefined : object(event.message).customType) === "dc-distill-continuation")).toBe(false);
}
async function prompt(client: RpcClient, message: string): Promise<void> {
  const since = client.mark();
  expect((await client.request({ type: "prompt", message })).success).toBe(true);
  await client.waitFor(event => event.type === "agent_settled", 30000, { since });
}

test("manual compaction and repeated predecessor carry use one flat current contract", async () => {
  // Keep the native tail small enough to create a real cut with short requests;
  // the two summaries can then demonstrate carry without excerpt pressure.
  const t = makeTestDir("manual", { keepRecentTokens: 128 });
  let passed = false;
  try {
    const client = new RpcClient({ args: scriptedArgs(t), cwd: t.dir, logFile: t.logFile,
      env: piEnv(t, { DISTILL_FAKE_BASE: "3000", DISTILL_FAKE_STEP: "500", DISTILL_FAKE_WINDOW: "200000" }) });
    try {
      for (let i = 1; i <= 3; i++) await prompt(client,
        `Request ${i}: preserve useful excerpts 😀. ` + "discardable context material ".repeat(20));
      const since = client.mark();
      const response = await client.request({ type: "compact", customInstructions: "Focus on useful excerpts 😀" });
      expect(response.success).toBe(true);
      const end = await client.waitFor(event => event.type === "compaction_end" && event.aborted === false,
        30000, { since });
      const result = hostRecord(end.result);
      const first = assertCurrentCompaction(result.summary, result.details);
      expect(first.focus).toEqual({ text: "Focus on useful excerpts 😀", shortened: false });
      expect(first.latestRequest?.origin).toBe("current");
      expect(first.latestRequest?.text).toMatch(/Request [12]:/);
      expect(first.omitted?.excerpts).toBe(0);
      const session = latestSessionFile(t)!;
      const committed = records(session).filter(entry => entry.type === "compaction");
      expect(committed).toHaveLength(1);
      expect(committed[0]?.summary).toBe(result.summary);
      expect(committed[0]?.details).toEqual(result.details);
      expect(object(response.data).details).toEqual(result.details);

      for (let i = 4; i <= 6; i++) await prompt(client,
        `Request ${i}: follow the next native user instruction. ` + "new discardable context ".repeat(20));
      const nextSince = client.mark();
      expect((await client.request({ type: "compact" })).success).toBe(true);
      const nextEnd = await client.waitFor(event => event.type === "compaction_end" && event.aborted === false,
        30000, { since: nextSince });
      const next = hostRecord(nextEnd.result);
      const carried = assertCurrentCompaction(next.summary, next.details);
      expect(carried.focus).toBeNull();
      expect(carried.latestRequest?.text).toMatch(/Request [45]:/);
      expect(carried.latestRequest?.origin).toBe("current");
      expect(carried.omitted?.excerpts).toBe(0);
      expect(carried.records.some((row) => row.origin === "prior")).toBe(true);
      expect(carried.records.filter(row => row.kind === "user" && row.origin === "prior" && row.text === first.latestRequest?.text)).toHaveLength(1);
      expect(carried.records.every((row) => !row.text.includes('"format":"dc-distill-summary"'))).toBe(true);
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

// Journal identities and parentage identify the new active commit independently
// of hosts that report the first historical entry with equal summary bytes.
test("byte-identical abandoned sibling summary does not hide the new active commit", async () => {
  const t = makeTestDir("summary-collision", { keepRecentTokens: 1024 });
  let passed = false;
  try {
    const { seedSummaryCollision, collisionEnv, COLLISION_FOCUS, readRecords } =
      await import("./harness/summary-collision.ts");
    const { session, abandoned, sibling } = await seedSummaryCollision(t);
    const client = new RpcClient({ args: scriptedArgs(t, [], { session }),
      cwd: t.dir, logFile: t.logFile, env: collisionEnv(t) });
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
      expect(current.id).not.toBe(abandoned.id);
      const journal = readRecords(session);
      expect(journal.at(-1)?.id).toBe(current.id);
      const byId = new Map(journal.map(entry => [entry.id, entry]));
      const activeIds = new Set<string>();
      let entry = journal.at(-1);
      while (entry && typeof entry.id === "string") {
        expect(activeIds.has(entry.id)).toBe(false);
        activeIds.add(entry.id);
        entry = byId.get(entry.parentId);
      }
      if (typeof current.id !== "string" || typeof abandoned.id !== "string") throw new Error("Missing compaction identity");
      expect(activeIds.has(current.id)).toBe(true);
      expect(activeIds.has(sibling)).toBe(true);
      expect(activeIds.has(abandoned.id)).toBe(false);
      expect(readRecords(t.traceFile).filter(row => row.kind === "summary")).toEqual([]);
      assertNoDistillArtifacts(t, client);
    } finally { await client.close(); }
    passed = true;
  } finally { await t.finalize(passed); }
}, 120000);

// A cancelled or failed native boundary must invalidate pending preparation
// without making the still-current runtime adopt or reject its owner.
for (const boundary of ["cancel-switch", "cancel-fork", "failed-switch", "failed-fork", "new-parent", "fork"] as const) {
  test(`native lifecycle ${boundary} retains usable deterministic compaction`, async () => {
    const t = makeTestDir(`lifecycle-${boundary}`, { enabled: false, keepRecentTokens: 1024 });
    let passed = false;
    try {
      const args = scriptedArgs(t, ["-e", join(REPO_ROOT, "tests/e2e/harness/lifecycle-fault.ts")]);
      const client = new RpcClient({ args, cwd: t.dir, logFile: t.logFile, env: piEnv(t, {
        DISTILL_FAKE_BASE: "3000", DISTILL_FAKE_STEP: "500", DISTILL_FAKE_WINDOW: "200000",
        DISTILL_LIFECYCLE_FAULT: boundary === "cancel-switch" ? "switch" : boundary === "cancel-fork" ? "fork" : "",
      }) });
      try {
        for (let i = 0; i < 3; i++) await prompt(client, `Lifecycle original turn ${i}. ` + "discardable context ".repeat(2000));
        const original = latestSessionFile(t);
        if (!original) throw new Error("Missing native original session");
        const forks = object((await client.request({ type: "get_fork_messages" })).data).messages;
        if (!Array.isArray(forks) || !forks.length) throw new Error("Missing native fork candidates");
        const entryId = object(forks[0]).entryId;
        if (typeof entryId !== "string") throw new Error("Missing native fork entry identity");
        if (boundary === "cancel-switch") {
          const response = await client.request({ type: "new_session" });
          expect(response.success).toBe(true);
          expect(object(response.data).cancelled).toBe(true);
        } else if (boundary === "cancel-fork") {
          const response = await client.request({ type: "fork", entryId });
          expect(response.success).toBe(true);
          expect(object(response.data).cancelled).toBe(true);
        } else if (boundary === "failed-switch") {
          const failedSession = join(t.dir, "invalid-cwd-session.jsonl");
          writeFileSync(failedSession, records(original).map(entry => JSON.stringify(entry.type === "session"
            ? { ...entry, cwd: join(t.dir, "missing-cwd") } : entry)).join("\n") + "\n");
          expect((await client.request({ type: "switch_session", sessionPath: failedSession })).success).toBe(false);
        } else if (boundary === "failed-fork") {
          expect((await client.request({ type: "fork", entryId: "missing-entry" })).success).toBe(false);
        } else {
          const response = boundary === "new-parent"
            ? await client.request({ type: "new_session", parentSession: original })
            : await client.request({ type: "fork", entryId });
          expect(response.success).toBe(true);
          expect(object(response.data).cancelled).toBe(false);
        }
        for (let i = 0; i < 3; i++) await prompt(client, `Lifecycle continued turn ${i}. ` + "discardable context ".repeat(2000));
        const since = client.mark();
        expect((await client.request({ type: "compact" })).success).toBe(true);
        const end = await client.waitFor(event => event.type === "compaction_end" && event.aborted === false, 30000, { since });
        const result = hostRecord(end.result);
        assertCurrentCompaction(result.summary, result.details);
        expect(records(t.traceFile).filter(entry => entry.kind === "summary")).toEqual([]);
        const journals = walk(t.sessionDir).filter(path => path.endsWith(".jsonl"));
        const commits = journals.flatMap(records).filter(entry => entry.type === "compaction");
        expect(commits).toHaveLength(1);
        assertCurrentCompaction(commits[0]?.summary, commits[0]?.details);
        if (boundary === "new-parent" || boundary === "fork") {
          expect(journals.flatMap(records).some(entry => entry.type === "session" && entry.parentSession === original)).toBe(true);
        }
        await prompt(client, "Continue after lifecycle compaction.");
        assertNoDistillArtifacts(t, client);
      } finally { await client.close(); }
      passed = true;
    } finally { await t.finalize(passed); }
  }, 120000);
}
