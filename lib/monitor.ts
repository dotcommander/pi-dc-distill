import type { CompactState } from "./types.ts"
import { Diag } from "./diag-support.ts";

interface MessageLike {
  role: string
  content?: unknown
}

export function extractText(msg: MessageLike): string {
  if (msg.content == null) return ""
  if (typeof msg.content === "string") return msg.content
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((item): item is Record<string, unknown> =>
        item != null && typeof item === "object")
      .map(contentBlockText)
      .join("\n")
  }
  return JSON.stringify(msg.content)
}

function contentBlockText(item: Record<string, unknown>): string {
  if (item.type === "text") return (item as { text?: string }).text ?? ""
  if (item.type === "toolCall") return (item as { name?: string }).name ?? ""
  if (item.type === "thinking") return "" // thinking blocks are not token-relevant
  if (item.type === "image") return "[image]" // images cost tokens but not text
  return ""
}

export class Monitor {
  state: CompactState
  private _recorded = false // diagnostic: has record() ever been called?
  private _hasPiSynced = false // has ctx.getContextUsage() ever returned a positive token count?

  constructor(private readonly clock: () => number = Date.now) {
    this.state = this.freshState()
  }

  /** Whether pi's getContextUsage() has ever returned a valid token count this session. */
  get hasPiSynced(): boolean { return this._hasPiSynced }

  /** Create a zeroed CompactState with timestamps set to now. */
  private freshState(): CompactState {
    const now = this.clock()
    return {
      tokenEstimate: 0,
      toolTokens: 0,
      lastUserMessageTime: now,
      lastCompactionTime: now,
      repeatBaselineTokens: null,
      awaitingPostCompactionSample: false,
      callCount: 0,
      exchangeCount: 0,
      compactionCount: 0,
      apiTokenCount: 0,
    }
  }

  record(msg: MessageLike): void {
    const text = extractText(msg)
    const tokens = Math.ceil(text.length / 4)

    if (!this._recorded) {
      this._recorded = true
      const diag = `first record(): role=${msg.role} tokens=${tokens} contentLen=${text.length}`
      this._diagLog(diag)
    }

    this.state.tokenEstimate += tokens
    this.state.callCount++

    if (msg.role === "toolResult") {
      this.state.toolTokens += tokens
    }

    if (msg.role === "user") {
      this.state.lastUserMessageTime = this.clock()
      this.state.exchangeCount++
    }
  }

  /** Record API-reported usage from an assistant response. */
  recordApiUsage(usage: { totalTokens?: number; input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | undefined): void {
    if (!usage) return
    const total = totalApiTokens(usage)
    if (Number.isFinite(total) && total > 0) {
      this.state.apiTokenCount = total
    }
  }

  /**
   * Sync monitor with pi's authoritative token count.
   *
   * Pi's ContextUsage.tokens can be null ("unknown" per SDK, e.g. right
   * after compaction). When null/0/undefined, we leave the estimate
   * unchanged — zeroing it caused the 100k auto-threshold to be
   * unreachable until the 160k emergency.
   *
   * @returns Whether this sync succeeded (pi returned a positive number).
   */
  syncFromPi(tokens: number | null | undefined): boolean {
    if (typeof tokens === "number" && Number.isFinite(tokens) && tokens > 0) {
      this.state.tokenEstimate = tokens
      this._hasPiSynced = true
      return true
    }
    if (tokens === null || tokens === 0) {
      this._diagLog(`syncFromPi: pi tokens=${tokens} — keeping estimate ${this.state.tokenEstimate}`)
    }
    return false
  }

  recordCompaction(newTokenEstimate: number): void {
    this.state.lastCompactionTime = this.clock()
    this.state.exchangeCount = 0
    this.state.toolTokens = 0
    this.state.callCount = 0
    this.state.compactionCount++
    this.state.tokenEstimate = newTokenEstimate
    this.state.apiTokenCount = 0
    this.state.repeatBaselineTokens = null
    this.state.awaitingPostCompactionSample = true
  }

  /** Diagnostic: append to the selected agent's data/dc-distill/diag.log. */
  diagnostic(msg: string): void {
    this._diagLog(msg)
  }

  private _diagLog(msg: string): void {
    void Diag.monitor(msg)
  }

  reset(): void {
    this.state = this.freshState()
    this._recorded = false
    this._hasPiSynced = false
  }

  get idleMs(): number {
    return this.clock() - this.state.lastUserMessageTime
  }
}

function totalApiTokens(usage: { totalTokens?: number; input?: number; output?: number; cacheRead?: number; cacheWrite?: number }): number {
  return usage.totalTokens || ((usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0))
}
