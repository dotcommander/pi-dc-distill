/** Development-only, read-only saved-session adapter for the current compactor. */
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { DEFAULT_COMPACTION_SETTINGS, parseSessionEntries, SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { buildCompactionSource } from "../lib/compaction-source.ts";
import { compileCompactionSource } from "../lib/local-compact.ts";
import { fitCapacity } from "../lib/runtime/capacity.ts";

type CompactionSettings = typeof DEFAULT_COMPACTION_SETTINGS;
type CompactionPreparation = { firstKeptEntryId: string; messagesToSummarize: unknown[]; turnPrefixMessages: unknown[]; tokensBefore: number; previousSummary?: string | undefined; isSplitTurn: boolean };
const ENTRY_TYPES = new Set(["message", "thinking_level_change", "model_change", "usage", "compaction", "branch_summary", "custom", "custom_message", "context_edit", "label", "session_info"]);

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const expand = (path: string) => path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
const natural = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a nonnegative safe integer`);
  return value;
};

/** Strict before Pi's permissive parser or branch walk; never migrate or invent IDs. */
export function parseSavedSession(text: string) {
  const values: Record<string, unknown>[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw new Error(`Malformed JSONL at line ${index + 1}`); }
    if (!object(value)) throw new Error(`Expected an object at line ${index + 1}`);
    values.push(value);
  }
  const header = values[0];
  if (!header || header.type !== "session" || header.version !== 3 || typeof header.id !== "string" || !header.id ||
      typeof header.cwd !== "string" || !isAbsolute(header.cwd) || typeof header.timestamp !== "string" || !Number.isFinite(Date.parse(header.timestamp)))
    throw new Error("Expected a current Pi session header (version 3, id, absolute cwd, timestamp); historical sessions are unsupported");
  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of values.slice(1)) {
    if (typeof entry.type !== "string" || !ENTRY_TYPES.has(entry.type) || typeof entry.id !== "string" || !entry.id ||
        (entry.parentId !== null && (typeof entry.parentId !== "string" || !entry.parentId)) ||
        typeof entry.timestamp !== "string" || !Number.isFinite(Date.parse(entry.timestamp))) throw new Error("Invalid session entry identity or timestamp");
    if (byId.has(entry.id) || entry.id === header.id) throw new Error("Duplicate session entry identity");
    byId.set(entry.id, entry);
  }
  for (const entry of byId.values()) if (entry.parentId !== null && !byId.has(entry.parentId as string)) throw new Error("Dangling session parent reference");
  const done = new Set<string>();
  for (const id of byId.keys()) {
    const visiting = new Set<string>();
    let current: string | null = id;
    while (current !== null && !done.has(current)) {
      if (visiting.has(current)) throw new Error("Cycle in session parent references");
      visiting.add(current);
      current = byId.get(current)!.parentId as string | null;
    }
    for (const visited of visiting) done.add(visited);
  }
  return { cwd: header.cwd, entries: parseSessionEntries(text), ids: byId };
}

// prepareCompaction is not a root export in the development SDK pin (1.5.0).
// Resolve relative to its root module without starting Pi or calling a provider.
export async function nativePreparation(branch: SessionEntry[], settings: CompactionSettings): Promise<CompactionPreparation | undefined> {
  const module = await import(new URL("./core/compaction/compaction.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
  return module.prepareCompaction(branch, settings);
}

type SavedSession = ReturnType<typeof parseSavedSession>;
type SavedSessionOptions = { leaf?: string; keepRecentTokens?: number; contextWindow?: number; settings?: CompactionSettings };

export async function compactSavedSession(text: string, options: SavedSessionOptions = {}) {
  return compactParsedSession(parseSavedSession(text), options);
}

/** Reuse the strictly validated, SDK-normalized bundle without parsing its source again. */
async function compactParsedSession(parsed: SavedSession, options: SavedSessionOptions) {
  if (options.leaf !== undefined && !parsed.ids.has(options.leaf)) throw new Error("Selected leaf does not exist in session");
  const manager = SessionManager.inMemory(parsed.cwd, undefined, parsed.entries);
  const branch = manager.getBranch(options.leaf);
  const settings = { ...(options.settings ?? DEFAULT_COMPACTION_SETTINGS),
    ...(options.keepRecentTokens === undefined ? {} : { keepRecentTokens: natural(options.keepRecentTokens, "keepRecentTokens") }) };
  if (options.contextWindow !== undefined && natural(options.contextWindow, "contextWindow") === 0) throw new Error("contextWindow must be positive");
  const preparation = await nativePreparation(branch, settings);
  if (!preparation) throw new Error("Nothing eligible for native compaction at the selected leaf/retention setting");
  const signal = new AbortController().signal;
  const source = buildCompactionSource({ ...preparation, branchEntries: branch, cwd: parsed.cwd, signal });
  const compiled = compileCompactionSource(source, { signal });
  const result = fitCapacity(compiled, branch, preparation.firstKeptEntryId, preparation.tokensBefore, options.contextWindow, signal);
  return { ...result, branch, preparation, cwd: parsed.cwd, leaf: branch.at(-1)?.id, settings };
}

export function sessionDirectory(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.PI_CODING_AGENT_SESSION_DIR) return resolve(expand(env.PI_CODING_AGENT_SESSION_DIR));
  const agent = expand(env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"));
  const encoded = `--${resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return resolve(agent, "sessions", encoded);
}
export async function latestSavedSession(directory: string): Promise<string> {
  const names = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(names.filter(entry => entry.isFile() && entry.name.endsWith(".jsonl")).map(async entry => {
    const path = join(directory, entry.name); return { path, modified: (await stat(path)).mtimeMs };
  }));
  files.sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path));
  if (!files[0]) throw new Error("No saved JSONL sessions in selected directory");
  return files[0].path;
}
export async function readCompactionSettings(cwd: string, agentDir: string): Promise<CompactionSettings> {
  const settings = { ...DEFAULT_COMPACTION_SETTINGS };
  for (const path of [join(agentDir, "settings.json"), join(cwd, ".pi", "settings.json")]) {
    let text: string;
    try { text = await readFile(path, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    let value: unknown;
    try { value = JSON.parse(text.startsWith("\uFEFF") ? text.slice(1) : text); } catch { throw new Error(`Malformed settings JSON: ${path}`); }
    if (!object(value)) throw new Error(`Invalid settings object: ${path}`);
    if (value.compaction === undefined) continue;
    if (!object(value.compaction)) throw new Error(`Invalid compaction settings: ${path}`);
    for (const key of ["keepRecentTokens", "reserveTokens"] as const) {
      if (value.compaction[key] !== undefined) settings[key] = natural(value.compaction[key], key);
    }
    if (value.compaction.enabled !== undefined) {
      if (typeof value.compaction.enabled !== "boolean") throw new Error(`Invalid compaction enabled setting: ${path}`);
      settings.enabled = value.compaction.enabled;
    }
  }
  return settings;
}

const HELP = `Usage: bun run distill:session [session.jsonl|-] [options]
No input selects the latest saved session for the current project (not necessarily active).
  --latest                    Explicit latest saved session discovery
  --cwd PATH                  Project cwd for discovery (header cwd compiles the input)
  --session-dir PATH          Override discovery directory
  --leaf ID                   Select a branch leaf instead of the last saved entry
  --keep-recent-tokens N      Override native retained-tail token setting
  --context-window N          Known capacity; otherwise capacity remains unknown
  --help                      Show this help
Stdout is exact canonical summary bytes, with no added newline. Diagnostics go to stderr.
`;
export async function runSessionCli(args: string[], io: { cwd?: string; env?: NodeJS.ProcessEnv; stdin: () => Promise<string>; stdout: (text: string) => void; stderr: (text: string) => void }) {
  const env = io.env ?? process.env;
  let input: string | undefined, latest = false, cwd = io.cwd ?? process.cwd(), directory: string | undefined;
  const options: { leaf?: string; keepRecentTokens?: number; contextWindow?: number } = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--help") { io.stdout(HELP); return; }
    if (arg === "--latest") { latest = true; continue; }
    if (["--cwd", "--session-dir", "--leaf", "--keep-recent-tokens", "--context-window"].includes(arg)) {
      const value = args[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      if (arg === "--cwd") cwd = resolve(expand(value));
      else if (arg === "--session-dir") directory = resolve(expand(value));
      else if (arg === "--leaf") options.leaf = value;
      else {
        if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`Invalid decimal value for ${arg}`);
        const n = natural(Number(value), arg);
        if (arg === "--keep-recent-tokens") options.keepRecentTokens = n; else options.contextWindow = n;
      }
    } else if (arg.startsWith("-") && arg !== "-") throw new Error(`Unknown option: ${arg}`);
    else { if (input !== undefined) throw new Error("Specify only one session input"); input = arg; }
  }
  if (latest && input !== undefined) throw new Error("--latest cannot be combined with a session input");
  if (input !== undefined && directory !== undefined) throw new Error("--session-dir is only for latest discovery");
  const selected = input === "-" ? "stdin" : input === undefined ? await latestSavedSession(directory ?? sessionDirectory(cwd, env)) : resolve(expand(input));
  io.stderr(`${input === undefined ? "Latest saved session (not necessarily active)" : "Session input"}: ${selected}\n`);
  const text = input === "-" ? await io.stdin() : await readFile(selected, "utf8");
  const parsed = parseSavedSession(text);
  const agentDir = resolve(expand(env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent")));
  const settings = await readCompactionSettings(parsed.cwd, agentDir);
  const result = await compactParsedSession(parsed, { ...options, settings });
  io.stderr(`leaf=${result.leaf} cut=${result.preparation.firstKeptEntryId} keepRecentTokens=${result.settings.keepRecentTokens} reserveTokens=${result.settings.reserveTokens} tokensAfter=${result.tokensAfter} capacity=${result.knownWindow === undefined ? "unknown" : `within-window:${result.knownWindow}`}\n`);
  io.stdout(result.summary);
}
if (import.meta.main) {
  try { await runSessionCli(process.argv.slice(2), { stdin: () => Bun.stdin.text(), stdout: text => process.stdout.write(text), stderr: text => process.stderr.write(text) }); }
  catch (error) { process.stderr.write(`distill:session: ${error instanceof Error ? error.message : "compaction failed"}\n`); process.exitCode = 1; }
}
