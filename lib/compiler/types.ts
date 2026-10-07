/** One current summary contract. Observations never establish authorization or readiness. */
export type ObservationOrigin = "current" | "prior";
export type RecordKind = "user" | "assistant" | "tool-call" | "tool-result" | "bash" | "custom" | "branch-summary" | "native-summary";
export interface TextObservation { text: string; shortened: boolean; origin: ObservationOrigin }
export interface SummaryRecord extends TextObservation { kind: RecordKind }
export interface FileFact {
  identityDigest: string;
  path: string;
  shortened: boolean;
  createCapable: boolean;
  origin: ObservationOrigin;
}
export interface CommandFact {
  identityDigest: string;
  runner: string;
  command: string;
  cwd: string | null;
  status: "success" | "error" | "unknown";
  result: string;
  shortened: boolean;
  origin: ObservationOrigin;
}
export interface OmissionCounts {
  inputRecords: number;
  excerpts: number;
  readFiles: number;
  modifiedFiles: number;
  commands: number;
}
export interface DcDistillSummary {
  format: "dc-distill-summary";
  notice: "Selected conversation excerpts and observations; incomplete.";
  focus: string | null;
  latestRequest: TextObservation | null;
  records: SummaryRecord[];
  files: { read: FileFact[]; modified: FileFact[] };
  commands: CommandFact[];
  omitted: OmissionCounts;
}
/** Full observations before display shortening. Tool pairing is certified before bounding. */
export type ToolPairing =
  | { state: "identified"; id: string }
  | { state: "certified-idless"; key: number }
  | { state: "unpairable" };
interface RecordText { text: string; textShortened?: boolean }
export interface ToolCallRecord extends RecordText {
  kind: "tool-call";
  name: string;
  args: Record<string, unknown>;
  callId?: string;
  pairing: ToolPairing;
}
export interface ToolResultRecord extends RecordText {
  kind: "tool-result";
  name: string;
  callId?: string;
  pairing: ToolPairing;
  isError?: boolean;
}
export type NormalizedRecord =
  | (RecordText & { kind: "user"; nativeUserText?: boolean })
  | (RecordText & { kind: "assistant" | "custom" | "branch-summary" | "native-summary" })
  | ToolCallRecord | ToolResultRecord
  | (RecordText & { kind: "bash"; command: string; output: string; exitCode?: number; cancelled?: boolean; cwd?: string });
export interface CompactionSource {
  records: NormalizedRecord[];
  predecessor: DcDistillSummary | null;
  /** Includes ambiguity in validated records dropped by whole-record input bounding. */
  duplicateCallIds: readonly string[];
  omittedInputRecords: number;
  session: { cwd: string };
}
export interface ObservationFacts {
  files: { read: FileFact[]; modified: FileFact[] };
  commands: CommandFact[];
}
export interface CompileOptions { focus?: string | null; signal?: AbortSignal }
export interface LocalCompileResult { summary: string; document: DcDistillSummary }
export interface CompactionDetails {
  compactor: "dc-distill";
  summaryDigest: string;
  tokensAfter: number;
  tokensAfterSource: "pi-rebuilt-message-estimate";
  capacityStatus: "unknown" | "within-window";
  contextWindow?: number;
}
