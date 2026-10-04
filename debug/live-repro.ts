/**
 * Live-fidelity reproduction of the silent-commit anomaly.
 *
 * Uses the REAL agent settings + full extension set (npm:pi-dc-distill etc.)
 * through a symlinked scratch agent dir (isolated data writes), resumes a
 * pre-compaction copy of a real session, drives one turn with the scripted
 * provider reporting >120k usage, and observes whether the autonomous
 * compaction commits extension-side artifacts.
 *
 * Usage: bun run debug/live-repro.ts <source-session.jsonl>
 */
import { RpcClient, type RpcEvent } from "../tests/e2e/harness/rpc-client.ts";
import {
  appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync,
  readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const FAKE_PROVIDER = resolve(import.meta.dir, "../tests/e2e/harness/fake-provider.ts");
const REAL_AGENT = join(homedir(), ".pi/agent");
const BASE = mkdtempSync(join(homedir(), ".distill-live-repro-"));
const CWD = "/Users/vampire/code/ts/pi-dc-distill";

const source = process.argv[2];
if (!source || !existsSync(source)) throw new Error("usage: bun run debug/live-repro.ts <source-session.jsonl>");

// --- scratch environment -------------------------------------------------
const agentHome = join(BASE, "agent-home");
const sessions = join(BASE, "sessions");
mkdirSync(agentHome, { recursive: true });
mkdirSync(sessions, { recursive: true });
// Relative package entries like ../../code/ts/pi-dc-ui resolve from the agent
// dir; BASE sits one level under the home directory so the depths match.
if (resolve(agentHome, "../..") !== homedir()) throw new Error("agent-home depth must be home/<dir>/agent-home");
symlinkSync(join(REAL_AGENT, "npm"), join(agentHome, "npm"));
symlinkSync(join(REAL_AGENT, "extensions"), join(agentHome, "extensions"));
for (const file of ["settings.json", "trust.json", "keybindings.json"]) {
  const from = join(REAL_AGENT, file);
  if (existsSync(from)) copyFileSync(from, join(agentHome, file));
}
const log = (m: string) => { console.log(m); appendFileSync(join(BASE, "run.log"), m + "\n"); };
const MODE = process.argv[3] ?? "full"; // "full" (real set) | "isolated" (only dc-distill + fake)
const DISTILL_NPM = join(REAL_AGENT, "npm/node_modules/pi-dc-distill/index.ts");
// DROP="substr,substr" removes matching package/extension entries from the
// scratch settings copy (bisecting the real extension set).
const drop = (process.env.DROP ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (drop.length) {
  // Replace the extensions symlink with a filtered real copy (dc-library-loader
  // is auto-discovered from the directory, not listed in settings).
  rmSync(join(agentHome, "extensions"));
  mkdirSync(join(agentHome, "extensions"), { recursive: true });
  for (const entry of readdirSync(join(REAL_AGENT, "extensions"))) {
    if (drop.some((d) => entry.includes(d))) continue;
    cpSync(join(REAL_AGENT, "extensions", entry), join(agentHome, "extensions", entry), { recursive: true });
  }
  const settingsPath = join(agentHome, "settings.json");
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  for (const key of ["packages", "extensions"] as const) {
    const list = settings[key];
    if (!Array.isArray(list)) continue;
    settings[key] = list.filter((entry: unknown) => {
      const text = typeof entry === "string" ? entry : JSON.stringify(entry);
      return !drop.some((d) => text.includes(d));
    });
  }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  const verify = readFileSync(settingsPath, "utf8");
  log(`DROP applied: ${drop.join(",")} | settings-verified=${!verify.includes(drop[0])} | extensions dir: ${readdirSync(join(agentHome, "extensions")).join(",")}`);
}
// LOCAL=1 swaps npm:pi-dc-distill for the repo checkout (../../code/ts/pi-dc-distill
// resolves from the scratch agent-home at matching depth).
if (process.env.LOCAL === "1" && process.env.DBG !== "1") {
  const settingsPath = join(agentHome, "settings.json");
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  for (const key of ["packages", "extensions"] as const) {
    const list = settings[key];
    if (!Array.isArray(list)) continue;
    settings[key] = list.map((entry: unknown) =>
      typeof entry === "string" && entry === "npm:pi-dc-distill" ? "../../code/ts/pi-dc-distill" : entry);
  }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  const verify = readFileSync(settingsPath, "utf8");
  log(`LOCAL swap verified: repo=${verify.includes("../../code/ts/pi-dc-distill")} npm=${verify.includes("npm:pi-dc-distill")}`);
}
// DBG=1 swaps npm:pi-dc-distill for an instrumented copy that breadcrumbs
// every silent early-return in the commit gate (via console.error -> stderr).
if (process.env.DBG === "1") {
  const srcDir = join(REAL_AGENT, "npm/node_modules/pi-dc-distill");
  const dstDir = join(agentHome, "distill-debug");
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    if (entry === "node_modules") continue;
    const from = join(srcDir, entry);
    cpSync(from, join(dstDir, entry), { recursive: true });
  }
  const indexPath = join(dstDir, "index.ts");
  let code = readFileSync(indexPath, "utf8");
  const mark = (tag: string) => `console.error("[DBG:${tag}] mod=" + DBG_ID);`;
  const subs: Array<[string, string]> = [
    [`      session_compact: async (event, ctx) => {`,
     `      session_compact: async (event, ctx) => {
        ${mark("compact-enter")} console.error("[DBG:compact-evt] fromExt=" + event.fromExtension + " owner=" + isOwner(runtime, ctx) + " pending=" + !!runtime.pending);`],
    [`        const pending = runtime.pending;
        if (!pending) return;`,
     `        const pending = runtime.pending;
        if (!pending) { ${mark("ret:no-pending")} return; }`],
    [`        if (!runtime.ownsAttempt(ticket, ctx) || runtime.commitInFlight) return;`,
     `        if (!runtime.ownsAttempt(ticket, ctx) || runtime.commitInFlight) { console.error("[DBG:ret:not-owner-or-inflight] owns=" + runtime.ownsAttempt(ticket, ctx) + " inFlight=" + runtime.commitInFlight); return; }`],
    [`        if (!event.fromExtension) return;`,
     `        if (!event.fromExtension) { ${mark("ret:not-from-extension")} return; }`],
    [`        if (!matches) return;`,
     `        if (!matches) { console.error("[DBG:ret:no-match] branch=" + branchMatches + " ckpt=" + checkpointMatches + " compactor=" + details.compactor + " v=" + details.version + " expV=" + VERSION + " attempt=" + details.attemptId + " exp=" + pending.attemptId + " firstKept=" + entry.firstKeptEntryId + " expFK=" + pending.firstKeptEntryId + " sumD=" + (sha256Hex(entry.summary) === pending.summaryDigest) + " detsD=" + (details.summaryDigest === pending.summaryDigest) + " | leaf=" + (ctx.sessionManager.getBranch().at(-1)?.id ?? "null") + " anchor=" + ticket.branchAnchor + " entryId=" + entry.id + " entryParent=" + entry.parentId + " leafType=" + (ctx.sessionManager.getBranch().at(-1)?.type ?? "?") + " | tail=" + JSON.stringify(ctx.sessionManager.getBranch().slice(-3).map((e) => ({ id: e.id, type: e.type, customType: (e as any).customType ?? (e as any).message?.customType ?? null, parent: e.parentId })))); return; }`],
  ];
  for (const [from, to] of subs) {
    if (!code.includes(from)) throw new Error(`DBG anchor not found: ${from.slice(0, 60)}`);
    code = code.replace(from, to);
  }
  code = `const DBG_ID = Math.random().toString(36).slice(2, 8); console.error("[DBG:module-loaded] id=" + DBG_ID);\n` + code;
  writeFileSync(indexPath, code);
  const settingsPath = join(agentHome, "settings.json");
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  for (const key of ["packages", "extensions"] as const) {
    const list = settings[key];
    if (!Array.isArray(list)) continue;
    settings[key] = list.map((entry: unknown) =>
      typeof entry === "string" && entry.includes("pi-dc-distill") ? "distill-debug" : entry);
  }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  const verify = readFileSync(settingsPath, "utf8");
  log(`DBG settings verify: distill-debug=${verify.includes("distill-debug")} npm=${verify.includes("npm:pi-dc-distill")}`);
  log("DBG instrumented copy installed as distill-debug");
}

// --- pre-compaction session copy ------------------------------------------
const lines = readFileSync(source, "utf8").split("\n").filter((l) => l.trim());
const cut = lines.findIndex((l) => l.includes('"type":"compaction"'));
const kept = cut === -1 ? lines : lines.slice(0, cut);
const sessionCopy = join(sessions, "repro.jsonl");
writeFileSync(sessionCopy, kept.join("\n") + "\n");
log(`session copy: ${kept.length} entries (cut at compaction index ${cut}) [mode=${MODE}]`);
const extensionArgs =
  MODE === "isolated"
    ? ["--no-extensions", "-e", FAKE_PROVIDER, "-e", DISTILL_NPM]
    : ["-e", FAKE_PROVIDER];

// --- drive one autonomous cycle -------------------------------------------
const client = new RpcClient({
  args: [
    ...extensionArgs,
    "--model", "fake/scripted",
    "--session-dir", sessions,
    "--session", sessionCopy,
  ],
  cwd: CWD,
  env: {
    HOME: homedir(),
    PI_CODING_AGENT_DIR: agentHome,
    PI_CODING_AGENT_SESSION_DIR: sessions,
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    DISTILL_PI_PACKAGE: join(homedir(), ".bun/install/global/node_modules/@earendil-works/pi-coding-agent"),
    DISTILL_PI_EXPECT_VERSION: "1.0.2",
    DISTILL_FAKE_WINDOW: "200000",
    DISTILL_FAKE_BASE: "121000",
    DISTILL_FAKE_STEP: "1500",
    DISTILL_FAKE_TRACE: join(BASE, "trace.jsonl"),
  },
  logFile: join(BASE, "rpc.log"),
});

const compactLog = join(agentHome, "data/dc-distill/compact-log.jsonl");
const diagLog = join(agentHome, "data/dc-distill/diag.log");

try {
  const since = client.mark();
  const accepted = await client.request({ type: "prompt", message: "ok" }, 120_000);
  log(`prompt accepted: ${JSON.stringify(accepted.success)}`);
  await client.waitFor((e) => e.type === "agent_settled", 120_000, { since });
  log("agent settled; waiting out the 120s warmup for the autonomous check...");

  let compacted: RpcEvent | undefined;
  const deadline = Date.now() + 300_000;
  while (!compacted && Date.now() < deadline) {
    compacted = await client.waitFor(
      (e) => e.type === "compaction_end" || e.type === "session_compact",
      15_000,
    ).catch(() => undefined);
    if (compacted) break;
    log(`waiting... (rpc events: ${client.events.length}, stderr: ${client.stderr.length})`);
  }
  if (compacted) {
    const c = compacted as { type: string; aborted?: boolean; reason?: string };
    log(`OBSERVED ${c.type} aborted=${c.aborted} reason=${c.reason}`);
  } else {
    log("NO compaction event observed within 5 minutes of settle");
  }
  // Give the commit handler a moment, then dump the extension-side artifacts.
  await new Promise((r) => setTimeout(r, 3000));
} finally {
  await client.close();
}

log("--- compact-log (scratch agent-home) ---");
log(existsSync(compactLog) ? readFileSync(compactLog, "utf8").trim().split("\n").slice(-5).join("\n") : "(absent)");
log("--- diag tail ---");
log(existsSync(diagLog) ? readFileSync(diagLog, "utf8").trim().split("\n").slice(-12).join("\n") : "(absent)");
log("--- DBG breadcrumbs (stderr) ---");
for (const line of client.stderr) if (line.includes("[DBG")) log(line.slice(0, 1500));
log(`--- artifacts: ${BASE} ---`);
