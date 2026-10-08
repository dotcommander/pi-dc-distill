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
    value.focus = { text: "\ud800", shortened: false };
    expect(() => encodeSummary(value)).toThrow("malformed decoded Unicode");
    value.focus = null;
    value.omitted.excerpts = Number.MAX_SAFE_INTEGER + 1;
    expect(() => encodeSummary(value)).toThrow("incompatible dc-distill summary shape");
    expect(() => summaryCost(value)).toThrow("incompatible dc-distill summary shape");
  });
});

function errorCode(action: () => unknown): string {
  try { action(); } catch (error) {
    if (error instanceof Error && "code" in error) return String(error.code);
    throw error;
  }
  throw new Error("expected codec rejection");
}

// Build full documents, including row separators, to hit exact Unicode limits.
function sizedDocument(size: number): DcDistillSummary {
  const value = document();
  while (summaryCost(value) < size) {
    value.records.push({ kind: "assistant", origin: "current", shortened: false, text: "" });
    const remaining = size - summaryCost(value);
    if (remaining < 0) throw new Error("unreachable fixture size");
    value.records.at(-1)!.text = "😀".repeat(Math.min(2048, remaining));
  }
  return value;
}

describe("canonical public codec boundaries", () => {
  test("accepts exactly 65,536 code points and measures oversized valid documents", () => {
    const exact = sizedDocument(65_536);
    const serialized = encodeSummary(exact);
    expect(codePointLength(serialized)).toBe(65_536);
    expect(decodeSummary(serialized)).toEqual(exact);
    exact.records.at(-1)!.text += "😀";
    expect(summaryCost(exact)).toBe(65_537);
    expect(errorCode(() => encodeSummary(exact))).toBe("protected_overflow");
    exact.records.at(-1)!.text = "\ud800";
    expect(errorCode(() => summaryCost(exact))).toBe("invalid_input");
  });

  test("rejects noncanonical escaped text and counter spellings", () => {
    const value = document();
    value.focus = { text: "a|b\rc", shortened: false };
    const canonical = encodeSummary(value);
    for (const candidate of [
      canonical.replace("a\\|b", "a|b"),
      canonical.replace("b\\rc", "b\rc"),
      canonical.replace("input=0", "input=00"),
      canonical.replace("input=0", "input=+0"),
      canonical.replace("input=0", "input=-1"),
    ]) expect(errorCode(() => decodeSummary(candidate))).toBe("invalid_input");
  });

  test("noncanonical input crossing the canonical size cap is invalid input", () => {
    // The raw pipe is one code point shorter than its canonical escape. The
    // parser accepts its shape, but canonicality must reject before encoding.
    const value = sizedDocument(65_536);
    const fitting = encodeSummary(value);
    const last = value.records.at(-1)!;
    last.text = Array.from(last.text).slice(0, -1).join("") + "|";
    expect(summaryCost(value)).toBe(65_537);
    expect(errorCode(() => encodeSummary(value))).toBe("protected_overflow");
    const marker = "\nfiles:";
    const boundary = fitting.indexOf(marker);
    const noncanonical = fitting.slice(0, boundary - "😀".length) + "|" + fitting.slice(boundary);
    expect(codePointLength(noncanonical)).toBe(65_536);
    expect(errorCode(() => decodeSummary(noncanonical))).toBe("invalid_input");
  });

  test("repeated command identities preserve ordered differing outcomes", () => {
    const value = document();
    const command = { identityDigest: "B".repeat(22), origin: "current" as const, shortened: false,
      runner: "bash", command: "bun test", cwd: null, result: "", status: "unknown" as const };
    value.commands = [
      { ...command, status: "error", result: "failed" },
      { ...command, status: "success", result: "passed" },
      command,
    ];
    expect(decodeSummary(encodeSummary(value))).toEqual(value);
  });

  test("fixed canonical fixture pins every section and wire spelling", () => {
    const value = document();
    value.focus = { text: "focus | \\ \r\n😀", shortened: false };
    value.latestRequest = { text: 'say "yes" |', origin: "prior", shortened: true, afterRecords: 1 };
    value.records = [{ kind: "user", origin: "current", shortened: false, text: "a|b" }];
    value.files.read = [{ identityDigest: "A".repeat(22), origin: "prior", shortened: true, createCapable: false, path: "/a|b" }];
    value.files.modified = [{ identityDigest: "A".repeat(22), origin: "current", shortened: false, createCapable: true, path: "/new" }];
    value.commands = [{ identityDigest: "B".repeat(22), origin: "current", shortened: false, runner: "bash", status: "success", cwd: "", command: "echo |", result: "\n" },
      { identityDigest: "B".repeat(22), origin: "prior", shortened: true, runner: "shell", status: "error", cwd: null, command: "false", result: "failed" }];
    value.omitted = { inputRecords: 1, excerpts: 2, readFiles: 3, modifiedFiles: 4, commands: 5 };
    const fixture = [
      "<dc-distill-summary>",
      "notice: Selected conversation excerpts and observations; incomplete.",
      "columns: records=kind|origin|cut|text ; files=section id|origin|cut|create|path ; commands=cmd id|origin|cut|runner|status|cwd|command|result ; current=selected input, prior=carried context; full/cut=no known text clipping/clipped; create=yes means capable, not created; command id=runner/command/cwd tuple, not execution; cwd: leading = marks recorded text; none means unrecorded; observations are not present truth, readiness, verification or authorization; omissions=count dropped candidates, not text cuts; 9007199254740991 means at least that many; request after=N counts preceding retained records; text uses literal backslash escapes",
      'focus: full "focus \\| \\\\ \\r\\n😀"',
      'latest-request: prior cut after=1 "say \\"yes\\" \\|"',
      "records:", "user | current | full | a\\|b", "files:",
      "read AAAAAAAAAAAAAAAAAAAAAA | prior | cut | no | /a\\|b",
      "modified AAAAAAAAAAAAAAAAAAAAAA | current | full | yes | /new", "commands:",
      "cmd BBBBBBBBBBBBBBBBBBBBBB | current | full | bash | success | = | echo \\| | \\n",
      "cmd BBBBBBBBBBBBBBBBBBBBBB | prior | cut | shell | error | none | false | failed",
      "omitted: input=1 excerpts=2 reads=3 modified=4 commands=5", "</dc-distill-summary>",
    ].join("\n");
    expect(encodeSummary(value)).toBe(fixture);
    expect(decodeSummary(fixture)).toEqual(value);
    expect(summaryCost(value)).toBe(codePointLength(fixture));
  });
});

