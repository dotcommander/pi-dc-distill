import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStubCtx, simulate as rawSimulate } from "./tests/harness/fake-pi.ts";
import { withPreparationBranch } from "./tests/harness/preparation-fixture.ts";
const simulate = { ...rawSimulate, hook: (stub: Parameters<typeof rawSimulate.hook>[0], name: string, event: any) =>
  rawSimulate.hook(stub, name, name === "session_before_compact" ? withPreparationBranch(event, stub.sessionBranch) : event) };
import { createDistillExtension } from "./index.ts";
import { DistillStore } from "./lib/store.ts";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "distill-v12-")); const stub = createStubCtx();
  createDistillExtension({ storeFactory: () => new DistillStore({ dataDir: join(root, "data"), projectRoot: join(root, "project"), legacyDir: join(root, "absent") }), loadFeatureSettings: () => ({ recall: { enabled: false }, toolOutput: { enabled: false } }) })(stub.pi);
  const event = { reason: "manual", signal: new AbortController().signal, branchEntries: [] as any[], preparation: { messagesToSummarize: [{ role: "user", content: "Keep exact task parser correction." }], turnPrefixMessages: [], firstKeptEntryId: "tail", tokensBefore: 120000 } };
  return { root, stub, event };
}
test("v14 accepts unknown capacity and retains a cancelled reservation until lifecycle reset", async () => {
  const { stub, event } = fixture(); await simulate.hook(stub, "session_start", {});
  const [first] = await simulate.hook(stub, "session_before_compact", event); const compaction = (first as any).compaction;
  expect(compaction.details).toMatchObject({ version: 14, capacityStatus: "unknown" });
  await simulate.hook(stub, "session_compact_failed", { aborted: true, reason: "manual", attemptId: compaction.details.attemptId });
  stub.ctx.getContextUsage = () => ({ tokens: 120000, contextWindow: compaction.details.tokensAfter, percent: 100 });
  expect((await simulate.hook(stub, "session_before_compact", event))[0]).toEqual({ cancel: true });
  // The cancelled manual preparation retains ambiguous ownership until reset.
  await simulate.hook(stub, "session_start", {});
  stub.ctx.getContextUsage = () => ({ tokens: 120000, contextWindow: 200000, percent: 60 });
  expect((await simulate.hook(stub, "session_before_compact", event))[0]).toHaveProperty("compaction");
});
test("capacity uses current host over model and includes retained tail", async () => {
  const { stub, event } = fixture(); stub.ctx.model = { contextWindow: 200000 } as any;
  stub.ctx.getContextUsage = () => ({ tokens: 120000, contextWindow: 1000, percent: 100 });
  event.branchEntries = [{ type: "message", id: "discarded", parentId: null, timestamp: "2026-01-01T00:00:00Z", message: event.preparation.messagesToSummarize[0] }, { type: "message", id: "tail", parentId: "discarded", timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "Retained tail ".repeat(2000), timestamp: 0 } }];
  await simulate.hook(stub, "session_start", {});
  expect((await simulate.hook(stub, "session_before_compact", event))[0]).toEqual({ cancel: true });
});
for (const observed of [undefined, 777]) test(`commit drift records ${observed === undefined ? "unavailable" : "observed"} host count`, async () => {
  const { root, stub, event } = fixture(); await simulate.hook(stub, "session_start", {});
  const [result] = await simulate.hook(stub, "session_before_compact", event); const compaction = (result as any).compaction;
  stub.ctx.getContextUsage = () => observed === undefined ? undefined : { tokens: observed, contextWindow: 200000, percent: 1 };
  await simulate.hook(stub, "session_compact", { fromExtension: true, compactionEntry: { type: "compaction", id: "commit", parentId: null, timestamp: "2026-01-01T00:00:00Z", ...compaction } });
  const log = JSON.parse((await readFile(join(root, "data", "compact-log.jsonl"), "utf8")).trim());
  expect(log.tokenObservation).toBe(observed === undefined ? "unavailable" : "observed");
  expect(log.observedTokenDelta).toBe(observed === undefined ? undefined : observed - compaction.details.tokensAfter);
});
for (const invalid of [NaN, Infinity, 0, -1]) test(`invalid host capacity ${invalid} falls back to finite current model`, async () => {
  const { stub, event } = fixture(); stub.ctx.model = { contextWindow: 200000 } as any;
  stub.ctx.getContextUsage = () => ({ tokens: 120000, contextWindow: invalid, percent: 100 });
  await simulate.hook(stub, "session_start", {});
  const [result] = await simulate.hook(stub, "session_before_compact", event);
  expect((result as any).compaction.details).toMatchObject({ contextWindow: 200000, capacityStatus: "within-window" });
});
