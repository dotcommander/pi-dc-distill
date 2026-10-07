import { sha256Identity } from "../sha256.ts";
import { describe, expect, test } from "bun:test";
import { emptyOmissions } from "./helpers.ts";
import { certifyToolPairs, extractObservations } from "./tool-tracker.ts";
import type { CompactionSource, DcDistillSummary, NormalizedRecord } from "./types.ts";

function source(records: NormalizedRecord[], overrides: Partial<CompactionSource> = {}, certify = true): CompactionSource {
  const duplicateCallIds = certify ? certifyToolPairs(records) : [];
  return { records, predecessor: null, duplicateCallIds, omittedInputRecords: 0,
    session: { cwd: "/project" }, ...overrides };
}

function call(name: string, args: Record<string, unknown>, callId?: string): Extract<NormalizedRecord, { kind: "tool-call" }> {
  return { kind: "tool-call", text: "", name, args, callId, pairing: { state: "unpairable" } };
}
function result(name: string, callId?: string, isError?: boolean, text = "output"): Extract<NormalizedRecord, { kind: "tool-result" }> {
  return { kind: "tool-result", text, name, callId, isError, pairing: { state: "unpairable" } };
}
function predecessor(): DcDistillSummary {
  return { format: "dc-distill-summary", notice: "Selected conversation excerpts and observations; incomplete.",
    focus: null, latestRequest: null, records: [], files: { read: [], modified: [] }, commands: [], omitted: emptyOmissions() };
}

