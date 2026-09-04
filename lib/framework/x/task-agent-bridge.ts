/**
 * Task-Agent Bridge — public re-export of typed inter-extension event bridge at `../lib/_task-agent-bridge`.
 *
 * @module dc-framework/x/task-agent-bridge
 */

export {
  TASK_DELEGATED,
  AGENT_CREATED,
  AGENT_COMPLETED,
  emitTaskDelegated,
  emitAgentCreated,
  emitAgentCompleted,
  onTaskDelegated,
  onAgentCreated,
  onAgentCompleted,
} from "../lib/_task-agent-bridge.ts";
export type {
  TaskDelegatedPayload,
  AgentCreatedPayload,
  AgentExitClassification,
  AgentExitDiagnosticPayload,
  AgentCompletedPayload,
  GoalOwnerPayloadV1,
  StructuredUsagePayloadV1,
} from "../lib/_task-agent-bridge.ts";
