import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Selected Pi profile must be isolated before loading the extension and its SDK.
process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "distill-admission-test-"));
const { Phase1Controller } = await import("./phase1-controller.ts");
const { createStubCtx } = await import("../tests/harness/fake-pi.ts");
const { Tier } = await import("./types.ts");

function fixture() {
  const stub = createStubCtx();
  let now = 1_000_000;
  let settings: any = { compaction: { enabled: true, reserveTokens: 16_384 } };
  stub.pi.getSettings = () => settings;
  stub.ctx.model = { provider: "fake", id: "one", contextWindow: 200_000 } as any;
  const controller = new Phase1Controller(stub.pi, { clock: () => now });
  const diagnostics: string[] = [];
  controller.monitor.diagnostic = (message) => diagnostics.push(message);
  controller.start(stub.ctx);
  const usage = (tokens: any) => {
    stub.ctx.getContextUsage = () => ({ tokens, contextWindow: 200_000, percent: 50 });
  };
  return { stub, controller, diagnostics, usage,
    advance: () => { now += 300_000; }, clock: (value: number) => { now = value; }, setSettings: (value: any) => { settings = value; } };
}

describe("Phase 1 current-sample policy", () => {
  for (const invalid of [null, undefined, 0, -1, NaN, Infinity, -Infinity]) {
    test(`historical sync cannot authorize an ordinary action after ${invalid}`, () => {
      const { stub, controller, usage, advance } = fixture();
      usage(130_000);
      expect(controller.assess(stub.ctx)).toBeNull(); // consume ordinary warmup
      expect(controller.monitor.hasPiSynced).toBe(true);
      advance();
      usage(invalid);
      expect(controller.assess(stub.ctx)?.blockedBy).toBe("missing-pi-sync");
      expect(controller.monitor.state.tokenEstimate).toBe(130_000);
    });
  }
  test("thrown and absent usage cannot reuse historical synchronization", () => {
    const { stub, controller, usage, advance } = fixture();
    usage(130_000);
    controller.assess(stub.ctx);
    advance();
    stub.ctx.getContextUsage = () => { throw new Error("unavailable"); };
    expect(controller.assess(stub.ctx)?.blockedBy).toBe("missing-pi-sync");
    stub.ctx.getContextUsage = () => undefined;
    expect(controller.assess(stub.ctx)?.blockedBy).toBe("missing-pi-sync");
  });
  test("first-settled emergency bypasses warmup, cooldown, sync and growth", () => {
    const { stub, controller } = fixture();
    controller.monitor.state.tokenEstimate = 200_000;
    controller.monitor.state.awaitingPostCompactionSample = true;
    controller.monitor.state.repeatBaselineTokens = 200_000;
    stub.ctx.getContextUsage = () => undefined;
    expect(controller.assess(stub.ctx)?.decision?.tier).toBe(Tier.Mechanical);
    expect(controller.warmupTurnsRemaining).toBe(1);
    const ticket = controller.requestAttempt(stub.ctx)!;
    expect(controller.assess(stub.ctx)).toBeNull();
    expect(controller.finishAttempt(ticket)).toBe(true);
  });
  test("disabled or invalid settings block emergency; nonfinite local estimates never act", () => {
    const { stub, controller, setSettings } = fixture();
    controller.monitor.state.tokenEstimate = 250_000;
    stub.ctx.getContextUsage = () => undefined;
    setSettings({ compaction: { enabled: false } });
    expect(controller.assess(stub.ctx)).toBeNull();
    setSettings({ compaction: { reserveTokens: -1 } });
    expect(controller.assess(stub.ctx)).toBeNull();
    setSettings({ compaction: { enabled: true } });
    for (const value of [Infinity, -Infinity, NaN]) {
      controller.monitor.state.tokenEstimate = value;
      expect(controller.assess(stub.ctx)?.decision ?? null).toBeNull();
    }
  });
});

