/**
 * Deterministic end-to-end lifecycle through the real CLI (`pi --mode rpc`)
 * with the scripted provider:
 *
 *   A. manual deterministic compaction — one extension-owned append, focus
 *      preserved, zero provider summary requests, no continuation;
 *   B. autonomous trigger/commit — thresholds crossed through real reported
 *      usage, compaction fires at the agent_settled boundary while idle,
 *      durable continuation delivered exactly once and answered;
 *   C. restart continuation recovery — a ledger truncated mid-lifecycle
 *      (crash simulation) redelivers or nudges the continuation on startup.
 */
import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RpcClient, eventsOfType, messageText, type RpcEvent } from "./harness/rpc-client.ts";
import { makeTestDir, piEnv, scriptedArgs, latestSessionFile, type TestDir } from "./harness/env.ts";

import { assertCurrentCompaction } from "./harness/current-compaction.ts";

const CONTINUATION = "dc-distill-continuation";

interface CompactionDetails {
  compactor?: string;
  version?: number;
  attemptId?: string;
  autonomous?: boolean;
}

function continuationMessages(events: RpcEvent[]): Array<{ event: RpcEvent; message: Record<string, any> }> {
  return eventsOfType(events, "message_end")
    .filter((e) => (e.message as { customType?: string })?.customType === CONTINUATION)
    .map((e) => ({ event: e, message: e.message as Record<string, any> }));
}

