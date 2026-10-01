import type { CompactState } from "./types.ts"
import { mkdirSync, renameSync, statSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { Path } from "./paths.ts";

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

  constructor() {
    this.state = this.freshState()
  }

  /** Whether pi's getContextUsage() has ever returned a valid token count this session. */
  get hasPiSynced(): boolean { return this._hasPiSynced }

  /** Create a zeroed CompactState with timestamps set to now. */
  private freshState(): CompactState {
    const now = Date.now()
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
      this.state.lastUserMessageTime = Date.now()
      this.state.exchangeCount++
    }
  }

  /** Record API-reported usage from an assistant response. */
  recordApiUsage(usage: { totalTokens?: number; input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | undefined): void {
    if (!usage) return
    const total = totalApiTokens(usage)
    if (total > 0) {
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
    if (typeof tokens === "number" && tokens > 0) {
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
    this.state.lastCompactionTime = Date.now()
    this.state.exchangeCount = 0
    this.state.toolTokens = 0
    this.state.callCount = 0
    this.state.compactionCount++
    this.state.tokenEstimate = newTokenEstimate
    this.state.apiTokenCount = 0
    this.state.repeatBaselineTokens = null
    this.state.awaitingPostCompactionSample = true
  }

  /** Diagnostic: append to ~/.pi/data/dc-distill/diag.log for debugging event delivery. */
  diagnostic(msg: string): void {
    this._diagLog(msg)
  }

  private _dirEnsured = false

  private _diagLog(msg: string): void {
    try {
    const dir = Path.data("dc-distill").path
    if (!this._dirEnsured) {
      mkdirSync(dir, { recursive: true })
      this._dirEnsured = true
      // Rotate once per session so diag.log stays bounded.
      const diagPath = join(dir, "diag.log")
      try {
        if (statSync(diagPath).size > 5 * 1024 * 1024) renameSync(diagPath, `${diagPath}.old`)
      } catch {
        // missing file — nothing to rotate
      }
    }
    const line = `${new Date().toISOString()} ${msg}\n`
    appendFile(join(dir, "diag.log"), line).catch(() => {})
    } catch {
      // best effort
    }
  }

  reset(): void {
    this.state = this.freshState()
    this._recorded = false
    this._hasPiSynced = false
  }

  get idleMs(): number {
    return Date.now() - this.state.lastUserMessageTime
  }
}

function totalApiTokens(usage: { totalTokens?: number; input?: number; output?: number; cacheRead?: number; cacheWrite?: number }): number {
  return usage.totalTokens || ((usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0))
}
