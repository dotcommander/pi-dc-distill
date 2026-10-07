/** Opt-in PTY launcher: real native UI notification regression, entirely sandboxed. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTestDir, scriptedArgs } from "./harness/env.ts";
import { selectedHost } from "./harness/rpc-client.ts";
import { COLLISION_FOCUS, COMMIT_OBSERVER, collisionEnv, readRecords, seedSummaryCollision } from "./harness/summary-collision.ts";
import { assertCurrentCompaction } from "./harness/current-compaction.ts";

if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Run this launcher in an owned native PTY");
const t = makeTestDir("summary-collision-tui", { keepRecentTokens: 1024 });
let passed = false;
try {
  const { session, abandoned, sibling } = await seedSummaryCollision(t);
  const telemetry = join(t.dir, "collision-observer.jsonl");
  const env = collisionEnv(t, telemetry);
  const host = selectedHost({ args: [], cwd: t.dir, env });
  const command = `/compact ${COLLISION_FOCUS}`;
  writeFileSync(join(t.dir, "interactive-instructions.json"), JSON.stringify({ host, session,
    telemetry, command, abandonedId: abandoned.id, abandonedAttempt: abandoned.details.attemptId }, null, 2));
  console.log(`After native startup, submit: ${command}`);
  console.log("Wait for the successful native compaction card, then exit with Ctrl+C twice.");
  console.log(`Observer receipt: ${telemetry}`);
  const child = spawn(host.executable, [...host.prefix,
    ...scriptedArgs(t, ["-e", COMMIT_OBSERVER], { session })], {
    cwd: t.dir, stdio: "inherit",
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG,
      TERM: process.env.TERM ?? "xterm-256color", ...env },
  });
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    child.kill("SIGTERM");
    stopTimer ??= setTimeout(() => child.kill("SIGKILL"), 5000);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", () => resolve());
    });
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    if (stopTimer) clearTimeout(stopTimer);
  }
  const compactions = readRecords(session).filter(row => row.type === "compaction");
  assert.equal(compactions.length, 2, "expected exactly one new host commit");
  const current = compactions[1]!;
  assertCurrentCompaction(current.summary, current.details);
  assert.equal(current.summary, abandoned.summary, "collision must be byte-identical");
  assert.equal(current.parentId, sibling);
  assert.notEqual(current.details.attemptId, abandoned.details.attemptId);
  const observations = readRecords(telemetry);
  const callbacks = observations.filter(row => row.kind === "commit");
  assert.equal(callbacks.length, 1);
  assert.equal(callbacks[0]?.hasUI, true);
  assert.equal(callbacks[0]?.fromExtension, true);
  assert.equal(callbacks[0]?.sameSummary, true);
  assert.equal(callbacks[0]?.newestId, current.id);
  assert.equal(callbacks[0]?.newestAttempt, current.details.attemptId);
  assert([abandoned.id, current.id].includes(callbacks[0]?.eventId));
  const notifications = observations.filter(row => row.kind === "notify");
  assert.equal(notifications.length, 1, "new active owned commit must notify exactly once");
  assert.equal(notifications[0]?.hasUI, true);
  assert.equal(notifications[0]?.type, "info");
  assert.match(notifications[0]?.message, /^dc-distill compacted context/);
  assert.equal(readRecords(t.traceFile).filter(row => row.kind === "summary").length, 0);
  writeFileSync(join(t.dir, "notification-acceptance.json"), JSON.stringify({
    success: true, host, abandonedId: abandoned.id, activeId: current.id,
    callbackCollision: callbacks[0]?.eventId === abandoned.id, callbacks, notifications,
    renderedNotificationText: "not established by observer" }, null, 2));
  console.log("Native UI notify invocation passed exactly once; visible text needs terminal evidence.");
  passed = true;
} finally { await t.finalize(passed); }
