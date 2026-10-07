import type { LexicalBudget } from "./lexical-budget.ts";
import type { ResumeCheckpointV1, CheckpointUpdate, CheckpointSourceReference } from "./checkpoint.ts";
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

export interface VerificationObservation {
  status: "PASS" | "FAIL" | "SKIP" | "INCOMPLETE";
  evidence: string;
}

export interface NormalizedBlock {
  sourceSequence?: number;
  nativeUserText?: boolean;
  requestText?: string;
  kind: BlockKind;
  sourceReference?: CheckpointSourceReference;
  sourceKind?: "user" | "bash" | "agent-declaration" | "tool-observation" | "legacy";
  text?: string;
  name?: string;
  callId?: string;
  args?: Record<string, unknown>;
  isError?: boolean;
  /** Internal bounded observation; never serialized into canonical input or details. */
  verificationObservation?: VerificationObservation;
  /** Relative imports extracted from all supplied output before preview shortening. */
  suppliedImports?: string[];
  hostTruncated?: boolean;
  redacted?: boolean;
  origin?: "human" | "custom";
  customType?: string;
}

export interface ConversationTurn {
  sourceSequence?: number;
  /** Ephemeral display projection; text remains the existing semantic preview. */
  displayText?: string;
  role: "user" | "assistant";
  text: string;
  origin?: "human" | "custom";
  customType?: string;
  requestGroup?: number;
  protectedRequest?: boolean;
}

export interface ToolCallFingerprint {
  sourceSequence?: number;
  name: string;
  key: string;
  count: number;
}

export interface ToolResultEntry {
  sourceSequence?: number;
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
  declarations?: string[];
  declarationSources?: Array<CheckpointSourceReference | undefined>;
  handoffSource?: "assistant" | "saved";
  goalStatus?: string;
  goalObjective?: string;
  checkpoint?: ResumeCheckpointV1;
  checkpointDigest?: string;
  predecessorEntryId?: string;
  checkpointUpdates?: CheckpointUpdate[];
  authenticatedPriorSummary?: string;
  priorSummaries: string[];
}

export interface ResumeIndex {
  checkpoint?: ResumeCheckpointV1;
  /** Unique ordinary source occurrences, never persisted in a checkpoint. */
  intentOccurrences?: Array<{ text: string; sourceSequence: number }>;
  /** Optional attributed intent previews kept when conversation display is evicted. */
  displayIntents?: string[];
  activeFiles: string[];
  recentUserIntents: string[];
  continuationHints: string[];
  recallQueries: string[];
}

export interface ConversationResult {
  requestCandidate?: import("./request-candidate.ts").RequestCandidate;
  lexical?: LexicalBudget;
  checkpoint?: ResumeCheckpointV1;
  observedFiles?: { read: string[]; modified: string[] };
  /** Internal per-path paired file-access observations feeding the type-signature catalog. */
  signatureObservations?: Array<import("./type-signatures.ts").SignatureObservation>;
  /** Bounded exported-declaration catalog from successful paired results; wire-summary only, never persisted. */
  typeSignatures?: import("./type-signatures.ts").TypeSignatureCatalog;
  /** Authoritative obligations captured before display reduction; never persisted. */
  resumePlan?: ResumePlan;
  /** Internal whole source excerpts; serialized only in the text summary. */
  retainedContext?: Array<{ role: "user" | "assistant"; kind: "outcome" | "proposal" | "context"; text: string }>;
  /** Internal pre-trim terminal state; never serialized into compaction details. */
  terminalComplete?: boolean;
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
  observationSnapshot?: ObservationSnapshot;
  changeImpact?: string[];
  pathRoot?: string;
}

export interface LocalCompileResult {
  checkpoint: ResumeCheckpointV1;
  checkpointDigest: string;
  summary: string;
  readFiles: string[];
  modifiedFiles: string[];
  literalAnchors: string[];
  typeSignatures?: import("./type-signatures.ts").TypeSignatureCatalog;
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
  startedEpoch?: number;
  startedAt?: number;
  overlappingMutation?: boolean;
  potentiallyModifying?: boolean;
  name: string;
  callId?: string;
  args?: Record<string, unknown>;
}

export interface VerificationReceipt {
  sourceSequence?: number;
  status: "PASS" | "FAIL" | "SKIP" | "INCOMPLETE";
  tool: string;
  command: string;
  cwd?: string;
  evidence: string;
  mutationEpoch: number;
  freshnessEstablished?: boolean;
}

export interface ResumePlan {
  readonly terminalComplete: boolean;
  readonly delegateObligation?: string;
  readonly verification?: Readonly<VerificationReceipt>;
  readonly inspectVerification: boolean;
  readonly inspectGit: boolean;
}

export interface FileReadObservation {
  readonly id: string;
  readonly runner: string;
  readonly path: string;
  readonly cwd?: string;
  readonly status: "succeeded" | "failed" | "incomplete";
  readonly mutationEpoch: number;
  readonly freshnessEstablished: boolean;
  readonly imports: readonly string[];
}
export interface ObservationSnapshot {
  readonly pendingMutations?: readonly Readonly<PendingToolCall>[];
  readonly mutationEpoch: number;
  readonly fileReads: readonly Readonly<FileReadObservation>[];
  readonly verification: readonly Readonly<VerificationReceipt & { id: string }>[];
  readonly modifiedPaths: readonly string[];
}
