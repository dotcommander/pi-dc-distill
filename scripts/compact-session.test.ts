import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compactSavedSession, parseSavedSession, runSessionCli, sessionDirectory, latestSavedSession, readCompactionSettings } from "./compact-session.ts";
import { decodeSummary } from "../lib/local-compact.ts";
import { createDistillExtension } from "../index.ts";
import { createPreparationHarness } from "../tests/harness/fake-pi.ts";

const timestamp = "2026-10-07T00:00:00.000Z";
const header = (cwd = "/tmp/distill-preparation-test") => ({ type: "session", version: 3, id: "saved-session", timestamp, cwd });
const message = (id: string, parentId: string | null, text: string, role = "user") => ({ type: "message", id, parentId, timestamp, message: { role, content: role === "assistant" ? [{ type: "text", text }] : text, timestamp: 1 } });
const fixture = (cwd?: string) => [header(cwd), ...Array.from({ length: 8 }, (_, i) => message(`m${i}`, i ? `m${i - 1}` : null, `native request ${i} ` + "body ".repeat(60)))];
const jsonl = (entries: unknown[]) => entries.map(entry => JSON.stringify(entry)).join("\n") + "\n";

/** Exercise the registered extension hook with the exact native preparation and capacity. */
function expectExtensionParity(result: Awaited<ReturnType<typeof compactSavedSession>>) {
  const host = createPreparationHarness();
  expect(result.knownWindow).toBe(host.ctx.model?.contextWindow);
  expect(result.cwd).toBe(host.ctx.cwd);
  createDistillExtension()(host.pi); host.setBranch(result.branch);
  host.emit("session_start", { reason: "startup" });
  const intercepted = host.emit("session_before_compact", { reason: "manual", signal: new AbortController().signal,
    branchEntries: result.branch, preparation: result.preparation });
  expect(intercepted).toHaveProperty("compaction.summary", result.summary);
}