describe("sample-only admission", () => {
  test("sampling refreshes usage, captures baseline once and preserves warmup and cooldown", () => {
    const f = fixture();
    f.controller.recordCommittedCompaction(1);
    const time = f.controller.monitor.state.lastCompactionTime;
    for (const invalid of [null, undefined, 0, -1, NaN, Infinity]) {
      f.usage(invalid);
      expect(f.controller.samplePostCompaction(f.stub.ctx)).toBe(false);
      expect(f.controller.monitor.state.awaitingPostCompactionSample).toBe(true);
    }
    f.stub.ctx.getContextUsage = () => { throw new Error("unknown"); };
    expect(f.controller.samplePostCompaction(f.stub.ctx)).toBe(false);
    f.usage(130_000);
    expect(f.controller.samplePostCompaction(f.stub.ctx)).toBe(true);
    expect(f.controller.monitor.state.repeatBaselineTokens).toBe(130_000);
    expect(f.controller.monitor.state.missedAuto).toBe(true);
    expect(f.controller.warmupTurnsRemaining).toBe(1);
    expect(f.controller.monitor.state.lastCompactionTime).toBe(time);
    f.usage(134_000);
    expect(f.controller.samplePostCompaction(f.stub.ctx)).toBe(true);
    expect(f.controller.monitor.state.repeatBaselineTokens).toBe(130_000);
    expect(f.controller.monitor.state.tokenEstimate).toBe(134_000);
    expect(f.controller.warmupTurnsRemaining).toBe(1);
    expect(f.controller.monitor.state.lastCompactionTime).toBe(time);
    f.controller.assess(f.stub.ctx); // warmup
    expect(f.controller.assess(f.stub.ctx)?.blockedBy).toBe("cooldown");
    f.advance();
    f.usage(133_999);
    expect(f.controller.assess(f.stub.ctx)?.blockedBy).toBe("repeat-growth");
    f.usage(134_000);
    expect(f.controller.assess(f.stub.ctx)?.decision?.tier).toBe(Tier.Mechanical);
  });
  test("below-auto sampling and guards do not consume unknown baselines", () => {
    const f = fixture();
    f.controller.recordCommittedCompaction(1);
    f.usage(100_000);
    f.setSettings({ compaction: { enabled: false } });
    expect(f.controller.samplePostCompaction(f.stub.ctx)).toBe(false);
    f.setSettings({ compaction: { reserveTokens: -1 } });
    expect(f.controller.samplePostCompaction(f.stub.ctx)).toBe(false);
    f.setSettings({ compaction: { enabled: true } });
    const ticket = f.controller.requestAttempt(f.stub.ctx)!;
    expect(f.controller.samplePostCompaction(f.stub.ctx)).toBe(false);
    f.controller.finishAttempt(ticket);
    expect(f.controller.samplePostCompaction(f.stub.ctx)).toBe(true);
    expect(f.controller.monitor.state.repeatBaselineTokens).toBeNull();
    expect(f.controller.monitor.state.missedAuto).toBe(false);
  });
});

describe("Phase 1 lifecycle and tickets", () => {
  test("invalid identities cannot claim ownership", () => {
    const { stub, controller } = fixture();
    controller.shutdown(stub.ctx);
    for (const value of [undefined, null, "", "   ", 123]) {
      stub.ctx.sessionManager.getSessionId = () => value as any;
      expect(controller.start(stub.ctx)).toBeNull();
      expect(controller.isOwner(stub.ctx)).toBe(false);
    }
    stub.ctx.sessionManager.getSessionId = () => { throw new Error("missing"); };
    expect(controller.start(stub.ctx)).toBeNull();
  });
  test("child isolation, sequential replacement and context revisions preserve leases", () => {
    const { stub, controller, advance } = fixture();
    const lease = controller.lease(stub.ctx)!;
    const initialTime = controller.monitor.state.lastCompactionTime;
    controller.warmupTurnsRemaining = 0;
    advance();
    controller.contextChanged(stub.ctx);
    controller.refreshSettings(stub.ctx);
    expect(controller.isCurrent(lease, stub.ctx)).toBe(true);
    expect(controller.warmupTurnsRemaining).toBe(0);
    expect(controller.monitor.state.lastCompactionTime).toBe(initialTime);
    stub.ctx.sessionManager.getSessionId = () => "child";
    expect(controller.start(stub.ctx)).toBeNull();
    expect(controller.beginPreparation(stub.ctx)).toBeNull();
    expect(controller.shutdown(stub.ctx)).toBe(false);
    stub.ctx.sessionManager.getSessionId = () => lease.sessionId;
    controller.shutdown(stub.ctx);
    stub.ctx.sessionManager.getSessionId = () => "replacement";
    expect(controller.start(stub.ctx)?.sessionId).toBe("replacement");
    expect(controller.isCurrent(lease, stub.ctx)).toBe(false);
  });
  test("stale cleanup cannot release a newer attempt; manual and autonomous attempts serialize", () => {
    const { stub, controller } = fixture();
    const old = controller.requestAttempt(stub.ctx)!;
    expect(controller.beginPreparation(stub.ctx)).toBe(old);
    expect(controller.beginPreparation(stub.ctx)).toBeNull();
    controller.start(stub.ctx);
    const current = controller.beginPreparation(stub.ctx)!;
    expect(current.autonomous).toBe(false);
    expect(controller.finishAttempt(old)).toBe(false);
    expect(controller.activeAttempt).toBe(current);
    expect(controller.requestAttempt(stub.ctx)).toBeNull();
    expect(controller.beginCommit(current, stub.ctx)).toBe(true);
    expect(controller.beginCommit(current, stub.ctx)).toBe(false);
    expect(controller.finishAttempt(current)).toBe(true);
  });
  test("typed commit rejection preserves foreign, committing, and cancelled ownership", () => {
    const { stub, controller } = fixture();
    const old = controller.beginPreparation(stub.ctx)!;
    controller.start(stub.ctx);
    const current = controller.beginPreparation(stub.ctx)!;
    expect(controller.beginCommitOutcome(old, stub.ctx)).toEqual({ accepted: false, reason: "unowned-attempt" });
    expect(controller.activeAttempt).toBe(current);
    controller.cancelPreparation(current);
    expect(controller.beginCommitOutcome(current, stub.ctx)).toEqual({ accepted: false, reason: "preparation-cancelled" });
    expect(controller.finishAttempt(current)).toBe(true);
    const next = controller.beginPreparation(stub.ctx)!;
    expect(controller.beginCommitOutcome(next, stub.ctx)).toEqual({ accepted: true });
    expect(controller.beginCommitOutcome(next, stub.ctx)).toEqual({ accepted: false, reason: "commit-in-flight" });
    expect(controller.activeAttempt).toBe(next);
    expect(controller.commitInFlight).toBe(true);
  });
  test("feature gates stay independent startup snapshots across context changes", () => {
    const { stub, controller, setSettings } = fixture();
    for (const recall of [false, true]) for (const toolOutput of [false, true]) {
      setSettings({ extensionConfig: { "dc-distill": { recall: { enabled: recall }, toolOutput: { enabled: toolOutput } } } });
      controller.start(stub.ctx);
      setSettings({ extensionConfig: { "dc-distill": { recall: { enabled: !recall }, toolOutput: { enabled: !toolOutput } } } });
      controller.contextChanged(stub.ctx);
      controller.refreshSettings(stub.ctx);
      expect(controller.featureSettings).toEqual({ recall: { enabled: recall }, toolOutput: { enabled: toolOutput } });
    }
  });
});

