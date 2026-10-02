export interface CompactionRecallEntry {
  /** ISO timestamp of the compaction */
  ts: string;
  /** Token count before compaction */
  before: number;
  /** Token count after compaction */
  after: number;
  /** The full summary markdown */
  summary: string;
  /** Project owner for version-6 recall. Missing only on legacy entries. */
  project?: string;
  sessionId?: string;
  fullContextAfter?: number;
  fullContextAfterSource?: "pi-post-rebuild-context-usage";
  tokenSource?: string;
  owner?: "legacy-unscoped";
}

