import { pathIdentity } from "./tool-tracker.ts";
import type { ObservationSnapshot } from "./types.ts";
import type { DistillHandoffPrecondition } from "../handoff.ts";

export type PredicateState = "satisfied" | "contradicted" | "unknown";
/** Exact supplied observations only; display, stored task status and graph stay untouched. */
export function evaluatePreconditions(predicates: readonly DistillHandoffPrecondition[], snapshot?: ObservationSnapshot): ReadonlyMap<string, PredicateState> {
  const states = new Map<string, PredicateState>();
  for (const predicate of predicates) {
    let state: PredicateState = "unknown";
    if (snapshot && predicate.kind === "file-read-succeeded") {
      const identity = pathIdentity(predicate.path, predicate.cwd);
      const read = snapshot.fileReads.findLast((item) => item.path === identity && item.cwd === predicate.cwd);
      if (!snapshot.pendingMutations?.length && read?.freshnessEstablished && read.mutationEpoch === snapshot.mutationEpoch) {
        state = read.status === "succeeded" ? "satisfied" : read.status === "failed" ? "contradicted" : "unknown";
      }
    } else if (snapshot && predicate.kind === "verification-pass") {
      const receipt = snapshot.verification.findLast((item) => item.tool === predicate.runner && item.command === predicate.command && item.cwd === predicate.cwd);
      if (!snapshot.pendingMutations?.length && receipt?.freshnessEstablished && receipt.mutationEpoch === snapshot.mutationEpoch) {
        state = receipt.status === "PASS" ? "satisfied" : receipt.status === "FAIL" ? "contradicted" : "unknown";
      }
    }
    states.set(predicate.id, state);
  }
  return states;
}
