import { expect, test } from "bun:test";
import { compressToolResults, filterNoise, normalizeSessionJsonl } from "./normalizer.ts";
import { KIND_USER, KIND_TOOL_RESULT } from "./types.ts";
import { digest } from "./helpers.ts";
import type { CheckpointSourceReference } from "./checkpoint.ts";

const instruction = "Continue from where you left off. Do not deploy; first inspect src/parser.ts.";

function normalizedUser(text: string) {
  return filterNoise(normalizeSessionJsonl(JSON.stringify({ type: "message", message: { role: "user", content: text } })).blocks);
}

test("mixed continuation filler preserves human instructions and quoted examples", () => {
  for (const text of [instruction, `No response requested. First inspect src/parser.ts.`, `Quote: "Continue from where you left off."`, "The output says skill matches; inspect it."]) {
    expect(normalizedUser(text)).toEqual([{ kind: KIND_USER, text, origin: "human", sourceKind: "user", sourceReference: undefined }]);
  }
  expect(normalizedUser("Continue from where you left off.")).toEqual([]);
  expect(normalizedUser("No response requested.")).toEqual([]);
});

test("recognized XML wrappers keep enclosed instructions", () => {
  for (const tag of ["system-reminder", "ide_opened_file", "command-message", "context-window-usage"]) {
    expect(normalizedUser(`<${tag} source="human">${instruction}</${tag}>`)).toEqual([{ kind: KIND_USER, text: instruction, origin: "human", sourceKind: "user", sourceReference: undefined }]);
    expect(normalizedUser(`<${tag}>Continue from where you left off.</${tag}>`)).toEqual([]);
  }
});

test("untyped primer-like prefixes and mixed historical summary lines remain conservative", () => {
  for (const prefix of ["<skill>", "Context was compacted", "## Active Tasks", '<bard type="BARD">']) {
    const text = `${prefix}\n${instruction}`;
    expect(normalizedUser(text)[0].text).toBe(text);
  }
  const lines = ["[User] Working directory: inspect src/parser.ts first.", "[User] ## Memory Do not deploy.", "[User] skill matches are examples; inspect the parser."];
  const { blocks, meta } = normalizeSessionJsonl(JSON.stringify({ type: "compaction", summary: [...lines, "[User] No response requested."].join("\n") }));
  expect(blocks[0].text).toBe(lines.join("\n"));
  expect(meta.priorSummaries).toEqual([lines.join("\n")]);
});

test("explicitly typed transient messages remain excluded", () => {
  for (const customType of ["dc-hooks-session", "session-primer", "bard-context", "dc-distill-continuation"]) {
    expect(normalizeSessionJsonl(JSON.stringify({ type: "custom_message", customType, content: instruction })).blocks).toEqual([]);
  }
});

test("multi-block user text retains each original source occurrence", () => {
  const text = "Keep the exact source pin.";
  const sourceReferences: CheckpointSourceReference[] = [0, 1].map(blockIndex => ({ entryId: "user-entry", blockIndex, contentDigest: digest(text), sourceKind: "user" }));
  const { blocks } = normalizeSessionJsonl(JSON.stringify({
    type: "message", sourceReferences,
    message: { role: "user", content: [{ type: "text", text }, { type: "text", text }] },
  }));
  expect(blocks.map(block => block.text)).toEqual([text, text]);
  expect(blocks.map(block => block.sourceReference)).toEqual(sourceReferences);
});

test("user provenance follows retained text and images past empty and unsupported blocks", () => {
  const content = [{ type: "text", text: "  " }, { type: "other" }, { type: "text", text: "Inspect parser." }, { type: "image", mimeType: "image/png" }, { type: "text", text: "Do not deploy." }];
  const sourceReferences: CheckpointSourceReference[] = content.map((block, blockIndex) => ({ entryId: "mixed-user", blockIndex, contentDigest: digest(JSON.stringify(block)), sourceKind: "user" }));
  const { blocks } = normalizeSessionJsonl(JSON.stringify({ type: "message", sourceReferences, message: { role: "user", content } }));
  expect(blocks.map(block => block.text)).toEqual(["Inspect parser.", "[image: image/png]", "Do not deploy."]);
  expect(blocks.map(block => block.sourceReference?.blockIndex)).toEqual([2, 3, 4]);
});

test("missing or duplicate source occurrences remain unassigned", () => {
  const ref: CheckpointSourceReference = { entryId: "ambiguous-user", blockIndex: 0, contentDigest: digest("Inspect parser."), sourceKind: "user" };
  const { blocks } = normalizeSessionJsonl(JSON.stringify({ type: "message", sourceReferences: [ref, ref], message: { role: "user", content: [{ type: "text", text: "Inspect parser." }, { type: "text", text: "Do not deploy." }] } }));
  expect(blocks.map(block => block.sourceReference)).toEqual([undefined, undefined]);
});

test("error compression reserves two tail lines and four indexed diagnostics", () => {
  const lines = ["startup", ...Array.from({ length: 30 }, (_, i) => `progress ${i}: ${"x".repeat(40)}`),
    "Error: first", "Error: repeated", "Error: repeated", "Error: fourth", "Error: fifth",
    "  at src/parser.ts:19", "final cause: invalid syntax"];
  const [block] = compressToolResults([{ kind: KIND_TOOL_RESULT, text: lines.join("\n"), isError: true }]);
  expect(block.text).toBe(["Error: first", "Error: repeated", "Error: repeated", "Error: fourth", "at src/parser.ts:19", "final cause: invalid syntax", `...(${lines.length - 6} lines omitted)`].join("\n"));
  expect(block.verificationObservation?.status).toBe("FAIL");
});

test("tail diagnostics are deduplicated by source position with accurate omission counts", () => {
  const lines = ["Error: early", ...Array.from({ length: 20 }, () => "progress".repeat(10)), "Error: terminal", "Fatal: final cause"];
  const [block] = compressToolResults([{ kind: KIND_TOOL_RESULT, text: lines.join("\n"), isError: true }]);
  expect(block.text).toBe(`Error: early\nError: terminal\nFatal: final cause\n...(${lines.length - 3} lines omitted)`);
});
