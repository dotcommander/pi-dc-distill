import { describe, expect, test } from "bun:test";
import { commandRow, decodeSummary, encodeSummary, fileRow, recordRow, serializedRowCost, summaryCost } from "./summary-codec.ts";
import { SUMMARY_FORMAT, SUMMARY_NOTICE } from "./contract.ts";
import { emptyOmissions } from "./helpers.ts";
import { codePointLength } from "../unicode.ts";
import type { DcDistillSummary } from "./types.ts";

function document(): DcDistillSummary {
  return { format: SUMMARY_FORMAT, notice: SUMMARY_NOTICE, focus: null, latestRequest: null,
    records: [], files: { read: [], modified: [] }, commands: [], omitted: emptyOmissions() };
}
describe("shared escaped serialization cost", () => {
  test("cost of each optional lane equals its exact encoded framing delta", () => {
    const text = '😀 | \\ \r\n "quoted"';
    const record = { kind: "assistant" as const, origin: "current" as const, shortened: false, text };
    const file = { identityDigest: "A".repeat(22), origin: "prior" as const, shortened: true, createCapable: true, path: text };
    const command = { identityDigest: "B".repeat(22), origin: "current" as const, shortened: false,
      runner: "bash", command: text, cwd: text, result: text, status: "unknown" as const };
    for (const [row, add] of [
      [recordRow(record), (value: DcDistillSummary) => value.records.push(record)],
      [fileRow("read", file), (value: DcDistillSummary) => value.files.read.push(file)],
      [fileRow("modified", file), (value: DcDistillSummary) => value.files.modified.push(file)],
      [commandRow(command), (value: DcDistillSummary) => value.commands.push(command)],
    ] as const) {
      const value = document();
      const base = summaryCost(value);
      add(value);
      expect(summaryCost(value) - base).toBe(serializedRowCost(row) + 1);
      expect(summaryCost(value)).toBe(codePointLength(encodeSummary(value)));
      expect(encodeSummary(decodeSummary(encodeSummary(value)))).toBe(encodeSummary(value));
    }
  });
  test("encoder retains its public shape and Unicode checks", () => {
    const value = document();
    value.focus = "\ud800";
    expect(() => encodeSummary(value)).toThrow("malformed decoded Unicode");
    value.focus = null;
    value.omitted.excerpts = Number.MAX_SAFE_INTEGER + 1;
    expect(() => encodeSummary(value)).toThrow("incompatible dc-distill summary shape");
  });
});
