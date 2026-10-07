import { describe, expect, test } from "bun:test";
import { compileSessionJsonl } from "./local-compact.ts";
import { readRequestCandidate } from "./compiler/request-candidate.ts";

// Prompt-cache stability, adapted from the invariants pinned by omp-vcc's
// summary-cache-stability test: the wire summary becomes part of every later
// provider request, so its bytes must be deterministic, free of generated
// per-compaction volatile data, and head-stable across successive compactions
// (stable sections render before per-request churn; see formatSummary).
const session = JSON.stringify({
  type: "session",
  id: "cache-stability",
  cwd: "/repo",
  timestamp: "2026-02-01T09:00:00Z",
});
const user = (text: string, id: string) =>
  JSON.stringify({ type: "message", id, message: { role: "user", content: [{ type: "text", text }] } });
const assistant = (text: string) =>
  JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text }] } });
const compile = (...entries: string[]) => compileSessionJsonl(entries.join("\n"), undefined, undefined, false);

const windowOne = [
  session,
  user("Fix the login timeout; report evidence only.", "u1"),
  assistant("Reading the auth module and reproducing the expiry."),
];

describe("summary cache stability", () => {
  test("identical canonical input compiles to a byte-identical wire summary", () => {
    const first = compile(...windowOne);
    const second = compile(...windowOne);
    expect(first.summary).not.toBe("");
    expect(second.summary).toBe(first.summary);
    expect(second.summaryDigest).toBe(first.summaryDigest);
  });

  test("wire summary carries timestamps only as pass-through from input", () => {
    const result = compile(...windowOne);
    const inputBytes = JSON.stringify(windowOne);
    const isoLike = /\b20\d\d-\d\d-\d\d[T ]\d\d:\d\d/g;
    const stamps = result.summary.match(isoLike) ?? [];
    expect(stamps.length).toBeGreaterThan(0);
    for (const stamp of stamps) expect(inputBytes).toContain(stamp);
    // Generated attempt ids / random uuids must not appear.
    const uuidLike = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
    for (const match of result.summary.match(uuidLike) ?? []) expect(inputBytes).toContain(match);
  });

  test("successive compaction preserves the stable head; candidate churn lands late", () => {
    const first = compile(...windowOne);
    const prior = JSON.stringify({
      type: "compaction",
      id: "prior",
      summary: first.summary,
      details: {
        compactor: "dc-distill",
        version: 13,
        checkpoint: first.checkpoint,
        checkpointDigest: first.checkpointDigest,
        summaryDigest: first.summaryDigest,
      },
    });
    const second = compile(
      session,
      prior,
      user("Also rotate refresh tokens hourly.", "u2"),
      assistant("Wiring rotation into the session layer."),
    );
    // The head — scope note plus the whole Session block — must carry verbatim
    // even though the latest user request (and therefore the request
    // candidate) changed between the two compactions.
    const sessionBlockEnd = second.summary.indexOf("\n\n", second.summary.indexOf("## Session"));
    expect(sessionBlockEnd).toBeGreaterThan(0);
    expect(second.summary.slice(0, sessionBlockEnd)).toBe(first.summary.slice(0, sessionBlockEnd));
    // Position pin: the candidate renders after the conversation brief ...
    expect(second.summary.indexOf("<request-candidate-v1>")).toBeGreaterThan(
      second.summary.indexOf("## Conversation"),
    );
    // ... still round-trips with the newest request.
    expect(readRequestCandidate(second.summary)?.source.entryId).toBe("u2");
  });
});

describe("type-signature cache stability", () => {
  const toolCall = (name: string, args: Record<string, unknown>, id?: string) =>
    JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }] } });
  const toolResult = (toolName: string, text: string, isError = false, toolCallId?: string) =>
    JSON.stringify({ type: "message", message: { role: "toolResult", toolCallId, toolName, isError, content: [{ type: "text", text }] } });

  const windowWithSignatures = [
    session,
    user("Audit the auth module surface.", "u1"),
    toolCall("view_file", { path: "src/auth.ts" }, "c1"),
    toolResult("view_file", "export function login(): void {}\nexport function logout(): void {}\n", false, "c1"),
    toolCall("write_to_file", { path: "src/session.ts", content: "export const rotation = 3600;\n" }, "c2"),
    toolResult("write_to_file", "wrote src/session.ts\nexport const rotation = 3600;\n", false, "c2"),
    toolCall("bash", { command: "bun test src/" }, "c3"),
    toolResult("bash", "7 pass, 0 fail", false, "c3"),
  ];

  test("a window with paired file content compiles byte-identically twice", () => {
    const first = compile(...windowWithSignatures);
    const second = compile(...windowWithSignatures);
    expect(first.typeSignatures?.entries.length).toBeGreaterThan(0);
    expect(second.summary).toBe(first.summary);
    expect(second.summaryDigest).toBe(first.summaryDigest);
  });

  test("signature churn preserves the stable head while the catalog lands after verification", () => {
    const windowOne = [
      session,
      user("Inspect auth before rotation lands.", "u1"),
      toolCall("view_file", { path: "src/auth.ts" }, "c1"),
      toolResult("view_file", "export function login(): void {}\nexport function logout(): void {}\n", false, "c1"),
    ];
    const first = compile(...windowOne);
    expect(first.summary).toContain("export function logout(): void {}");
    const prior = JSON.stringify({
      type: "compaction",
      id: "prior",
      summary: first.summary,
      details: {
        compactor: "dc-distill",
        version: 15,
        checkpoint: first.checkpoint,
        checkpointDigest: first.checkpointDigest,
        summaryDigest: first.summaryDigest,
      },
    });
    const second = compile(
      session,
      prior,
      user("Rotate tokens now.", "u2"),
      toolCall("view_file", { path: "src/auth.ts" }, "c4"),
      toolResult("view_file", "export function login(): void {}\nexport function rotate(): void {}\n", false, "c4"),
      toolCall("bash", { command: "bun test src/" }, "c5"),
      toolResult("bash", "9 pass, 0 fail", false, "c5"),
    );
    // Stable head: scope note plus the whole Session block carry verbatim.
    const sessionBlockEnd = second.summary.indexOf("\n\n", second.summary.indexOf("## Session"));
    expect(sessionBlockEnd).toBeGreaterThan(0);
    expect(second.summary.slice(0, sessionBlockEnd)).toBe(first.summary.slice(0, sessionBlockEnd));
    // Churned signatures land in the catalog, after the verification block.
    expect(second.summary).toContain("</verification>");
    expect(second.summary.indexOf("<type-signatures>")).toBeGreaterThan(second.summary.indexOf("</verification>"));
    // The live (unescaped) catalog block carries the fresh signatures; the
    // prior summary is verbatim history and may still mention the old ones.
    const liveCatalog = second.summary.match(/<type-signatures>\n([\s\S]*?)\n<\/type-signatures>/);
    expect(liveCatalog).not.toBeNull();
    expect(liveCatalog![1]).toContain("- src/auth.ts: export function rotate(): void {}");
    expect(liveCatalog![1]).not.toContain("logout");
  });
});
