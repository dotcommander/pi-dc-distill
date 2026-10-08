import { describe, expect, test } from "bun:test";
import { resolveCwd } from "./cwd.ts";
import { extractObservations } from "./tool-tracker.ts";
import { certifyMessageGroups } from "./tool-certification.ts";
import { normalizeMessage } from "./normalizer.ts";
import { sha256Identity } from "../sha256.ts";

describe("lexical launch directory", () => {
  test("missing, null and non-string inherit; explicit empty is unknown", () => {
    for (const value of [undefined, null, 0, false, {}]) expect(resolveCwd(value, "/session")).toBe("/session");
    expect(resolveCwd("", "/session")).toBeNull();
    expect(resolveCwd("./exact/../cwd", "/session")).toBe("./exact/../cwd");
  });
  test("native bash and tool commands share exact cwd identities", () => {
    for (const cwd of [undefined, null, "", "./literal"]) {
      const certified = certifyMessageGroups([
        normalizeMessage({ role: "bashExecution", command: "run", output: "ok", exitCode: 0, cwd }),
        normalizeMessage({ role: "assistant", content: [{ type: "toolCall", name: "bash", id: "id", arguments: { command: "run", cwd } }] }),
        normalizeMessage({ role: "toolResult", toolName: "bash", toolCallId: "id", isError: false, content: "ok" }),
      ]);
      const commands = extractObservations({ records: certified.groups.flat(), duplicateCallIds: certified.duplicateCallIds,
        predecessor: null, omittedInputRecords: 0, session: { cwd: "/session" } }).commands;
      const expected = resolveCwd(cwd, "/session");
      expect(commands.map(row => row.cwd)).toEqual([expected, expected]);
      expect(commands.map(row => row.identityDigest)).toEqual([0, 1].map(() => sha256Identity(JSON.stringify(["dc-distill-command", "bash", "run", expected]))));
    }
  });
});