describe("Phase 1 diagnostic identity", () => {
  test("deduplicates counts/countdowns but logs changed model, settings, geometry and sample status", () => {
    const { stub, controller, diagnostics, usage, setSettings } = fixture();
    controller.warmupTurnsRemaining = 0;
    usage(130_000);
    controller.assess(stub.ctx);
    usage(140_000);
    controller.assess(stub.ctx);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("reserveTokens=16384");
    expect(diagnostics[0]).toContain("autoSource=policy-capped");
    stub.ctx.model = { provider: "fake", id: "two", contextWindow: 200_000 } as any;
    controller.assess(stub.ctx);
    expect(diagnostics).toHaveLength(2);
    setSettings({ compaction: { reserveTokens: 50_000 } });
    controller.assess(stub.ctx);
    expect(diagnostics).toHaveLength(3);
    stub.ctx.getContextUsage = () => ({ tokens: 130_000, contextWindow: 190_000, percent: 60 });
    controller.assess(stub.ctx);
    expect(diagnostics).toHaveLength(4);
    stub.ctx.getContextUsage = () => undefined;
    controller.assess(stub.ctx);
    controller.assess(stub.ctx);
    expect(diagnostics).toHaveLength(5);
    stub.ctx.getContextUsage = () => ({ tokens: NaN, contextWindow: 200_000, percent: 60 });
    controller.assess(stub.ctx);
    expect(diagnostics).toHaveLength(6);
    stub.ctx.getContextUsage = () => { throw new Error("unavailable"); };
    controller.assess(stub.ctx);
    expect(diagnostics).toHaveLength(7);
  });
  test("identical invalid-setting blocks deduplicate and changed effective error inputs log", () => {
    const { stub, controller, diagnostics, setSettings } = fixture();
    setSettings({ compaction: { reserveTokens: -1 } });
    controller.assess(stub.ctx);
    controller.assess(stub.ctx);
    expect(diagnostics).toHaveLength(1);
    setSettings({ compaction: { enabled: "bad" } });
    controller.assess(stub.ctx);
    expect(diagnostics).toHaveLength(2);
  });
});

