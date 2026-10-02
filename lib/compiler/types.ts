export const KIND_USER = "user";

export const KIND_ASSISTANT = "assistant";

export const KIND_TOOL_CALL = "tool_call";

export const KIND_TOOL_RESULT = "tool_result";

export const KIND_THINKING = "thinking";

export const KIND_COMPACTION = "compaction";

type BlockKind =
  | typeof KIND_USER
  | typeof KIND_ASSISTANT
  | typeof KIND_TOOL_CALL
  | typeof KIND_TOOL_RESULT
  | typeof KIND_THINKING
  | typeof KIND_COMPACTION;

export interface NormalizedBlock {
  kind: BlockKind;
  text?: string;
  name?: string;
  callId?: string;
  args?: Record<string, unknown>;
  isError?: boolean;
  redacted?: boolean;
  origin?: "human" | "custom";
  customType?: string;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  origin?: "human" | "custom";
  customType?: string;
  requestGroup?: number;
  protectedRequest?: boolean;
}

export interface ToolCallFingerprint {
  name: string;
  key: string;
  count: number;
}

export interface ToolResultEntry {
  toolName: string;
  text: string;
  isError: boolean;
  artifactReceipt?: boolean;
  count?: number;
}

export interface SessionMeta {
  id?: string;
  cwd?: string;
  model?: string;
  timestamp?: string;
  /** Last agent-authored <handoff>…</handoff> block, captured at compaction
   *  time. Surfaced as the leading <current-intent> section. Undefined when
   *  the agent emitted no handoff — summary then degrades byte-identically. */
  handoff?: string;
  handoffSource?: "assistant" | "saved";
  goalStatus?: string;
  goalObjective?: string;
  priorSummaries: string[];
}

export interface ResumeIndex {
  activeFiles: string[];
  recentUserIntents: string[];
  continuationHints: string[];
  recallQueries: string[];
}

export interface ConversationResult {
  turns: ConversationTurn[];
  /** Successful tool-observed reads; not proof of current existence. */
  readFiles: string[];
  /** Successful tool-reported writes; not a Git working-tree receipt. */
  modifiedFiles: string[];
  omittedReadFiles: number;
  omittedModifiedFiles: number;
  recentToolCalls: ToolCallFingerprint[];
  recentToolResults: ToolResultEntry[];
  verification: string[];
  workingTree: string[];
  sourceAnchors: string[];
  literalAnchors: string[];
  activeTasks: string[];
  resumeRisks: string[];
  budgetOmissions: string[];
  resumeTasks: string[];
  resumeIndex: ResumeIndex;
  pathRoot?: string;
}

export interface LocalCompileResult {
  summary: string;
  readFiles: string[];
  modifiedFiles: string[];
  literalAnchors: string[];
  inputDigest: string;
  summaryDigest: string;
  digestScope: "compaction-input" | "bounded-compaction-input";
  usefulRecordCount: number;
}

export interface ToolAdjacent {
  tools: string[];
  files: string[];
  hadError: boolean;
}

export interface PendingToolCall {
  name: string;
  callId?: string;
  args?: Record<string, unknown>;
}

export interface VerificationReceipt {
  status: "PASS" | "FAIL" | "SKIP" | "INCOMPLETE";
  tool: string;
  command: string;
  cwd?: string;
  evidence: string;
  mutationEpoch: number;
}