describe("read-only native saved-session compaction", () => {
  test("standalone matches the actual extension interception for the same native preparation", async () => {
    const result = await compactSavedSession(jsonl(fixture()), { keepRecentTokens: 128, contextWindow: 200000 });
    expectExtensionParity(result);
    expect(result.knownWindow).toBe(200000);
    const decoded = decodeSummary(result.summary);
    const boundary = result.branch.findIndex(entry => entry.id === result.preparation.firstKeptEntryId);
    const retained = result.branch.slice(boundary).flatMap(entry => {
      if (entry.type !== "message") return [];
      if (entry.message.role !== "user" || typeof entry.message.content !== "string")
        throw new Error("Expected plain user messages in this retained-tail fixture");
      return [entry.message.content];
    });
    expect(decoded.records.every(row => !retained.includes(row.text))).toBe(true);
    expect(decoded.latestRequest?.text).not.toBe(retained.at(-1));
  });
  test("selected leaf excludes abandoned siblings and missing leaf fails", async () => {
    const entries = fixture();
    const result = await compactSavedSession(jsonl([...entries, message("sibling", "m1", "abandoned sibling")]), { leaf: "m7", keepRecentTokens: 128 });
    expect(result.branch.at(-1)?.id).toBe("m7");
    expect(result.summary).not.toContain("abandoned sibling");
    await expect(compactSavedSession(jsonl(entries), { leaf: "missing", keepRecentTokens: 128 })).rejects.toThrow("leaf");
  });
  test("matching predecessor carries through the shared compiler and retained tail stays excluded", async () => {
    const entries = fixture();
    const first = await compactSavedSession(jsonl(entries), { keepRecentTokens: 128 });
    const { sha256Hex } = await import("../lib/sha256.ts");
    const compaction = { type: "compaction", id: "compact", parentId: "m7", timestamp, summary: first.summary,
      firstKeptEntryId: first.preparation.firstKeptEntryId, tokensBefore: first.preparation.tokensBefore,
      details: { compactor: "dc-distill", summaryDigest: sha256Hex(first.summary) } };
    const second = await compactSavedSession(jsonl([...entries, compaction, message("new", "compact", "new request " + "x".repeat(400)), message("tail", "new", "retained tail " + "x".repeat(400))]), { keepRecentTokens: 1, contextWindow: 200000 });
    expectExtensionParity(second);
    expect(decodeSummary(second.summary).records.some(row => row.origin === "prior")).toBe(true);
    expect(second.summary).not.toContain("retained tail");
    await expect(compactSavedSession(jsonl([...entries, compaction]), { keepRecentTokens: 1 })).rejects.toThrow("Nothing eligible");
  });
  test("native split-turn preparation is preserved", async () => {
    const entries = [header(), message("u", null, "user constraint"),
      message("a1", "u", "first assistant " + "x".repeat(500), "assistant"),
      message("a2", "a1", "second assistant " + "x".repeat(500), "assistant"),
      message("a3", "a2", "retained assistant " + "x".repeat(500), "assistant")];
    const result = await compactSavedSession(jsonl(entries), { keepRecentTokens: 1, contextWindow: 200000 });
    expectExtensionParity(result);
    expect(result.preparation.isSplitTurn).toBe(true);
    expect(result.preparation.turnPrefixMessages.length).toBeGreaterThan(0);
    expect(result.summary).not.toContain("retained assistant");
  });
  test("rejects malformed JSON, unsupported headers, duplicate IDs, dangling parents and cycles before branch walking", () => {
    expect(() => parseSavedSession(jsonl(fixture()) + "{broken\n")).toThrow("Malformed JSONL");
    for (const version of [undefined, 2, 4]) expect(() => parseSavedSession(jsonl([{ ...header(), version }]))).toThrow("version 3");
    expect(() => parseSavedSession(jsonl([header(), message("dup", null, "a"), message("dup", null, "b")]))).toThrow("Duplicate");
    expect(() => parseSavedSession(jsonl([header(), message("a", "missing", "a")]))).toThrow("Dangling");
    expect(() => parseSavedSession(jsonl([header(), message("a", "b", "a"), message("b", "a", "b")]))).toThrow("Cycle");
    expect(() => parseSavedSession(jsonl([{ ...header(), cwd: "relative" }]))).toThrow("header");
    expect(() => parseSavedSession(jsonl([header(), { ...message("a", null, "a"), type: "unknown" }]))).toThrow("identity");
  });
  test("CLI selected-leaf compaction matches the text API and still rejects invalid abandoned records", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dc-session-branch-"));
    try {
      const text = jsonl([...fixture(dir), message("sibling", "m1", "abandoned sibling")]);
      const options = { leaf: "m7", keepRecentTokens: 128, contextWindow: 200000 };
      const expected = await compactSavedSession(text, options);
      const args = ["-", "--leaf", "m7", "--keep-recent-tokens", "128", "--context-window", "200000"];
      const env = { PI_CODING_AGENT_DIR: dir };
      let output = "", diagnostics = "";
      await runSessionCli(args, { env, stdin: async () => text, stdout: s => { output += s; }, stderr: s => { diagnostics += s; } });
      expect(output).toBe(expected.summary);
      expect(diagnostics).toContain("leaf=m7");
      expect(output).not.toContain("abandoned sibling");

      const invalid = [
        jsonl([...fixture(dir), message("bad", "missing", "abandoned invalid parent")]),
        jsonl([...fixture(dir), message("m1", null, "abandoned duplicate")]),
        jsonl([...fixture(dir), message("a", "b", "abandoned cycle"), message("b", "a", "abandoned cycle")]),
        text + "{broken\n",
      ];
      const errors = ["Dangling session parent reference", "Duplicate session entry identity", "Cycle in session parent references", "Malformed JSONL at line 11"];
      for (const [index, source] of invalid.entries()) {
        let emitted = "";
        await expect(runSessionCli(args, { env, stdin: async () => source, stdout: s => { emitted += s; }, stderr: () => {} }))
          .rejects.toThrow(errors[index]!);
        expect(emitted).toBe("");
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  test("BOM settings, file, explicit stdin and latest discovery preserve settings and emit only canonical bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dc-session-runner-"));
    try {
      const cwd = join(dir, "project"), agent = join(dir, "agent"), sessions = join(dir, "sessions");
      await mkdir(join(cwd, ".pi"), { recursive: true }); await mkdir(agent); await mkdir(sessions);
      const global = '\uFEFF{"compaction":{"keepRecentTokens":32,"reserveTokens":100}}';
      const project = '\uFEFF{"compaction":{"keepRecentTokens":64}}';
      await writeFile(join(agent, "settings.json"), global); await writeFile(join(cwd, ".pi", "settings.json"), project);
      const text = jsonl(fixture(cwd)), old = join(sessions, "old.jsonl"), newest = join(sessions, "new.jsonl");
      await writeFile(old, text); await writeFile(newest, text); await utimes(old, new Date(0), new Date(0));
      expect(await latestSavedSession(sessions)).toBe(newest);
      expect(await readCompactionSettings(cwd, agent)).toMatchObject({ keepRecentTokens: 64, reserveTokens: 100 });
      const env = { PI_CODING_AGENT_DIR: agent, PI_CODING_AGENT_SESSION_DIR: sessions };
      const outputs: string[] = [];
      for (const args of [[newest], ["-"], [], ["--latest", "--session-dir", sessions], [newest, "--keep-recent-tokens", "64", "--context-window", "200000"]]) {
        let out = "", err = "", stdinCalls = 0;
        await runSessionCli(args, { cwd, env, stdin: async () => { stdinCalls++; return text; }, stdout: s => { out += s; }, stderr: s => { err += s; } });
        expect(decodeSummary(out).format).toBe("dc-distill-summary");
        expect(out.endsWith("</dc-distill-summary>")).toBe(true);
        expect(err).toContain(args.includes("--context-window") ? "capacity=within-window:200000" : "capacity=unknown");
        expect(stdinCalls).toBe(args.includes("-") ? 1 : 0);
        expect(err).toContain("keepRecentTokens=64 reserveTokens=100");
        if (!args.length) expect(err).toContain("Latest saved session (not necessarily active)");
        outputs.push(out);
      }
      expect(new Set(outputs).size).toBe(1);
      const expectedOutput = outputs[0];
      if (expectedOutput === undefined) throw new Error("Missing file-input CLI fixture output");
      const cli = Bun.spawn([process.execPath, fileURLToPath(new URL("./compact-session.ts", import.meta.url)), newest],
        { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exit] = await Promise.all([new Response(cli.stdout).text(), new Response(cli.stderr).text(), cli.exited]);
      expect(exit).toBe(0); expect(stdout).toBe(expectedOutput); expect(stderr).toContain("capacity=unknown");
      let override = "";
      await runSessionCli([newest, "--keep-recent-tokens", "128"], { cwd, env, stdin: async () => text,
        stdout: () => {}, stderr: s => { override += s; } });
      expect(override).toContain("keepRecentTokens=128");
      expect(await readFile(newest, "utf8")).toBe(text);
      expect(await readFile(join(agent, "settings.json"), "utf8")).toBe(global);
      expect(await readFile(join(cwd, ".pi", "settings.json"), "utf8")).toBe(project);
      expect(sessionDirectory(cwd, env)).toBe(sessions);
      expect(sessionDirectory(cwd, { PI_CODING_AGENT_DIR: agent })).toBe(join(agent, "sessions", `--${cwd.slice(1).replaceAll("/", "-")}--`));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