describe("lightweight observations", () => {
  test("certifies sequential pairs with exact raw names independently of explicit IDs", () => {
    const records = [call("read", { path: "first" }), result("read", undefined, false),
      call("READ", { path: "uppercase" }), call("read", { path: "second" }),
      call("read", { path: "identified" }, "id"), result("read", "id", false),
      result("read", undefined, false), result("READ", undefined, false)];
    certifyToolPairs(records);
    expect(records.map(record => record.kind === "tool-call" || record.kind === "tool-result" ? record.pairing.state === "certified-idless" ? record.pairing.key : undefined : undefined)).toEqual([0, 0, 2, 1, undefined, undefined, 1, 2]);
    expect(extractObservations(source(records)).files.read.map(row => row.path)).toEqual(["first", "identified", "second", "uppercase"]);
  });
  test("certified pairs cannot be redirected when an earlier result or unique call is omitted", () => {
    const records = [call("read", { path: "first" }), result("read", undefined, false),
      call("read", { path: "second" }), result("read", undefined, false)];
    certifyToolPairs(records);
    expect(extractObservations(source([records[0], records[2], records[3]], {}, false)).files.read.map(row => row.path)).toEqual(["second"]);
    expect(extractObservations(source([records[0], records[1], records[3]], {}, false)).files.read.map(row => row.path)).toEqual(["first"]);
    const extra = result("read", undefined, false);
    if (extra.kind === "tool-result") extra.pairing = { state: "unpairable" };
    expect(extractObservations(source([records[0], extra], {}, false)).files.read).toEqual([]);
    // A certificate requires a matching raw tool name, even with a shared key.
    expect(extractObservations(source([records[0], { ...records[1], name: "READ" }], {}, false)).files.read).toEqual([]);
  });
  test("requires exact raw name, unique ID, and explicit successful result for files", () => {
    const facts = extractObservations(source([
      call("READ", { path: "wrong" }, "a"), result("read", "a", false),
      call("read", { path: "missing-error" }, "b"), result("read", "b"),
      call("read", { path: "failed" }, "c"), result("read", "c", true),
      call("READ", { path: "right" }, "d"), result("READ", "d", false),
    ]));
    expect(facts.files.read.map((row) => row.path)).toEqual(["right"]);
  });

  test("duplicates anywhere in the input and omitted duplicate calls remain ambiguous", () => {
    for (const records of [
      [call("read", { path: "x" }, "a"), result("read", "a", false), call("read", { path: "y" }, "a")],
      [call("read", { path: "x" }, "a"), result("read", "a", false), result("read", "a", false)],
    ]) expect(extractObservations(source(records)).files.read).toEqual([]);
    const full = [call("read", { path: "x" }, "a"), result("read", "a", false), call("read", { path: "y" }, "a")];
    const duplicateCallIds = certifyToolPairs(full);
    expect(extractObservations(source(full.slice(0, 2), { duplicateCallIds, omittedInputRecords: 1 }, false)).files.read).toEqual([]);
  });

  test("ID-less certification requires exactly one pending call with the same raw name", () => {
    const facts = extractObservations(source([
      call("read", { path: "ambiguous-a" }), call("read", { path: "ambiguous-b" }), result("read", undefined, false),
      call("view_file", { path: "unique" }), result("view_file", undefined, false),
      call("write", { path: "identified" }, "id"), result("write", undefined, false),
    ]));
    expect(facts.files.read.map((row) => row.path)).toEqual(["unique"]);
    expect(facts.files.modified).toEqual([]);
  });

  test("retains exact aliases, path precedence, and create-capable distinction", () => {
    const aliases = ["edit", "write", "edit_file", "write_file", "multiedit", "write_to_file", "replace_file_content", "patch_file", "create_file"];
    const records = aliases.flatMap((name, i) => [call(name, { file_path: `${name}.ts`, TargetFile: "ignored" }, String(i)), result(name, String(i), false)]);
    const facts = extractObservations(source([...records, call("view_file", { path: "first", file_path: "ignored" }, "r"), result("view_file", "r", false)]));
    expect(facts.files.read[0].path).toBe("first");
    expect(facts.files.modified.map((row) => [row.path, row.createCapable])).toEqual(aliases.map((name) => [`${name}.ts`, ["write", "write_file", "write_to_file", "create_file"].includes(name)]));
  });

  test("hashes full lexical identities before shortening and latest observations win", () => {
    const long = "🙂".repeat(512);
    const facts = extractObservations(source([
      call("read", { path: `${long}a` }, "a"), result("read", "a", false),
      call("read", { path: `${long}b` }, "b"), result("read", "b", false),
      call("read", { path: "./x" }, "c"), result("read", "c", false),
      call("read", { path: "x" }, "d"), result("read", "d", false),
      call("read", { path: "./x" }, "e"), result("read", "e", false),
      call("read", { path: "x", cwd: "/other" }, "f"), result("read", "f", false),
    ]));
    expect(facts.files.read.map((row) => row.path)).toEqual([long, long, "x", "./x", "x"]);
    expect(facts.files.read[0].identityDigest).toBe(sha256Identity(JSON.stringify(["dc-distill-file", `${long}a`, "/project"])));
    expect(facts.files.read[0].identityDigest).not.toBe(facts.files.read[1].identityDigest);
    expect(facts.files.read[0].shortened).toBe(true);
    expect(facts.files.read[2].identityDigest).not.toBe(facts.files.read[4].identityDigest);
  });

  test("command outcomes follow the recorded result and preserve exact command and cwd", () => {
    const names = ["bash", "shell", "jinn_run_shell", "functions.bash"];
    const records = names.flatMap((name, i) => [call(name, { command: "cd elsewhere && false", cmd: "ignored", cwd: "/launch" }, String(i)), result(name, String(i), [false, true, undefined, false][i], "PASS prose")]);
    const commands = extractObservations(source(records)).commands;
    expect(commands.map((row) => row.status)).toEqual(["success", "error", "unknown", "success"]);
    expect(commands.every((row) => row.cwd === "/launch" && row.command === "cd elsewhere && false")).toBe(true);
    expect(commands[0].identityDigest).toBe(sha256Identity(JSON.stringify(["dc-distill-command", "bash", "cd elsewhere && false", "/launch"])));
    const unknown = extractObservations(source([call("shell", { cmd: "go test" }, "x"), result("shell", "x", false)],
      { session: { cwd: "" } })).commands[0];
    expect(unknown.cwd).toBeNull();
    expect(unknown.identityDigest).toBe(sha256Identity(JSON.stringify(["dc-distill-command", "shell", "go test", null])));
  });

  test("native bash requires integer exit status and cancellation stays unknown", () => {
    const commands = extractObservations(source([
      { kind: "bash", text: "", command: "a", output: "ok", exitCode: 0 },
      { kind: "bash", text: "", command: "b", output: "", exitCode: 1 },
      { kind: "bash", text: "", command: "c", output: "" },
      { kind: "bash", text: "", command: "d", output: "", exitCode: 0, cancelled: true },
      { kind: "bash", text: "", command: "e", output: "", exitCode: 0.5 },
    ])).commands;
    expect(commands.map((row) => row.status)).toEqual(["success", "error", "unknown", "unknown", "unknown"]);
  });

  test("carried facts become prior and carried call display text never pairs anew", () => {
    const prior = predecessor();
    const first = extractObservations(source([call("read", { path: "x" }, "a"), result("read", "a", false), call("bash", { command: "test" }, "b"), result("bash", "b", false)]));
    prior.files = first.files;
    prior.commands = first.commands;
    prior.records = [{ kind: "tool-call", text: '{"name":"read","callId":"a","args":{"path":"invented"}}', shortened: false, origin: "current" }];
    const facts = extractObservations(source([result("read", "a", false)], { predecessor: prior }));
    expect(facts.files.read).toEqual(first.files.read.map((row) => ({ ...row, origin: "prior" })));
    expect(facts.commands[0].origin).toBe("prior");
    expect(prior.files.read[0].origin).toBe("current");
    const refreshed = extractObservations(source([call("read", { path: "x" }, "new"), result("read", "new", false)], { predecessor: prior }));
    expect(refreshed.files.read).toHaveLength(1);
    expect(refreshed.files.read[0].origin).toBe("current");
  });

  test("command identity precedes bounded display and repeated receipts remain distinct", () => {
    const command = "🙂".repeat(600);
    const cwd = "x".repeat(600);
    const facts = extractObservations(source([
      call("bash", { command, cwd }, "a"), result("bash", "a", false, "🙂".repeat(400)),
      call("bash", { command, cwd }, "b"), result("bash", "b", true),
    ]));
    expect(facts.commands).toHaveLength(2);
    expect(facts.commands[0].identityDigest).toBe(sha256Identity(JSON.stringify(["dc-distill-command", "bash", command, cwd])));
    expect(Array.from(facts.commands[0].command)).toHaveLength(512);
    expect(Array.from(facts.commands[0].result)).toHaveLength(300);
    expect(facts.commands[0].cwd).toHaveLength(512);
    expect(facts.commands[0].shortened).toBe(true);
  });
});
