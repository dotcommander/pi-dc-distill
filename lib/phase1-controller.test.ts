import { describe, expect, test } from "bun:test";
import { Phase1Controller } from "./phase1-controller.ts";
import { createStubCtx } from "../tests/harness/fake-pi.ts";
import { Tier } from "./types.ts";

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
    advance: () => { now += 300_000; }, setSettings: (value: any) => { settings = value; } };
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
  test("late UI handles are disposed after shutdown or same-identity replacement", () => {
    const { stub, controller } = fixture();
    const lease = controller.lease(stub.ctx)!;
    let disposed = 0;
    controller.shutdown(stub.ctx);
    controller.start(stub.ctx);
    controller.attachUI({ dispose: () => { disposed++; } }, lease, stub.ctx);
    expect(disposed).toBe(1);
    expect(controller.compactionCardDedupe).toBeNull();
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
  test("diagnostic formatting and error stringification cannot escape admission", () => {
    const { stub, controller, setSettings } = fixture();
    setSettings(new Proxy({}, { get() { throw { toString() { throw new Error("broken formatter"); } }; } }));
    controller.monitor.diagnostic = () => { throw new Error("sink unavailable"); };
    expect(() => controller.assess(stub.ctx)).not.toThrow();
  });
});

describe("Phase 1 decided diagnostics (policy v2)", () => {
  test("decided assessments log one policy=v2 line; blocked assessments log none", () => {
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
    expect(diagnostics[0]).toContain("policy=v2");
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
    expect(diagnostics[0]).toContain("policy=v2");
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
    expect(diagnostics[0]).toContain("policy=v2");
  });
});
