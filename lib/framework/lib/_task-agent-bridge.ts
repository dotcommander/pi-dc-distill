/**
 * Task-Agent event bridge — typed inter-extension events between dc-tasks and dc-taskagents.
 *
 * Uses pi's built-in event bus (pi.events.emit/on) so that dc-tasks and
 * dc-taskagents can coordinate without direct imports. All helpers are pure: no
 * module-level mutable state, no side effects beyond the pi.events calls.
 *
 * NOTE: pi.events has no `off` — subscriptions last for the process lifetime.
 * The unsubscribe return value gates the handler with an `active` flag instead.
 */

import type { ExtensionAPI } from "../pi/coding-agent";

// ---------------------------------------------------------------------------
// Event name constants
// ---------------------------------------------------------------------------

/** Emitted by dc-tasks when a task is delegated to a taskagent. */
export const TASK_DELEGATED = "dc-tasks:delegated";

/** Emitted by dc-taskagents when an agent is spawned. */
export const AGENT_CREATED = "dc-taskagents:created";

/** Emitted by dc-taskagents when an agent finishes (success, error, or abort). */
export const AGENT_COMPLETED = "dc-taskagents:completed";

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface GoalOwnerPayloadV1 {
  schemaVersion: 1;
  goalId: string;
  revision: number;
  taskId: string;
  attempt: number;
  agentId: string;
  subleaseToken: string;
  writeSetHash: string;
}

export interface StructuredUsagePayloadV1 {
  schemaVersion: 1;
  activeMs: number;
  turns: number;
  tokens: {
    input: number | null;
    output: number | null;
    reasoning: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
  };
  costUsd: number | null;
  providerModels: Array<{
    provider: string;
    model: string;
    turns: number;
    tokens: {
      input: number | null;
      output: number | null;
      reasoning: number | null;
      cacheRead: number | null;
      cacheWrite: number | null;
    };
    costUsd: number | null;
  }>;
  unknown: { tokens: boolean; cost: boolean };
}

export interface TaskDelegatedPayload {
  taskId: string;
  agentType: string; // e.g. "explore", "work", "reviewer"
  agentId: string; // set after agent is spawned (may be empty string if queued)
  description: string;
  /** Exact v2 goal/task owner. Omitted for legacy and non-goal tasks. */
  goalOwner?: GoalOwnerPayloadV1;
}

export interface AgentCreatedPayload {
  agentId: string;
  taskId?: string; // linked task ID (only set when task delegated)
  agentType: string;
  description: string;
  /** Exact v2 goal/task owner. Omitted for legacy and non-goal tasks. */
  goalOwner?: GoalOwnerPayloadV1;
}

export type AgentExitClassification =
  | "completed"
  | "model_access_error"
  | "retryable_provider_error"
  | "turn_limit"
  | "timeout"
  | "no_mutation"
  | "stopped"
  | "aborted"
  | "fork_context_error"
  | "unknown";

export interface AgentExitDiagnosticPayload {
  classification: AgentExitClassification;
  message: string;
  retryable: boolean;
  status: string;
  toolUses: number;
  durationMs: number;
  modelsAttempted?: string[];
}

export interface AgentCompletedPayload {
  agentId: string;
  taskId?: string; // linked task ID (only set when task was delegated from a task)
  agentType: string;
  status: "completed" | "error" | "aborted" | "stopped";
  toolUses: number;
  durationMs: number;
  resultPreview?: string;
  error?: string;
  diagnostic?: AgentExitDiagnosticPayload;
  /** Whether the agent actually mutated the workspace (from record.didMutate). */
  didMutate?: boolean;
  /** Exact owner binding used to reject stale attempt/sublease results. */
  goalOwner?: GoalOwnerPayloadV1;
  /** Provider-derived child usage; unknown categories remain null and flagged. */
  structuredUsage?: StructuredUsagePayloadV1;
}

// ---------------------------------------------------------------------------
// Emit helpers
// ---------------------------------------------------------------------------

export function emitTaskDelegated(
  pi: ExtensionAPI,
  payload: TaskDelegatedPayload,
): void {
  pi.events.emit(TASK_DELEGATED, payload);
}

export function emitAgentCreated(
  pi: ExtensionAPI,
  payload: AgentCreatedPayload,
): void {
  pi.events.emit(AGENT_CREATED, payload);
}

export function emitAgentCompleted(
  pi: ExtensionAPI,
  payload: AgentCompletedPayload,
): void {
  pi.events.emit(AGENT_COMPLETED, payload);
}

// ---------------------------------------------------------------------------
// Subscribe helpers (return unsubscribe function)
// ---------------------------------------------------------------------------

export function onTaskDelegated(
  pi: ExtensionAPI,
  handler: (payload: TaskDelegatedPayload) => void,
): () => void {
  let active = true;
  pi.events.on(TASK_DELEGATED, (payload: unknown) => {
    if (active) handler(payload as TaskDelegatedPayload);
  });
  return () => {
    active = false;
  };
}

export function onAgentCreated(
  pi: ExtensionAPI,
  handler: (payload: AgentCreatedPayload) => void,
): () => void {
  let active = true;
  pi.events.on(AGENT_CREATED, (payload: unknown) => {
    if (active) handler(payload as AgentCreatedPayload);
  });
  return () => {
    active = false;
  };
}

export function onAgentCompleted(
  pi: ExtensionAPI,
  handler: (payload: AgentCompletedPayload) => void,
): () => void {
  let active = true;
  pi.events.on(AGENT_COMPLETED, (payload: unknown) => {
    if (active) handler(payload as AgentCompletedPayload);
  });
  return () => {
    active = false;
  };
}
