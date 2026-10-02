import { describe, expect, test } from "bun:test";
import { compileSessionJsonl } from "../local-compact.ts";
import { gitProbeScope, pathIdentity, verificationIdentity } from "./tool-tracker.ts";

const call = (name: string, args: Record<string, unknown>, id?: string) => ({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", name, arguments: args, id }] } });
const result = (name: string, id?: string, isError: boolean | undefined = false, text = "") => ({ type: "message", message: { role: "toolResult", toolName: name, toolCallId: id, isError, content: [{ type: "text", text }] } });
const check = (id: string) => call("bash", { command: "bun test" }, id);
const write = (id?: string, path = "src/parser.ts") => call("patch_file", { path }, id);
function compile(records: unknown[], cwd: string | false = "/tmp/project") {
  return compileSessionJsonl([{ type: "session", cwd: cwd === false ? undefined : cwd }, { type: "message", message: { role: "user", content: "Repair the parser and establish verification evidence." } }, ...records].map((entry) => JSON.stringify(entry)).join("\n"));
}
const verification = (summary: string) => summary.match(/<verification>\n([\s\S]*?)\n<\/verification>/)?.[1] ?? "";
const risks = (summary: string) => summary.match(/<resume-risks>\n([\s\S]*?)\n<\/resume-risks>/)?.[1] ?? "";

describe("conservative tool pairing", () => {
  test("duplicate IDs are rejected across names and even after an earlier result", () => {
    for (const other of ["patch_file", "view_file"]) {
      const output = compile([write("duplicate"), result("patch_file", "duplicate"), call(other, { path: "other.ts" }, "duplicate"), result(other, "duplicate")]);
      expect(output.modifiedFiles).toEqual([]);
      expect(output.readFiles).toEqual([]);
      expect(risks(output.summary)).toContain("Unmatched patch_file");
    }
  });
  test("an ID cannot override a contradictory raw name", () => {
    const output = compile([write("mutation"), result("write_file", "mutation")]);
    expect(output.modifiedFiles).toEqual([]);
    expect(risks(output.summary)).toContain("Unmatched patch_file");
  });
  test("ID-less pairing requires one same-name ID-less candidate", () => {
    const ambiguous = compile([write("identified"), write(undefined), write(undefined, "other.ts"), result("patch_file")]);
    expect(ambiguous.modifiedFiles).toEqual([]);
    const unique = compile([write("identified"), call("patch_file", { path: "unique.ts" }), result("patch_file")]);
    expect(unique.modifiedFiles).toEqual(["unique.ts"]);
  });
});

describe("structural write risks", () => {
  test("terminal risks retire across aliases and lexical absolute/relative paths", () => {
    const output = compile([write("bad", "src/../src/parser.ts"), result("patch_file", "bad", true), call("view_file", { path: "/tmp/project/src/parser.ts" }, "inspect"), result("view_file", "inspect")]);
    expect(risks(output.summary)).toBe("");
    expect(output.modifiedFiles).toEqual([]);
    expect(pathIdentity("src/../src/parser.ts", "/tmp/project")).toBe("/tmp/project/src/parser.ts");
  });
  test("a successful alternate write retires a terminal failure", () => {
    const output = compile([write("bad"), result("patch_file", "bad", true), call("replace_file_content", { path: "./src/parser.ts" }, "retry"), result("replace_file_content", "retry")]);
    expect(risks(output.summary)).toBe("");
    expect(output.modifiedFiles).toEqual(["./src/parser.ts"]);
  });
  test("long shared prefixes never collide and later inspections retire the exact identity", () => {
    const prefix = `src/${"long".repeat(160)}`;
    const output = compile([write("a", `${prefix}/a.ts`), result("patch_file", "a", true), write("b", `${prefix}/b.ts`), result("patch_file", "b", true), call("view_file", { path: `${prefix}/a.ts` }, "read"), result("view_file", "read")]);
    expect(risks(output.summary)).toContain("inspect before retry");
    expect(risks(output.summary).match(/Failed patch_file/g)).toHaveLength(1);
    expect(risks(output.summary)).toContain("path sha256:");
  });
  test("reads cannot retire pending mutations or inspections started before completion", () => {
    for (const finishMutation of [false, true]) {
      const records: unknown[] = [write("pending"), call("view_file", { path: "src/parser.ts" }, "read")];
      if (finishMutation) records.push(result("patch_file", "pending", true));
      records.push(result("view_file", "read"));
      expect(risks(compile(records).summary)).toContain("inspect before retry");
    }
  });
});

describe("mutation lifetimes", () => {
  test("pending and failed mutations fence earlier passes", () => {
    for (const completed of [false, true]) {
      const output = compile([check("check"), result("bash", "check"), write("mutation"), ...(completed ? [result("patch_file", "mutation", true)] : [])]);
      expect(verification(output.summary)).toContain("freshness: not established");
      expect(output.modifiedFiles).toEqual([]);
    }
  });
  test("both persisted mixed-batch result orders remain stale", () => {
    for (const order of [0, 1]) for (const writeFirst of [false, true]) {
      const submissions = writeFirst ? [write("mutation"), check("check")] : [check("check"), write("mutation")];
      const completions = order === 0 ? [result("bash", "check"), result("patch_file", "mutation")] : [result("patch_file", "mutation"), result("bash", "check")];
      expect(verification(compile([...submissions, ...completions]).summary)).toContain("freshness: not established");
    }
  });
  test("a later check restores freshness after a failed mutation finishes", () => {
    const output = compile([write("mutation"), result("patch_file", "mutation", true), check("check"), result("bash", "check")]);
    expect(verification(output.summary)).toContain("PASS [bash cwd=/tmp/project]: bun test — no output");
    expect(verification(output.summary)).not.toContain("freshness: not established");
  });
  test("silent explicit successes pass; diagnostic missing status is incomplete", () => {
    expect(verification(compile([check("check"), result("bash", "check")]).summary)).toContain("PASS");
    const missing = { type: "message", message: { role: "toolResult", toolName: "bash", toolCallId: "check", content: [] } };
    expect(verification(compile([check("check"), missing]).summary)).toContain("INCOMPLETE");
    const missingWrite = { type: "message", message: { role: "toolResult", toolName: "patch_file", toolCallId: "mutation", content: [] } };
    expect(compile([write("mutation"), missingWrite]).modifiedFiles).toEqual([]);
  });
  test("identity preserves exact runner, command bytes and known cwd before rendering", () => {
    const command = `bun  test ${"src/".repeat(400)}parser.test.ts`;
    const call = { name: "functions.bash", args: { command, cwd: "/tmp/project" } };
    expect(verificationIdentity(call)).toBe(JSON.stringify(["functions.bash", command, "/tmp/project"]));
    expect(verificationIdentity({ ...call, args: { ...call.args, command: command.replace("bun  test", "bun test") } })).not.toBe(verificationIdentity(call));
  });
  test("unknown cwd cannot establish fresh scoped verification", () => {
    const output = compile([check("check"), result("bash", "check")], false);
    expect(verification(output.summary)).toContain("cwd=unknown");
    expect(verification(output.summary)).toContain("freshness: not established");
  });
});

describe("Git probe scope", () => {
  test("quoted mentions and unsupported compounds never produce Git receipts", () => {
    for (const command of ["echo 'git status'", "printf 'git diff --stat'", "git status; rm x", "git diff --stat | cat", "git status && git diff --stat"]) {
      expect(gitProbeScope(command)).toBeUndefined();
      expect(compile([call("bash", { command }, "git"), result("bash", "git")]).summary).not.toContain("[git receipt,");
    }
  });
  test("revision, index, worktree, whitespace and path scopes remain distinct", () => {
    expect(gitProbeScope("git status --short")).toBe("working-tree status");
    expect(gitProbeScope("git diff --stat")).toBe("worktree diff (unstaged tracked files); stat");
    expect(gitProbeScope("git diff HEAD~1 HEAD --stat")).toBe("revision comparison; stat");
    expect(gitProbeScope("git diff --cached --name-only")).toBe("index diff; names");
    expect(gitProbeScope("git diff --check -- src/parser.ts")).toBe("worktree diff (unstaged tracked files) (path-limited); whitespace check");
    for (const command of ["git diff HEAD~1 HEAD --stat", "git diff --check", "git diff --stat"]) {
      const output = compile([call("bash", { command }, "git"), result("bash", "git")]);
      expect(output.summary).toContain(command);
      expect(output.summary).toContain("working-tree cleanliness not established");
      expect(output.summary).not.toContain(": clean");
      expect(output.summary).not.toContain(": no diff");
    }
  });
  test("later pending mutation stales Git observations", () => {
    const output = compile([call("bash", { command: "git status --short" }, "git"), result("bash", "git", false, " M src/parser.ts"), write("pending")]);
    expect(output.summary).toContain("scope=working-tree status");
    expect(output.summary).toContain(" M src/parser.ts".trim());
    expect(output.summary).toContain("[freshness: not established]");
  });
});
