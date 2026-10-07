/** Independent acceptance oracle: no compiler, codec, or shared contract imports. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

function object(value: unknown): Record<string, any> {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, any>;
}
function keys(value: Record<string, any>, expected: string[]): void {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}
function text(value: unknown, maximum: number): void {
  assert.equal(typeof value, "string");
  assert(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value as string), "malformed Unicode");
  assert(Array.from(value as string).length <= maximum, "display exceeds bound");
}
function observation(value: unknown, extra: string[] = []): Record<string, any> {
  const row = object(value);
  keys(row, ["text", "shortened", "origin", ...extra]);
  text(row.text, 2048);
  assert.equal(typeof row.shortened, "boolean");
  assert(["current", "prior"].includes(row.origin));
  return row;
}
export function assertCurrentCompaction(summary: unknown, details: unknown): Record<string, any> {
  text(summary, 65536);
  const d = object(details);
  keys(d, ["compactor", "attemptId", "summaryDigest", "tokensAfter", "tokensAfterSource", "capacityStatus",
    ...(d.contextWindow === undefined ? [] : ["contextWindow"])]);
  assert.equal(d.compactor, "dc-distill");
  assert.equal(typeof d.attemptId, "string");
  assert(d.attemptId.length > 0);
  assert.equal(d.summaryDigest, createHash("sha256").update(summary as string).digest("hex"));
  assert(Number.isFinite(d.tokensAfter) && d.tokensAfter >= 0);
  assert.equal(d.tokensAfterSource, "pi-rebuilt-message-estimate");
  assert(["unknown", "within-window"].includes(d.capacityStatus));
  if (d.contextWindow !== undefined) assert(Number.isFinite(d.contextWindow) && d.contextWindow > 0);
  if (d.capacityStatus === "within-window") assert(d.contextWindow !== undefined && d.tokensAfter <= d.contextWindow);
  const s = object(JSON.parse(summary as string));
  keys(s, ["format", "notice", "focus", "latestRequest", "records", "files", "commands", "omitted"]);
  assert.equal(s.format, "dc-distill-summary");
  assert.equal(s.notice, "Selected conversation excerpts and observations; incomplete.");
  if (s.focus !== null) text(s.focus, 2048);
  if (s.latestRequest !== null) observation(s.latestRequest);
  assert(Array.isArray(s.records));
  for (const row of s.records) {
    const r = observation(row, ["kind"]);
    assert(["user", "assistant", "tool-call", "tool-result", "bash", "custom", "branch-summary", "native-summary"].includes(r.kind));
  }
  keys(object(s.files), ["read", "modified"]);
  for (const rows of [s.files.read, s.files.modified]) {
    assert(Array.isArray(rows) && rows.length <= 50);
    for (const value of rows) {
      const row = object(value);
      keys(row, ["identityDigest", "path", "shortened", "createCapable", "origin"]);
      assert(/^[0-9a-f]{64}$/.test(row.identityDigest));
      text(row.path, 512);
      assert.equal(typeof row.shortened, "boolean");
      assert.equal(typeof row.createCapable, "boolean");
      assert(["current", "prior"].includes(row.origin));
    }
  }
  assert(Array.isArray(s.commands) && s.commands.length <= 10);
  for (const value of s.commands) {
    const row = object(value);
    keys(row, ["identityDigest", "runner", "command", "cwd", "status", "result", "shortened", "origin"]);
    assert(/^[0-9a-f]{64}$/.test(row.identityDigest));
    text(row.runner, 128); text(row.command, 512); text(row.result, 300);
    if (row.cwd !== null) text(row.cwd, 512);
    assert(["success", "error", "unknown"].includes(row.status));
    assert.equal(typeof row.shortened, "boolean");
    assert(["current", "prior"].includes(row.origin));
  }
  keys(object(s.omitted), ["inputRecords", "excerpts", "readFiles", "modifiedFiles", "commands"]);
  for (const value of Object.values(s.omitted)) assert(Number.isSafeInteger(value) && (value as number) >= 0);
  return s;
}
