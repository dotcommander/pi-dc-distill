import { describe, expect, test } from "bun:test";
import { certifyMessageGroups } from "./tool-certification.ts";
import { normalizeMessage } from "./normalizer.ts";
import { extractObservations } from "./tool-tracker.ts";
import type { CompactionSource } from "./types.ts";

function facts(groups: ReturnType<typeof certifyMessageGroups>, retained = groups.groups) {
  const source: CompactionSource = { records: retained.flat(), predecessor: null,
    duplicateCallIds: groups.duplicateCallIds, omittedInputRecords: 0, session: { cwd: "/project" } };
  return extractObservations(source);
}
const call = (path: string, id?: string) => normalizeMessage({ role: "assistant", content: [
  { type: "toolCall", name: "read", arguments: { path }, ...(id === undefined ? {} : { id }) },
] });
const result = (id?: string) => normalizeMessage({ role: "toolResult", toolName: "read", isError: false,
  ...(id === undefined ? {} : { toolCallId: id }), content: "ok" });

describe("copied message-group certification", () => {
  test("accepts frozen raw groups and does not mutate or alias caller arguments", () => {
    const raw = call("original");
    const record = raw[0]!;
    if (record.kind !== "tool-call") throw new Error("expected call");
    Object.freeze(record);
    Object.freeze(raw);
    const certified = certifyMessageGroups(Object.freeze([raw, Object.freeze(result())]));
    expect(record).not.toHaveProperty("pairing");
    record.args.path = "mutated after certification";
    expect(facts(certified).files.read.map(row => row.path)).toEqual(["original"]);
    const copied = certified.groups[0]![0]!;
    expect(Object.isFrozen(copied)).toBe(true);
    if (copied.kind !== "tool-call") throw new Error("expected copied call");
    expect(Object.isFrozen(copied.args)).toBe(true);
    expect(Object.isFrozen(copied.pairing)).toBe(true);
  });
  test("preserves group boundaries, chronological certificates and omitted ambiguity", () => {
    const certified = certifyMessageGroups([call("first"), result(), call("second"), result(),
      call("identified", "duplicate"), result("duplicate"), call("omitted", "duplicate")]);
    expect(certified.groups.map(group => group.length)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(certified.duplicateCallIds).toEqual(["duplicate"]);
    expect(facts(certified, certified.groups.slice(0, 6)).files.read.map(row => row.path)).toEqual(["first", "second"]);
    expect(facts(certified, [certified.groups[0]!, certified.groups[2]!, certified.groups[3]!]).files.read.map(row => row.path)).toEqual(["second"]);
  });
});
