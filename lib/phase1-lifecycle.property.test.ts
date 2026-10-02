import { test, expect } from "bun:test";
import fc from "fast-check";
import { Phase1Controller, type AttemptTicket } from "./phase1-controller.ts";
import { createStubCtx } from "../tests/harness/fake-pi.ts";

test("100 bounded lifecycle sequences preserve ticket ownership and cancellation reservations", () => {
  const seed = 130013;
  const replayPath = process.env.FC_PATH;
  const command = fc.constantFrom("request", "prepare", "cancel", "finish", "stale-finish", "commit", "reset", "model", "branch", "settings");
  const result = fc.check(fc.property(fc.array(command, { minLength: 1, maxLength: 100 }), (commands) => {
    const stub = createStubCtx();
    let reserveTokens = 16_384;
    const runtime = new Phase1Controller(stub.pi, {
      loadCompactionSettings: () => ({ enabled: true, reserveTokens }),
    });
    runtime.start(stub.ctx);
    let active: AttemptTicket | null = null;
    let preparing = false, cancelled = false, committing = false, snapshotValid = true;
    const retired: AttemptTicket[] = [];
    for (const command of commands) {
      switch (command) {
        case "request": {
          const ticket = runtime.requestAttempt(stub.ctx);
          expect(ticket !== null).toBe(active === null);
          if (ticket) { active = ticket; snapshotValid = true; }
          break;
        }
        case "prepare": {
          const allowed = !preparing && !cancelled && !committing;
          const ticket = runtime.beginPreparation(stub.ctx);
          expect(ticket !== null).toBe(allowed);
          if (ticket) { if (!active) { active = ticket; snapshotValid = true; } preparing = true; }
          break;
        }
        case "cancel": if (active) { runtime.cancelPreparation(active); cancelled = true; } break;
        case "finish": if (active) {
          expect(runtime.finishAttempt(active)).toBe(true);
          retired.push(active); active = null; preparing = cancelled = committing = false;
        } break;
        case "stale-finish": for (const old of retired) expect(runtime.finishAttempt(old)).toBe(false); break;
        case "commit": if (active) {
          const expected = snapshotValid && !cancelled && !committing;
          expect(runtime.beginCommit(active, stub.ctx)).toBe(expected);
          if (expected) committing = true;
        } break;
        case "reset":
          if (active) retired.push(active);
          runtime.start(stub.ctx); active = null; preparing = cancelled = committing = false; snapshotValid = true;
          break;
        case "model":
          runtime.contextChanged(stub.ctx); snapshotValid = false; break;
        case "branch":
          runtime.contextChanged(stub.ctx); snapshotValid = false; break;
        case "settings":
          reserveTokens++; snapshotValid = false; break;
      }
      expect(runtime.activeAttempt).toBe(active);
      expect(runtime.inFlight).toBe(active !== null);
      expect(runtime.commitInFlight).toBe(committing);
    }
  }), { seed, numRuns: 100, ...(replayPath ? { path: replayPath } : {}) });
  if (result.failed) throw new Error(`Lifecycle sequence failed: seed=${result.seed} path=${result.counterexamplePath}; replay: FC_PATH=${result.counterexamplePath} bun test lib/phase1-lifecycle.property.test.ts\n${String(result.errorInstance)}`);
});
