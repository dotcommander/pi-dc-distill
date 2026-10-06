/** Opt-in isolated interactive acceptance launcher; local scripted provider only.
 * Launch in a PTY. The verifier supplies the printed prompts and captures the
 * native card; successful launch/exit is never treated as acceptance evidence.
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXTENSION, REPO_ROOT, latestSessionFile, makeTestDir, piEnv, scriptedArgs } from "./harness/env.ts";
import { RpcClient, selectedHost } from "./harness/rpc-client.ts";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  throw new Error("Interactive acceptance requires a PTY for native card rendering");
}
const t = makeTestDir("natural-settlement-tui", { keepRecentTokens: 1024 });
const offset = join(t.dir, "clock-offset");
const boundaryTrace = join(t.dir, "boundary-trace.jsonl");
const toolFile = join(t.dir, "tool-input.txt");
writeFileSync(offset, "0");
writeFileSync(toolFile, "Bounded sibling tool output.\n".repeat(100));
const environment = piEnv(t, {
  DISTILL_TEST_CLOCK_OFFSET: offset,
  DISTILL_TEST_BOUNDARY_TRACE: boundaryTrace,
  DISTILL_FAKE_BOUNDARY_FILE: toolFile,
  DISTILL_FAKE_BASE: "4000",
  DISTILL_FAKE_STEP: "500",
  DISTILL_FAKE_POST_COMPACTION_USAGE: "5000",
});
const args = scriptedArgs(t).map((arg) => arg === EXTENSION
  ? join(REPO_ROOT, "tests/e2e/harness/turn-boundary-extension.ts") : arg);
const client = new RpcClient({ args, cwd: t.dir, env: environment, logFile: t.logFile });
try {
  for (let turn = 0; turn < 3; turn++) {
    const since = client.mark();
    const reply = await client.request({ type: "prompt", message: `Seed ${turn}. ` + "discarded context ".repeat(2000) });
    if (!reply.success) throw new Error("Interactive seed prompt failed");
    await client.waitFor((event) => event.type === "agent_settled", 30_000, { since });
  }
  if (!(await client.request({ type: "compact" }, 45_000)).success) {
    throw new Error("Interactive manual seed compaction failed");
  }
} finally {
  await client.close();
}
const session = latestSessionFile(t);
if (!session) throw new Error("Missing interactive seed journal");
writeFileSync(offset, "121000");
const host = selectedHost({ args, cwd: t.dir, env: environment });
const prompts = ["Warmup 1: acknowledge only.", "Warmup 2: acknowledge only.",
  "Warmup 3: acknowledge only.", "RUN_BOUNDARY_BATCHES: complete four sibling read batches."];
writeFileSync(join(t.dir, "interactive-instructions.json"), JSON.stringify({
  host, cwd: t.dir, session, boundaryTrace, providerTrace: t.traceFile, prompts,
  expected: "four successful batches, 150000-token final response, native compaction card, matching autonomous commit/continuation, zero extension aborts or routine red abort row",
}, null, 2));
console.log(`Interactive host: ${JSON.stringify(host)}\nJournal: ${session}\nBoundary trace: ${boundaryTrace}\nProvider trace: ${t.traceFile}`);
console.log("Submit each prompt after the preceding reply finishes:");
for (const prompt of prompts) console.log(prompt);
console.log("Capture the native card and terminal output. Exit with Ctrl+C; artifacts remain for verifier inspection.");
const child = spawn(host.executable, [...host.prefix, ...args, "--session", session], {
  cwd: t.dir, env: { ...process.env, ...environment }, stdio: "inherit",
});
const exitCode = await new Promise<number>((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});
// Do not finalize as passed: only a separate verifier can accept the rendered
// card, journal identities, ordering, continuation and absence of abort rows.
process.exitCode = exitCode;
