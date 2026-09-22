/**
 * Shared isolation and CLI plumbing for the E2E suite.
 *
 * Every scenario runs the real `pi --mode rpc` binary in a scratch project
 * directory with a temp PI_CODING_AGENT_DIR / PI_CODING_AGENT_SESSION_DIR,
 * offline flags, and exactly two extensions loaded: dc-shrink and the
 * scripted provider. Nothing here touches user data or the network.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const HARNESS_DIR = resolve(new URL(".", import.meta.url).pathname);

export const REPO_ROOT = resolve(HARNESS_DIR, "..", "..", "..");
export const EXTENSION = join(REPO_ROOT, "index.ts");
export const FAKE_PROVIDER = join(HARNESS_DIR, "fake-provider.ts");
/** Gitignored artifact root (`.work/`), recreated per scenario. */
export const VERIFICATION_DIR = join(REPO_ROOT, ".work", "e2e-artifacts");

export interface TestDir {
  /** Scratch project directory; also the pi process cwd. */
  dir: string;
  /** Isolated PI_CODING_AGENT_DIR holding settings.json. */
  agentHome: string;
  /** Sandboxed HOME: the runtime's ~/.pi resolves here, isolating dc-shrink's
   *  homedir-based store paths from the real user profile. */
  home: string;
  /** Isolated session storage, passed both as env and --session-dir. */
  sessionDir: string;
  /** Mirrored RPC transcript for artifacts. */
  logFile: string;
  /** Scripted-provider JSONL request trace. */
  traceFile: string;
}

export function makeTestDir(name: string, settings: Record<string, unknown> = {}): TestDir {
  const dir = join(VERIFICATION_DIR, name);
  rmSync(dir, { recursive: true, force: true });
  const agentHome = join(dir, "agent-home");
  const home = join(dir, "home");
  const sessionDir = join(dir, "sessions");
  mkdirSync(join(dir, ".pi"), { recursive: true });
  mkdirSync(agentHome, { recursive: true });
  mkdirSync(join(home, ".pi"), { recursive: true });
  mkdirSync(sessionDir, { recursive: true });

  // dc-shrink mirrors Pi's own compaction settings; write them at the
  // sandboxed agent home, the sandboxed ~/.pi, and the project so every
  // resolution path agrees.
  const compaction = { enabled: true, reserveTokens: 16_384, ...settings };
  for (const target of [join(agentHome, "settings.json"), join(home, ".pi", "settings.json")]) {
    writeFileSync(target, JSON.stringify({ compaction }, null, 2));
  }
  writeFileSync(join(dir, ".pi", "settings.json"), JSON.stringify({ compaction }, null, 2));

  return {
    dir,
    agentHome,
    home,
    sessionDir,
    logFile: join(dir, "rpc.log"),
    traceFile: join(dir, "provider-trace.jsonl"),
  };
}

export function piEnv(t: TestDir, extra: Record<string, string> = {}): Record<string, string> {
  return {
    HOME: t.home,
    PI_CODING_AGENT_DIR: t.agentHome,
    PI_CODING_AGENT_SESSION_DIR: t.sessionDir,
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    SHRINK_FAKE_TRACE: t.traceFile,
    ...extra,
  };
}

/** CLI args shared by every scripted run. */
export function scriptedArgs(t: TestDir, extra: string[] = [], options: { session?: string } = {}): string[] {
  const args = [
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "-a",
    "-e", EXTENSION,
    "-e", FAKE_PROVIDER,
    "--model", "fake/scripted",
    "--session-dir", t.sessionDir,
  ];
  if (options.session) args.push("--session", options.session);
  return [...args, ...extra];
}

/** Newest session JSONL under the scratch session dir (sessions nest by date). */
export function latestSessionFile(t: TestDir): string | undefined {
  if (!existsSync(t.sessionDir)) return undefined;
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(dir, entry.name))
        : entry.name.endsWith(".jsonl")
          ? [join(dir, entry.name)]
          : [],
    );
  const files = walk(t.sessionDir).sort();
  return files[files.length - 1];
}