describe("Checkpoint operation ownership", () => {
  test("cancelled preparation reserves admission through its identifiable terminal owner", () => {
    const { stub, controller } = fixture();
    const ticket = controller.requestAttempt(stub.ctx)!;
    expect(controller.beginPreparation(stub.ctx)).toBe(ticket);
    controller.cancelPreparation(ticket);
    expect(controller.beginPreparation(stub.ctx)).toBeNull();
    expect(controller.requestAttempt(stub.ctx)).toBeNull();
    expect(controller.finishAttempt(ticket)).toBe(true);
    expect(controller.requestAttempt(stub.ctx)).not.toBeNull();
  });
  test("branch, model and settings snapshots fence preparation and commit", () => {
    for (const change of ["branch", "model", "settings"] as const) {
      const { stub, controller, setSettings } = fixture();
      const ticket = controller.beginPreparation(stub.ctx)!;
      if (change === "branch") {
        stub.ctx.sessionManager.getBranch = () => [{ type: "message", id: "new-leaf" } as any];
        expect(controller.snapshotMatches(ticket, stub.ctx)).toBe(false);
        controller.contextChanged(stub.ctx);
      }
      if (change === "model") stub.ctx.model = { provider: "fake", id: "two", contextWindow: 200_000 } as any;
      if (change === "settings") setSettings({ compaction: { enabled: true, reserveTokens: 42 } });
      expect(controller.beginCommit(ticket, stub.ctx)).toBe(false);
      expect(controller.activeAttempt).toBe(ticket);
    }
  });
  test("omitted injected defaults remain equivalent through preparation and commit", () => {
    const { stub } = fixture();
    let settings: any = { enabled: true, reserveTokens: 16_384 };
    const controller = new Phase1Controller(stub.pi, { loadCompactionSettings: () => settings });
    controller.start(stub.ctx);
    const ticket = controller.beginPreparation(stub.ctx)!;
    expect(ticket.settings.keepRecentTokens).toBe(20_000);
    settings = { ...settings, keepRecentTokens: 20_000 };
    expect(controller.snapshotMatches(ticket, stub.ctx)).toBe(true);
    expect(controller.beginCommitOutcome(ticket, stub.ctx)).toEqual({ accepted: true });
  });

  for (const change of ["keepRecentTokens", "shadowed-reserve", "invalid-shadowed-reserve"] as const) {
    test(`effective ${change} preserves preparation and commit fencing`, () => {
      const { stub, controller, setSettings } = fixture();
      const ticket = controller.beginPreparation(stub.ctx)!;
      if (change === "keepRecentTokens") setSettings({ compaction: { keepRecentTokens: 25_000 } });
      else setSettings({ compaction: { reserveTokens: change === "shadowed-reserve" ? 42 : -1,
        modelOverrides: { "fake/one": { reserveTokens: 16_384 } } } });
      const unchanged = change === "shadowed-reserve";
      expect(controller.snapshotMatches(ticket, stub.ctx)).toBe(unchanged);
      expect(controller.beginCommitOutcome(ticket, stub.ctx)).toEqual(unchanged
        ? { accepted: true } : { accepted: false, reason: "settings-changed" });
      if (change === "invalid-shadowed-reserve") {
        expect(controller.refreshSettings(stub.ctx)).toBe(false);
        expect(controller.compactionSettings.enabled).toBe(false);
      }
    });
  }
  test("diagnostic formatting and error stringification cannot escape admission", () => {
    const { stub, controller, setSettings } = fixture();
    setSettings(new Proxy({}, { get() { throw { toString() { throw new Error("broken formatter"); } }; } }));
    controller.monitor.diagnostic = () => { throw new Error("sink unavailable"); };
    expect(() => controller.assess(stub.ctx)).not.toThrow();
  });
});

describe("Phase 1 decided diagnostics (policy v3)", () => {
  test("decided assessments log one policy=v3 line; blocked assessments log none", () => {
    const { stub, controller, diagnostics, usage, advance } = fixture();
    controller.warmupTurnsRemaining = 0;
    advance();
    usage(200_000);
    const evaluation = controller.assess(stub.ctx);
    expect(evaluation?.decision?.tier).toBe(Tier.Mechanical);
    expect(evaluation?.decision?.reason).toBe("emergency: approaching context limit");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("auto-check decided");
    expect(diagnostics[0]).toContain("tier=Mechanical");
    expect(diagnostics[0]).toContain("reason=emergency: approaching context limit");
    expect(diagnostics[0]).toContain("policy=v3");
    diagnostics.length = 0;
    usage(50_000);
    controller.assess(stub.ctx);
    expect(diagnostics).toHaveLength(0);
  });
  test("warn steer decisions log the decided line after warning cooldown", () => {
    const { stub, controller, diagnostics, usage, advance, setSettings } = fixture();
    controller.warmupTurnsRemaining = 0;
    advance();
    setSettings({ compaction: { enabled: true, reserveTokens: 50_000 } });
    usage(160_000);
    const evaluation = controller.assess(stub.ctx);
    expect(evaluation?.decision?.tier).toBe(Tier.Warn);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("auto-check decided");
    expect(diagnostics[0]).toContain("tier=Warn");
    expect(diagnostics[0]).toContain("finish current unit");
    expect(diagnostics[0]).toContain("policy=v3");
  });
  test("a headroom-floor decision logs the decided line during cooldown", () => {
    const { stub, controller, diagnostics, usage, setSettings } = fixture();
    controller.warmupTurnsRemaining = 0;
    setSettings({ compaction: { enabled: true, reserveTokens: 50_000 } });
    usage(185_000); // above floor 179,520; no advance() so cooldown is active
    const evaluation = controller.assess(stub.ctx);
    expect(evaluation?.decision?.reason).toBe("headroom-floor: answer headroom exhausted — compact now");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("auto-check decided");
    expect(diagnostics[0]).toContain("policy=v3");
  });
});

