export enum Tier {
  /** Pre-compaction steer: usage is in the warn band — nudge the agent to
   *  finish its atomic unit and save state, but do NOT compact yet. */
  Warn = 0,
  Mechanical = 1,
}

export interface CompactState {
  tokenEstimate: number;
  toolTokens: number;
  lastUserMessageTime: number;
  lastCompactionTime: number;
  repeatBaselineTokens: number | null;
  awaitingPostCompactionSample: boolean;
  callCount: number;
  exchangeCount: number;
  compactionCount: number;
  /** API-reported totalTokens from the last assistant response. 0 until first response. */
  apiTokenCount: number;
}

export interface CompactDecision {
  tier: Tier;
  reason: string;
}

export interface CompactEvent {
  ts: string;
  sessionId?: string;
  tier: 1;
  before: number;
  after: number;
  rebuiltMessageAfter?: number;
  fullContextAfter?: number;
  tokenObservation?: "observed" | "unavailable";
  observedTokenDelta?: number;
  fullContextAfterSource?: "pi-post-rebuild-context-usage";
  tokenSource?: "pi-rebuilt-message-estimate";
  removed: number;
  toolTokens: number;
  idleS: number;
  exchanges: number;
  sessionCalls: number;
  apiTokensBefore?: number;
  /** First 200 chars of the summary for quick scanning. */
  summaryHead?: string;
  /** Total summary length in chars. */
  summaryLen?: number;
  /** Which strategy produced this compaction (e.g. "algorithmic", "fallback"). */
  strategy?: string;
  /** Session JSONL filename for cross-referencing. */
  sessionFile?: string;
}
