/**
 * TaskFsm — the task finite-state machine facade.
 *
 * The single authority on task state: one transition table + a lock+CAS engine
 * shared by the task tool, the taskagent bridge, and storage backends so they
 * cannot drift. Storage-agnostic — callers pass an FsmStore port.
 *
 * @module dc-framework/x/task-fsm
 */

import {
  transition,
  claim,
  heartbeat,
  reclaimIfStale,
  canTransition,
  transitionRequiresEvidence,
  TASK_STATES,
  TRANSITIONS,
} from "../lib/_task-fsm.ts";

export type {
  TaskState,
  EvidenceKind,
  EvidenceRef,
  FsmRecord,
  FsmStore,
  TransitionResult,
  TransitionInput,
  ClaimInput,
  HeartbeatInput,
  ReclaimInput,
} from "../lib/_task-fsm.ts";

export { TASK_STATES, TRANSITIONS };

export const TaskFsm = {
  transition,
  claim,
  heartbeat,
  reclaimIfStale,
  canTransition,
  requiresEvidence: transitionRequiresEvidence,
};