describe("Phase 1 diagnostic session attribution", () => {
  test("start tags the monitor with the full owner session id", () => {
    const { controller } = fixture();
    expect(controller.monitor.sessionTag).toBe("stub-session-id");
  });
});

describe("policy v3 restored admission", () => {
  const journal = (compactedAt?: number) => [{ id: "root", parentId: null, type: "message",
    timestamp: new Date(100_000).toISOString() }, ...(compactedAt === undefined ? [] : [{
    id: "prior", parentId: "root", type: "compaction", timestamp: new Date(compactedAt).toISOString(),
    details: { compactor: "foreign", version: 8, tokensAfter: 1 },
  }])];
  function restored(compactedAt?: number) {
    const f = fixture();
    f.stub.ctx.sessionManager.getBranch = () => journal(compactedAt) as any;
    f.controller.start(f.stub.ctx);
    return f;
  }
  for (const tokens of [179_519, 179_520, 200_000]) test(`first-settled boundary ${tokens}`, () => {
    const { stub, controller, usage, setSettings } = restored(999_999);
    setSettings({ compaction: { enabled: true, reserveTokens: 50_000 } });
    usage(tokens);
    const result = controller.assess(stub.ctx);
    if (tokens === 179_519) expect(result).toBeNull();
    else {
      expect(result?.decision?.tier).toBe(Tier.Mechanical);
      expect(controller.warmupTurnsRemaining).toBe(1);
    }
  });
  test("nonempty restored journal without compaction retains warmup but skips synthetic cooldown", () => {
    const { stub, controller, usage } = restored();
    usage(130_000);
    expect(controller.assess(stub.ctx)).toBeNull();
    expect(controller.assess(stub.ctx)?.decision?.tier).toBe(Tier.Mechanical);
  });
  test("startup journal is snapshotted once and unavailable current usage cannot authorize it", () => {
    const f = fixture();
    let reads = 0;
    f.stub.ctx.sessionManager.getBranch = () => { reads++; return journal() as any; };
    f.controller.start(f.stub.ctx);
    f.usage(130_000);
    f.controller.assess(f.stub.ctx);
    f.usage(null);
    expect(f.controller.assess(f.stub.ctx)?.blockedBy).toBe("missing-pi-sync");
    expect(reads).toBe(1);
  });
  test("prior compaction uses real timestamp and a new host baseline, never details.tokensAfter", () => {
    const { stub, controller, usage } = restored(500_000);
    expect(controller.monitor.state.lastCompactionTime).toBe(500_000);
    usage(130_000);
    expect(controller.assess(stub.ctx)).toBeNull();
    expect(controller.assess(stub.ctx)?.blockedBy).toBe("post-compaction-sample");
    expect(controller.monitor.state.repeatBaselineTokens).toBe(130_000);
    expect(controller.assess(stub.ctx)?.blockedBy).toBe("repeat-growth");
    usage(133_999);
    expect(controller.assess(stub.ctx)?.blockedBy).toBe("repeat-growth");
    usage(134_000);
    expect(controller.assess(stub.ctx)?.decision?.tier).toBe(Tier.Mechanical);
  });
  test("recent compaction preserves actual cooldown after fresh sampling", () => {
    const { stub, controller, usage, advance } = restored(990_000);
    usage(130_000); controller.assess(stub.ctx); controller.assess(stub.ctx);
    usage(134_000);
    expect(controller.assess(stub.ctx)?.blockedBy).toBe("cooldown");
    advance();
    expect(controller.assess(stub.ctx)?.decision?.tier).toBe(Tier.Mechanical);
  });
  for (const bad of [[], [{ id: "bad", type: "message", timestamp: "bad" }], journal(1_000_001)]) {
    test(`untrusted journal retains startup delay ${JSON.stringify(bad)}`, () => {
      const { stub, controller, usage } = fixture();
      stub.ctx.sessionManager.getBranch = () => bad as any;
      controller.start(stub.ctx);
      usage(130_000); controller.assess(stub.ctx);
      expect(controller.assess(stub.ctx)?.decision).toBeNull();
    });
  }
  test("inaccessible journal fails conservatively", () => {
    const { stub, controller, usage } = fixture();
    stub.ctx.sessionManager.getBranch = () => { throw new Error("journal unavailable"); };
    controller.start(stub.ctx);
    usage(130_000); controller.assess(stub.ctx);
    expect(controller.assess(stub.ctx)?.decision).toBeNull();
  });
  test("model and branch changes require a new host baseline without inventing a new cooldown", () => {
    const { stub, controller, usage } = restored(500_000);
    usage(130_000); controller.assess(stub.ctx); controller.assess(stub.ctx);
    stub.ctx.model = { provider: "fake", id: "two", contextWindow: 200_000 } as any;
    usage(134_000);
    expect(controller.assess(stub.ctx)?.blockedBy).toBe("post-compaction-sample");
    expect(controller.monitor.state.repeatBaselineTokens).toBe(134_000);
    controller.admissionContextChanged(stub.ctx, true);
    usage(138_000);
    expect(controller.assess(stub.ctx)?.blockedBy).toBe("post-compaction-sample");
    expect(controller.monitor.state.lastCompactionTime).toBe(500_000);
  });
  test("duplicate foreign commits preserve baseline and cooldown", () => {
    const { stub, controller, usage } = restored();
    stub.ctx.sessionManager.getBranch = () => journal(500_000) as any;
    controller.observeHostCompaction(stub.ctx, { id: "prior" });
    usage(130_000); controller.assess(stub.ctx); controller.assess(stub.ctx);
    controller.observeHostCompaction(stub.ctx, { id: "prior" });
    expect(controller.monitor.state.awaitingPostCompactionSample).toBe(false);
    expect(controller.monitor.state.repeatBaselineTokens).toBe(130_000);
    expect(controller.monitor.state.lastCompactionTime).toBe(500_000);
  });
});