function providerTrace(t: TestDir): Array<Record<string, any>> {
  try {
    return readFileSync(t.traceFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

/** dc-distill compaction entries in a session ledger. */
function ledgerCompactions(file: string | undefined): Array<Record<string, any>> {
  if (!file) return [];
  return readFileSync(file, "utf8").split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, any>;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, any> =>
      entry?.type === "compaction" && entry?.details?.compactor === "dc-distill");
}

async function settle(client: RpcClient, since: number): Promise<void> {
  await client.waitFor((e) => e.type === "agent_settled", 60_000, { since });
}

function filler(i: number): string {
  // ~8k tokens per turn so manual compaction has discarded context beyond
  // Pi's keep-recent window.
  return `Filler turn ${i}. TASK-13 must survive compaction. `
    + `Background detail ${i}: ${"context material ".repeat(2000)}`;
}

describe("dc-distill real-Pi lifecycle", () => {
  test("A: manual /compact is deterministic, local, and continuation-free", async () => {
    const t = makeTestDir("manual");
    let passed = false;
    try {
      const client = new RpcClient({
        args: scriptedArgs(t),
        cwd: t.dir,
        env: piEnv(t, {
          DISTILL_FAKE_BASE: "3000",
          DISTILL_FAKE_STEP: "500",
          DISTILL_FAKE_WINDOW: "200000",
        }),
        logFile: t.logFile,
      });
      try {
        for (let i = 1; i <= 4; i++) {
          const since = client.mark();
          const accepted = await client.request({ type: "prompt", message: filler(i) }, 60_000);
          expect(accepted.success).toBe(true);
          await settle(client, since);
        }

        const since = client.mark();
        const compactResponsePromise = client.request(
          { type: "compact", customInstructions: "preserve TASK-13" },
          120_000,
        );
        const end = await client.waitFor(
          (e) => e.type === "compaction_end" && e.aborted === false,
          60_000,
          { since },
        );
        const compactResponse = await compactResponsePromise;
        expect(compactResponse.success).toBe(true);
        const inlineDetails = ((compactResponse.data as { details?: CompactionDetails }) ?? {}).details;
        expect(inlineDetails?.compactor).toBe("dc-distill");

        const result = end.result as { summary?: string; details?: CompactionDetails };
        expect(result.details?.compactor).toBe("dc-distill");
        assertCurrentCompaction(result.summary, result.details);
        expect(result.summary).not.toMatch(/^_.*(?:→|tokens|reduction).*_\n/);
        expect(result.details?.autonomous).toBe(false);
        expect(result.summary).toContain("TASK-13");

        // Exactly one extension-owned compaction entry exists in the ledger,
        // and it is the one this attempt produced.
        const committed = ledgerCompactions(latestSessionFile(t));
        expect(committed).toHaveLength(1);
        expect(committed[0]?.details?.attemptId).toBe(result.details?.attemptId);
        expect(committed[0]?.summary).toBe(result.summary);
        expect(committed[0]?.details).toEqual(result.details);
        assertCurrentCompaction(committed[0]?.summary, committed[0]?.details);

        // The provider saw exactly one request per agent run — no host-side
        // LLM summarizer fallback ever ran.
        expect(providerTrace(t)).toHaveLength(
          eventsOfType(client.events, "agent_start").length,
        );
        expect(result.summary).not.toContain("FAKE-SUMMARY");

        // Manual compaction never queues a continuation; give one a chance.
        await new Promise((r) => setTimeout(r, 750));
        expect(continuationMessages(client.events)).toEqual([]);

        // Contract: dc-distill registers no RPC command — an unknown command
        // type must be rejected, while the native compact command worked above.
        const probe = await client.request({ type: "compact-status" }, 30_000);
        expect(probe.success).toBe(false);
      } finally {
        await client.close();
      }

      passed = true;
    } finally { await t.finalize(passed); }
  }, 120_000);

  test(
    "B: autonomous threshold compaction commits and delivers continuation once",
    async () => {
    const t = makeTestDir("autonomous", { keepRecentTokens: 1024 });
    let passed = false;
    try {
      // A trustworthy branch without a compaction can skip the synthetic
      // startup cooldown. Seed a genuine recent compaction and restart so this
      // scenario exercises the restored real 120-second cooldown instead.
      const seed = new RpcClient({ args: scriptedArgs(t), cwd: t.dir,
        env: piEnv(t, { DISTILL_FAKE_BASE: "4000", DISTILL_FAKE_STEP: "500" }),
        logFile: join(t.dir, "seed.log") });
      try {
        for (let i = 1; i <= 4; i++) {
          const since = seed.mark();
          expect((await seed.request({ type: "prompt", message: filler(i) })).success).toBe(true);
          await settle(seed, since);
        }
        const since = seed.mark();
        expect((await seed.request({ type: "compact" })).success).toBe(true);
        const end = await seed.waitFor((e) => e.type === "compaction_end" && e.aborted === false,
          60_000, { since });
        const result = end.result as { summary?: unknown; details?: unknown };
        assertCurrentCompaction(result.summary, result.details);
      } finally { await seed.close(); }
      const session = latestSessionFile(t);
      expect(session).toBeDefined();
      const seedCompactions = ledgerCompactions(session);
      expect(seedCompactions).toHaveLength(1);
      const seedTraceCount = providerTrace(t).length;
      const seedLogCount = readFileSync(join(t.agentHome, "data", "dc-distill", "compact-log.jsonl"), "utf8")
        .trim().split("\n").length;
      // auto = min(120000, (200000-16384)-20000) = 120000. The small
      // retained tail keeps six growth samples below the native warn boundary.
      const spawnedAt = Date.now();
      const client = new RpcClient({
        args: scriptedArgs(t, [], { session }),
        cwd: t.dir,
        env: piEnv(t, {
          DISTILL_FAKE_BASE: "4000",
          DISTILL_FAKE_STEP: "25000",
          DISTILL_FAKE_WINDOW: "200000",
        }),
        logFile: t.logFile,
      });
      try {
        // Phase 1: cross the auto threshold quickly.
        for (let i = 1; i <= 6; i++) {
          const since = client.mark();
          const accepted = await client.request({ type: "prompt", message: filler(i) });
          expect(accepted.success).toBe(true);
          await settle(client, since);
        }

        // Phase 2: the documented startup cooldown holds the check back — the
        // threshold is crossed with a current finite positive Pi usage sample,
        // but compaction waits out
        // the real cooldown restored from the seeded compaction.
        await new Promise((r) => setTimeout(r, 250));
        const diag = readFileSync(join(t.agentHome, "data", "dc-distill", "diag.log"), "utf8");
        expect(diag).toContain("auto-check blocked reason=cooldown source=agent_settled");
        expect(diag).toContain("sample=finite-positive");
        expect(eventsOfType(client.events, "compaction_start")).toEqual([]);

        // Phase 3: ride out the cooldown; the next settled boundary fires.
        // Turn 7 remains in the auto tier, below warn with the retained tail.
        const cooldownEnds = spawnedAt + 120_000 + 1_500;
        await new Promise((r) => setTimeout(r, Math.max(0, cooldownEnds - Date.now())));
        const since = client.mark();
        const accepted = await client.request({ type: "prompt", message: filler(7) });
        expect(accepted.success).toBe(true);
        await client.waitFor((e) => e.type === "compaction_start", 60_000, { since });
        const compactionStart = eventsOfType(client.events, "compaction_start")
          .find((e) => client.events.indexOf(e) >= since)!;
        expect(compactionStart).toBeDefined();

        // Trigger-boundary trace: Pi runs extension hooks while processing its
        // internal agent_settled transition, before it publishes that RPC event.
        // Thus compaction follows the terminal assistant message, precedes the
        // public agent_settled event, and begins with no intervening agent run.
        const events = client.events;
        const startIndex = events.indexOf(compactionStart!);
        const assistantEndIndex = events.map((e, i) => ({ e, i })).reverse()
          .find(({ e, i }) => i < startIndex
            && e.type === "message_end"
            && (e.message as { role?: string })?.role === "assistant")?.i;
        expect(assistantEndIndex).toBeDefined();
        const startsBetween = eventsOfType(events, "agent_start")
          .map((e) => events.indexOf(e))
          .filter((i) => i > assistantEndIndex! && i < startIndex);
        expect(startsBetween).toEqual([]);
        await client.waitFor((e) => e.type === "agent_settled", 30_000, { since: startIndex });
        const settledAfterIndex = events.findIndex((e, i) => i > startIndex && e.type === "agent_settled");
        expect(settledAfterIndex).toBeGreaterThan(startIndex);

        const end = await client.waitFor(
          (e) => e.type === "compaction_end" && e.aborted === false,
          60_000,
          { since: startIndex },
        );
        const result = end.result as { summary?: string; details?: CompactionDetails };
        expect(result.details?.compactor).toBe("dc-distill");
        expect(result.details?.autonomous).toBe(true);
        assertCurrentCompaction(result.summary, result.details);
        const committed = ledgerCompactions(latestSessionFile(t));
        expect(committed).toHaveLength(2); // preserved seed + this one autonomous append
        expect(committed[0]).toEqual(seedCompactions[0]);
        expect(committed[1]?.summary).toBe(result.summary);
        expect(committed[1]?.details).toEqual(result.details);
        assertCurrentCompaction(committed[1]?.summary, committed[1]?.details);

        // Durable continuation: delivered once while idle, journalled with the
        // attempt id, triggers a run, and is answered by the model.
        const continuation = await client.waitFor(
          (e) => e.type === "message_end"
            && (e.message as { customType?: string })?.customType === CONTINUATION,
          60_000,
          { since: startIndex },
        );
        const details = (continuation.message as { details?: Record<string, unknown> }).details;
        expect(details?.attemptId).toBe(result.details?.attemptId);
        expect(details?.resumed).toBeUndefined();

        const afterContinuation = client.events.indexOf(continuation);
        const continuationRunStart = eventsOfType(client.events, "agent_start")
          .map((e) => client.events.indexOf(e))
          .filter((i) => i > startIndex && i < afterContinuation);
        expect(continuationRunStart).toHaveLength(1);
        const answer = await client.waitFor(
          (e) => e.type === "message_end" && (e.message as { role?: string })?.role === "assistant",
          60_000,
          { since: afterContinuation },
        );
        expect(messageText(answer.message)).toContain("Continued after compaction.");

        await new Promise((r) => setTimeout(r, 750));
        expect(continuationMessages(client.events)).toHaveLength(1);
        expect(eventsOfType(client.events, "compaction_start")).toHaveLength(1);

        // Committed store artifacts, all inside the sandboxed profile: one
        // global compact-log entry and one project recall entry.
        const sessionId = /Session ID: ([0-9a-f-]+)/.exec(result.summary ?? "")?.[1];
        expect(sessionId).toBeDefined();
        const logEntries = readFileSync(
          join(t.agentHome, "data", "dc-distill", "compact-log.jsonl"),
          "utf8",
        ).trim().split("\n").map((l) => JSON.parse(l) as Record<string, any>);
        const mine = logEntries.slice(seedLogCount).filter((e) => e.sessionId === sessionId);
        expect(mine).toHaveLength(1);
        expect(mine[0]?.tier).toBe(1);
        expect(mine[0]?.strategy).toBe("algorithmic");
        const projectsRoot = join(t.agentHome, "data", "dc-distill", "projects");
        const projectDir = readdirSync(projectsRoot)
          .map((name) => join(projectsRoot, name))
          .find((dir) => existsSync(join(dir, "recall.json")));
        expect(projectDir).toBeDefined();
        const parsedRecall = JSON.parse(
          readFileSync(join(projectDir!, "recall.json"), "utf8"),
        ) as Array<Record<string, any>> | { entries?: Array<Record<string, any>> };
        const recallEntries = Array.isArray(parsedRecall) ? parsedRecall : parsedRecall.entries ?? [];
        const sessionRecall = recallEntries.filter((e) => e.sessionId === sessionId);
        expect(sessionRecall).toHaveLength(2); // seed and autonomous commit, both retained
        expect(sessionRecall.filter((e) => e.attemptId === seedCompactions[0]?.details?.attemptId)).toHaveLength(1);
        const autonomousRecall = sessionRecall.filter((e) => e.attemptId === result.details?.attemptId);
        expect(autonomousRecall).toHaveLength(1);
        expect(autonomousRecall[0]?.summary).toBe(result.summary);

        // No extra provider request for the autonomous cycle either; the
        // separately validated seed process has its own earlier trace prefix.
        expect(providerTrace(t).slice(seedTraceCount)).toHaveLength(
          eventsOfType(client.events, "agent_start").length,
        );
      } finally {
        await client.close();
      }

      passed = true;
    } finally { await t.finalize(passed); }
    },
    240_000,
  );

  test("C: crash-truncated ledgers recover continuation delivery and nudge on restart", async () => {
    // Phase 1: create a real extension-owned Pi compaction quickly. B owns
    // the real autonomous threshold path (including its 120s startup
    // cooldown); C needs a compact, deterministic post-commit crash fixture.
    const t = makeTestDir("restart");
    let passed = false;
    try {
      const first = new RpcClient({
        args: scriptedArgs(t),
        cwd: t.dir,
        env: piEnv(t, {
          DISTILL_FAKE_BASE: "4000",
          DISTILL_FAKE_STEP: "500",
          DISTILL_FAKE_WINDOW: "200000",
        }),
        logFile: join(t.dir, "phase1.log"),
      });
      let attemptId: string | undefined;
      try {
        for (let i = 1; i <= 4; i++) {
          const since = first.mark();
          const accepted = await first.request({ type: "prompt", message: filler(i) });
          expect(accepted.success).toBe(true);
          await settle(first, since);
        }
        const since = first.mark();
        const compact = await first.request({ type: "compact" }, 60_000);
        expect(compact.success).toBe(true);
        const end = await first.waitFor(
          (e) => e.type === "compaction_end" && e.aborted === false,
          60_000,
          { since },
        );
        attemptId = ((end.result as { details?: CompactionDetails }).details ?? {}).attemptId;
        expect(attemptId).toBeDefined();
      } finally {
        await first.close();
      }

      const source = latestSessionFile(t);
      expect(source).toBeDefined();
      const lines = readFileSync(source!, "utf8").split("\n").filter((l) => l.trim());
      const compactionLine = lines.findIndex((l) => {
        try {
          return (JSON.parse(l) as { type?: string }).type === "compaction";
        } catch {
          return false;
        }
      });
      expect(compactionLine).toBeGreaterThan(-1);

      // Seed a durable post-commit/pre-delivery autonomous entry. Recovery is
      // intentionally journal-driven and gates only on these persisted details;
      // the copied ledger models a process crash exactly before its setImmediate
      // continuation delivery can append the custom-message journal.
      const seededLines = [...lines];
      const seededEntry = JSON.parse(seededLines[compactionLine]!) as {
        summary?: unknown;
        details?: Record<string, unknown>;
      };
      assertCurrentCompaction(seededEntry.summary, seededEntry.details);
      seededEntry.details = { ...seededEntry.details, autonomous: true };
      seededLines[compactionLine] = JSON.stringify(seededEntry);

      // Phase 2: a ledger ending right after the compaction entry (crash
      // before delivery) restarts into a delivered continuation — no prompt.
      const committedLedger = join(t.dir, "restart-committed.jsonl");
      writeFileSync(committedLedger, `${seededLines.slice(0, compactionLine + 1).join("\n")}\n`);

      const second = new RpcClient({
        args: scriptedArgs(t, [], { session: committedLedger }),
        cwd: t.dir,
        env: piEnv(t, {
          DISTILL_FAKE_BASE: "4000",
          DISTILL_FAKE_STEP: "25000",
          DISTILL_FAKE_WINDOW: "200000",
        }),
        logFile: join(t.dir, "phase2.log"),
      });
      try {
        const delivered = await second.waitFor(
          (e) => e.type === "message_end"
            && (e.message as { customType?: string })?.customType === CONTINUATION,
          60_000,
        );
        const details = (delivered.message as { details?: Record<string, unknown> }).details;
        expect(details?.attemptId).toBe(attemptId);
        expect(details?.resumed).toBeUndefined();
        // The continuation drives a real run that answers it.
        const answer = await second.waitFor(
          (e) => e.type === "message_end" && (e.message as { role?: string })?.role === "assistant",
          60_000,
          { since: second.events.indexOf(delivered) },
        );
        expect(messageText(answer.message)).toContain("Continued after compaction.");
      } finally {
        await second.close();
      }

      // Phase 3: a ledger ending right after the delivered-but-unanswered
      // continuation restarts into a one-time resume nudge.
      const resumedLedgerSource = committedLedger;
      const resumedLines = readFileSync(resumedLedgerSource, "utf8").split("\n").filter((l) => l.trim());
      const continuationLine = resumedLines.findIndex((l) => {
        try {
          const entry = JSON.parse(l) as { type?: string; customType?: string };
          return entry.type === "custom_message" && entry.customType === CONTINUATION;
        } catch {
          return false;
        }
      });
      expect(continuationLine).toBeGreaterThan(-1);
      const deliveredLedger = join(t.dir, "restart-delivered.jsonl");
      writeFileSync(deliveredLedger, `${resumedLines.slice(0, continuationLine + 1).join("\n")}\n`);
      copyFileSync(resumedLedgerSource, join(t.dir, "phase2-full-ledger.jsonl"));

      const third = new RpcClient({
        args: scriptedArgs(t, [], { session: deliveredLedger }),
        cwd: t.dir,
        env: piEnv(t, {
          DISTILL_FAKE_BASE: "4000",
          DISTILL_FAKE_STEP: "25000",
          DISTILL_FAKE_WINDOW: "200000",
        }),
        logFile: join(t.dir, "phase3.log"),
      });
      try {
        const nudge = await third.waitFor(
          (e) => e.type === "message_end"
            && (e.message as { customType?: string })?.customType === CONTINUATION,
          60_000,
        );
        const details = (nudge.message as { details?: Record<string, unknown> }).details;
        expect(details?.attemptId).toBe(attemptId);
        expect(details?.resumed).toBe(true);
      } finally {
        await third.close();
      }

      // Phase 4: a durable user interruption or later compaction supersedes
      // the old automatic intent, whether delivery had happened or not.
      // These are sandbox ledger fixtures, not mutations of user sessions.
      for (const delivered of [false, true]) {
        for (const superseder of ["user", "manual", "foreign"] as const) {
          const base = delivered
            ? resumedLines.slice(0, continuationLine + 1)
            : seededLines.slice(0, compactionLine + 1);
          const parent = JSON.parse(base[base.length - 1]!) as Record<string, any>;
          const id = randomBytes(4).toString("hex");
          const timestamp = new Date().toISOString();
          const next = superseder === "user"
            ? { type: "message", id, parentId: parent.id, timestamp,
              message: { role: "user", content: [{ type: "text", text: "Stop the old request; work on this new objective." }], timestamp: Date.now() } }
            : { ...seededEntry, type: "compaction", id, parentId: parent.id, timestamp,
              details: { ...seededEntry.details, autonomous: false,
                ...(superseder === "foreign" ? { compactor: "fixture-foreign" } : {}) } };
          const ledger = join(t.dir, `superseded-${delivered ? "delivered" : "committed"}-${superseder}.jsonl`);
          writeFileSync(ledger, `${[...base, JSON.stringify(next)].join("\n")}\n`);
          const restarted = new RpcClient({ args: scriptedArgs(t, [], { session: ledger }), cwd: t.dir,
            env: piEnv(t, { DISTILL_FAKE_BASE: "4000", DISTILL_FAKE_STEP: "500" }),
            logFile: join(t.dir, `superseded-${delivered}-${superseder}.log`) });
          try {
            expect((await restarted.request({ type: "get_state" })).success).toBe(true);
            await new Promise((resolve) => setTimeout(resolve, 750));
            expect(continuationMessages(restarted.events)).toHaveLength(0);
            expect(eventsOfType(restarted.events, "agent_start")).toHaveLength(0);
          } finally { await restarted.close(); }
        }
      }

      passed = true;
    } finally { await t.finalize(passed); }
  }, 240_000);
});