describe("canonical scalar escaping and request anchors", () => {
  const decoded = '\\ " | \n\r\t <>\u0000\u001b\u007f\u0085\u202e\u200d\u2028\u2029 😀 \\u{202e}';
  const escaped = '\\\\ \\" \\| \\n\\r\\t \\u{3c}\\u{3e}\\u{0}\\u{1b}\\u{7f}\\u{85}\\u{202e}\\u{200d}\\u{2028}\\u{2029} 😀 \\\\u{202e}';
  test("every text field shares exact escaping and preserves literal-looking escapes", () => {
    const value = document();
    value.focus = { text: decoded, shortened: true };
    value.latestRequest = { text: decoded, shortened: false, origin: "current", afterRecords: 1 };
    value.records = [{ text: decoded, shortened: false, origin: "prior", kind: "user" }];
    value.files.read = [{ identityDigest: "A".repeat(22), path: decoded, shortened: false, createCapable: false, origin: "prior" }];
    value.commands = [{ identityDigest: "B".repeat(22), runner: decoded, command: decoded, cwd: decoded, result: decoded, shortened: true, origin: "current", status: "unknown" }];
    const wire = encodeSummary(value);
    expect(wire.split(escaped)).toHaveLength(9);
    expect(wire).toContain(`focus: cut "${escaped}"`);
    expect(wire).toContain(`latest-request: current full after=1 "${escaped}"`);
    expect(decodeSummary(wire)).toEqual(value);
    expect(summaryCost(value)).toBe(codePointLength(wire));
  });
  test("rejects raw controls, alternate escapes and invalid scalar syntax", () => {
    const value = document(); value.records = [{ kind: "user", text: "marker", origin: "current", shortened: false }];
    const canonical = encodeSummary(value);
    for (const spelling of ['"', "|", "<", ">", "\t", "\u0000", "\u001b", "\u202e", "\u200d", "\u2028", "\u2029",
      "\\u{41}", "\\u{03c}", "\\u{3C}", "\\u{a}", "\\u{d800}", "\\u{110000}", "\\u{}", "\\u{gg}", "\\u{3c", "\\"]) {
      expect(errorCode(() => decodeSummary(canonical.replace("marker", spelling)))).toBe("invalid_input");
    }
  });
  test("anchor is a canonical safe integer within retained record bounds", () => {
    const value = document(); value.latestRequest = { text: "request", origin: "current", shortened: false, afterRecords: 0 };
    const canonical = encodeSummary(value);
    for (const anchor of [-1, 1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      value.latestRequest.afterRecords = anchor;
      expect(errorCode(() => summaryCost(value))).toBe("invalid_input");
    }
    for (const spelling of ["00", "+0", "-0", "1", "9007199254740992"]) {
      expect(errorCode(() => decodeSummary(canonical.replace("after=0", `after=${spelling}`)))).toBe("invalid_input");
    }
  });
});