describe("settlement identity and exact-leaf tickets", () => {
  test("one completed assistant is assessed once after all sibling results", () => {
    const f = fixture();
    const branch: any[] = [{ type: "message", id: "assistant", parentId: null, message: { role: "assistant", stopReason: "toolUse" } },
      { type: "message", id: "first-result", parentId: "assistant", message: { role: "toolResult" } },
      { type: "message", id: "last-result", parentId: "first-result", message: { role: "toolResult" } }];
    f.stub.ctx.sessionManager.getBranch = () => branch;
    f.usage(200_000);
    expect(f.controller.shouldAssessSettled(f.stub.ctx)).toBe(true);
    expect(f.controller.assess(f.stub.ctx)?.decision?.tier).toBe(Tier.Mechanical);
    expect(f.controller.shouldAssessSettled(f.stub.ctx)).toBe(false);
    const ticket = f.controller.requestAttempt(f.stub.ctx)!;
    expect(ticket.branchAnchor).toBe("last-result");
    branch.push({ type: "custom", id: "later", parentId: "last-result" });
    expect(f.controller.snapshotMatches(ticket, f.stub.ctx)).toBe(false);
  });
  for (const stopReason of ["error", "aborted"]) {
    test(stopReason + " assistant cannot authorize settlement admission", () => {
      const f = fixture();
      f.stub.ctx.sessionManager.getBranch = () => [{ type: "message", id: "failed", message: { role: "assistant", stopReason, content: [], errorMessage: "This operation was aborted" } }] as any;
      f.usage(250_000);
      expect(f.controller.shouldAssessSettled(f.stub.ctx)).toBe(false);
      expect(f.controller.shouldAssessSettled(f.stub.ctx)).toBe(false);
    });
  }
  test("a failed completion fences an otherwise normal assistant identity", () => {
    const f = fixture();
    f.stub.ctx.sessionManager.getBranch = () => [{ type: "message", id: "failed", message: { role: "assistant", stopReason: "toolUse" } }] as any;
    f.controller.ignoreTurn(f.stub.ctx, "failed");
    expect(f.controller.shouldAssessSettled(f.stub.ctx)).toBe(false);
  });
});

function pausedFixture() {
  const f = fixture();
  const branch: any[] = [{ type: "message", id: "anchor", parentId: null,
    timestamp: new Date(900_000).toISOString(), message: { role: "assistant", content: [] } }];
  f.stub.ctx.sessionManager.getBranch = () => branch;
  f.usage(180_000);
  const ticket = f.controller.requestAttempt(f.stub.ctx)!;
  f.controller.beginPreparation(f.stub.ctx);
  expect(f.controller.pauseCompilerFailure(ticket, f.stub.ctx, "compile", "protected_overflow")).toBe(true);
  f.controller.cancelPreparation(ticket);
  f.controller.finishAttempt(ticket);
  return { ...f, branch, ticket };
}

describe("local automatic compiler pause", () => {
  for (const code of ["invalid_input", "invalid_checkpoint", "protected_overflow", "required_analysis_overflow", "compiler_failure"] as const) {
    test(`${code} records one owned failure episode even when diagnostics throw`, () => {
      const f = fixture();
      const ticket = f.controller.requestAttempt(f.stub.ctx)!;
      f.controller.beginPreparation(f.stub.ctx);
      f.controller.monitor.diagnostic = () => { throw new Error("diagnostic unavailable"); };
      expect(f.controller.pauseCompilerFailure(ticket, f.stub.ctx, "source", code)).toBe(true);
      expect(f.controller.pauseCompilerFailure(ticket, f.stub.ctx, "validation", code)).toBe(false);
      expect(f.controller.failedCompilerAttempt(ticket)).toBe(true);
      f.controller.finishAttempt(ticket);
      f.usage(250_000);
      expect(f.controller.assess(f.stub.ctx)).toBeNull();
      expect(f.controller.hasCompilerPause()).toBe(true);
    });
  }
  test("manual, stale and replaced attempts cannot arm the circuit", () => {
    const f = fixture();
    const manual = f.controller.beginPreparation(f.stub.ctx)!;
    expect(f.controller.pauseCompilerFailure(manual, f.stub.ctx, "compile", "compiler_failure")).toBe(false);
    f.controller.finishAttempt(manual);
    const autonomous = f.controller.requestAttempt(f.stub.ctx)!;
    f.controller.contextChanged(f.stub.ctx);
    expect(f.controller.pauseCompilerFailure(autonomous, f.stub.ctx, "compile", "compiler_failure")).toBe(false);
    f.controller.start(f.stub.ctx);
    const current = f.controller.requestAttempt(f.stub.ctx)!;
    expect(f.controller.pauseCompilerFailure(autonomous, f.stub.ctx, "compile", "compiler_failure")).toBe(false);
    expect(f.controller.activeAttempt).toBe(current);
    expect(f.controller.hasCompilerPause()).toBe(false);
  });
  for (const band of [130_000, 180_000, 200_000, 250_000, 185_000]) {
    test(`pause gates mechanical ${band} at settlement and submission`, () => {
      const f = pausedFixture();
      f.advance();
      f.controller.warmupTurnsRemaining = 0;
      f.controller.monitor.state.missedAuto = true;
      f.usage(band);
      expect(f.controller.assess(f.stub.ctx)).toBeNull();
      expect(f.controller.requestAttempt(f.stub.ctx)).toBeNull();
      expect(f.controller.monitor.state.missedAuto).toBe(true);
      expect(f.diagnostics.at(-1)).toContain("reason=compiler-paused");
    });
  }
  test("warn steering and manual preparation remain available", () => {
    const f = pausedFixture();
    f.advance();
    f.controller.warmupTurnsRemaining = 0;
    // With the standard reserve the warn line lies above headroom; use a
    // pause episode captured under a geometry with a reachable warn band.
    f.setSettings({ compaction: { enabled: true, reserveTokens: 40_000 } });
    f.controller.refreshSettings(f.stub.ctx);
    const ticket = f.controller.requestAttempt(f.stub.ctx)!;
    f.controller.beginPreparation(f.stub.ctx);
    f.controller.pauseCompilerFailure(ticket, f.stub.ctx, "compile", "compiler_failure");
    f.controller.finishAttempt(ticket);
    f.advance();
    f.controller.monitor.state.missedAuto = false;
    f.usage(165_000);
    expect(f.controller.assess(f.stub.ctx)?.decision?.tier).toBe(Tier.Warn);
    const manual = f.controller.beginPreparation(f.stub.ctx)!;
    expect(manual.autonomous).toBe(false);
    f.controller.cancelPreparation(manual);
    f.controller.finishAttempt(manual);
    expect(f.controller.hasCompilerPause()).toBe(true);
  });
  for (const reset of ["start", "model", "window", "host-window", "settings", "disabled", "branch", "native-commit", "owned-commit"]) {
    test(`${reset} clears a pause only when its new state is established`, () => {
      const f = pausedFixture();
      if (reset === "start") f.controller.start(f.stub.ctx);
      if (reset === "model" || reset === "window") {
        f.stub.ctx.model = { ...f.stub.ctx.model!, ...(reset === "model" ? { id: "different" } : { contextWindow: 210_000 }) };
        f.controller.admissionContextChanged(f.stub.ctx);
      }
      if (reset === "host-window") {
        f.stub.ctx.getContextUsage = () => ({ tokens: 180_000, contextWindow: 210_000, percent: 80 });
        f.controller.assess(f.stub.ctx);
      }
      if (reset === "settings" || reset === "disabled") {
        f.setSettings({ compaction: { enabled: reset !== "disabled", reserveTokens: reset === "settings" ? 20_000 : 16_384 } });
        f.controller.refreshSettings(f.stub.ctx);
      }
      if (reset === "branch") {
        f.branch.splice(0, f.branch.length, { type: "message", id: "other", parentId: null, timestamp: new Date(900_000).toISOString(), message: { role: "user", content: "other branch" } });
        f.controller.admissionContextChanged(f.stub.ctx, true);
      }
      if (reset === "native-commit" || reset === "owned-commit") {
        f.branch.push({ type: "compaction", id: "recovery", parentId: "anchor", timestamp: new Date(950_000).toISOString(), summary: "Recovered", firstKeptEntryId: "anchor", tokensBefore: 180_000 });
        if (reset === "native-commit") f.controller.observeHostCompaction(f.stub.ctx, f.branch.at(-1)!);
        else f.controller.clearCompilerPauseAfterCommit(f.stub.ctx, "recovery");
      }
      expect(f.controller.hasCompilerPause()).toBe(false);
    });
  }
  for (const kind of ["global-change", "model-change", "shadowed-global", "identical", "invalid-global", "invalid-model"]) {
    test(`effective keepRecentTokens ${kind} controls pause reset`, () => {
      const f = pausedFixture();
      const initial = { compaction: { keepRecentTokens: 20_000,
        modelOverrides: { "fake/one": { keepRecentTokens: 20_000 } } } };
      f.setSettings(initial);
      f.controller.refreshSettings(f.stub.ctx);
      expect(f.controller.hasCompilerPause()).toBe(true);
      if (kind === "global-change") f.setSettings({ compaction: { keepRecentTokens: 25_000 } });
      if (kind === "model-change") f.setSettings({ compaction: { keepRecentTokens: 20_000, modelOverrides: { "fake/one": { keepRecentTokens: 25_000 } } } });
      if (kind === "shadowed-global") f.setSettings({ compaction: { keepRecentTokens: 25_000, modelOverrides: initial.compaction.modelOverrides } });
      if (kind === "invalid-global") f.setSettings({ compaction: { keepRecentTokens: -1, modelOverrides: initial.compaction.modelOverrides } });
      if (kind === "invalid-model") f.setSettings({ compaction: { modelOverrides: { "fake/one": { keepRecentTokens: -1 } } } });
      f.controller.refreshSettings(f.stub.ctx);
      expect(f.controller.hasCompilerPause()).toBe(!["global-change", "model-change"].includes(kind));
      if (kind.startsWith("invalid")) {
        f.setSettings(initial); f.controller.refreshSettings(f.stub.ctx);
        expect(f.controller.hasCompilerPause()).toBe(true);
      }
    });
  }
  for (const corrupt of ["summary", "details", "missing-payload"]) {
    test(`native newest same-id ${corrupt} cannot reset pause`, () => {
      const f = pausedFixture();
      const entry = { type: "compaction", id: "native-recovery", parentId: "anchor", timestamp: new Date(950_000).toISOString(),
        summary: "Native recovery", firstKeptEntryId: "anchor", tokensBefore: 180_000, details: { source: "native" } };
      f.branch.push(entry);
      const forged = corrupt === "summary" ? { ...entry, summary: "Forged" }
        : corrupt === "details" ? { ...entry, details: {} } : { id: entry.id };
      f.controller.observeHostCompaction(f.stub.ctx, forged);
      expect(f.controller.hasCompilerPause()).toBe(true);
      f.controller.observeHostCompaction(f.stub.ctx, entry);
      expect(f.controller.hasCompilerPause()).toBe(false);
    });
  }
  for (const unchanged of ["prompt", "descendant", "same-model", "same-settings", "invalid-settings", "missing-branch", "broken-branch", "mismatched-commit", "missing-commit-branch", "superseded-commit", "failed-manual"]) {
    test(`${unchanged} preserves the failed anchor pause`, () => {
      const f = pausedFixture();
      if (unchanged === "prompt") f.controller.contextChanged(f.stub.ctx);
      if (unchanged === "descendant") {
        f.branch.push({ type: "message", id: "new-user", parentId: "anchor", timestamp: new Date(950_000).toISOString(), message: { role: "user", content: "new prompt" } });
        f.controller.admissionContextChanged(f.stub.ctx, true);
      }
      if (unchanged === "same-model") f.controller.admissionContextChanged(f.stub.ctx);
      if (unchanged === "same-settings") f.controller.refreshSettings(f.stub.ctx);
      if (unchanged === "invalid-settings") {
        f.setSettings({ compaction: { reserveTokens: -1 } }); f.controller.refreshSettings(f.stub.ctx);
        f.setSettings({ compaction: { enabled: true, reserveTokens: 16_384 } }); f.controller.refreshSettings(f.stub.ctx);
      }
      if (unchanged === "missing-branch" || unchanged === "missing-commit-branch") {
        f.stub.ctx.sessionManager.getBranch = () => { throw new Error("unavailable"); };
        if (unchanged === "missing-branch") f.controller.admissionContextChanged(f.stub.ctx, true);
        else f.controller.observeHostCompaction(f.stub.ctx, { id: "recovery" });
      }
      if (unchanged === "broken-branch") {
        f.branch.splice(0, 1, { type: "custom", id: "other", parentId: "missing" });
        f.controller.admissionContextChanged(f.stub.ctx, true);
      }
      if (unchanged === "mismatched-commit") f.controller.observeHostCompaction(f.stub.ctx, { id: "foreign" });
      if (unchanged === "superseded-commit") {
        f.branch.push({ type: "compaction", id: "older", parentId: "anchor", timestamp: new Date(950_000).toISOString() },
          { type: "compaction", id: "newer", parentId: "older", timestamp: new Date(960_000).toISOString() });
        f.controller.observeHostCompaction(f.stub.ctx, { id: "older" });
      }
      if (unchanged === "failed-manual") {
        const manual = f.controller.beginPreparation(f.stub.ctx)!;
        f.controller.cancelPreparation(manual); f.controller.finishAttempt(manual);
      }
      expect(f.controller.hasCompilerPause()).toBe(true);
    });
  }
});
