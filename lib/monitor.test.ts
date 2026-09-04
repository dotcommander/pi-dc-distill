// Tests for dc-shrink/lib/monitor.ts — Monitor class and extractText
// Run: bun test extensions/dc-app/lib/knowledge/features/shrink/lib/monitor.test.ts

import { describe, test, expect, beforeEach } from "bun:test"
import { Monitor, extractText } from "./monitor.ts"
import type { CompactState } from "./types.ts"

// --- Test fixture helpers ---

const userMsg = (text: string) => ({ role: "user", content: text })
const assistantMsg = (text: string) => ({
  role: "assistant",
  content: [{ type: "text", text }],
})
const toolResult = (text: string, callId = "call_1") => ({
  role: "toolResult",
  toolCallId: callId,
  content: [{ type: "text", text }],
})
const thinkingMsg = (text: string) => ({
  role: "assistant",
  content: [{ type: "thinking", text }],
})
const imageMsg = () => ({
  role: "assistant",
  content: [{ type: "image", url: "http://example.com/img.png" }],
})
const multiContent = (text: string, callId: string) => ({
  role: "assistant",
  content: [
    { type: "text", text },
    { type: "toolCall", id: callId, name: "read", arguments: {} },
  ],
})
const bashExec = (callId: string) => ({
  role: "bashExecution",
  toolCallId: callId,
  command: "ls",
  output: "file1\nfile2",
})
const nullContent = { role: "user", content: null }
const undefinedContent = { role: "user" } // content is undefined
const numberContent = { role: "user", content: 42 }

// --- Tests ---

describe("extractText", () => {
  test("returns empty string for null content", () => {
    expect(extractText(nullContent)).toBe("")
  })

  test("returns empty string for undefined content", () => {
    expect(extractText(undefinedContent)).toBe("")
  })

  test("returns string content as-is", () => {
    expect(extractText(userMsg("hello world"))).toBe("hello world")
  })

  test("extracts text from single-element content array", () => {
    const msg = assistantMsg("hello")
    expect(extractText(msg)).toBe("hello")
  })

  test("extracts tool call names from content array", () => {
    const msg = multiContent("checking", "c1")
    // Should include text + toolCall name
    expect(extractText(msg)).toContain("checking")
    expect(extractText(msg)).toContain("read")
  })

  test("skips thinking blocks", () => {
    const msg = thinkingMsg("deep thoughts")
    expect(extractText(msg)).toBe("")
  })

  test("converts image blocks to [image]", () => {
    const msg = imageMsg()
    expect(extractText(msg)).toBe("[image]")
  })

  test("stringifies non-array, non-string content", () => {
    const result = extractText(numberContent)
    expect(result).toBe("42")
  })

  test("joins multiple content blocks with newline", () => {
    const msg = {
      role: "assistant",
      content: [
        { type: "text", text: "part1" },
        { type: "text", text: "part2" },
      ],
    }
    expect(extractText(msg)).toBe("part1\npart2")
  })

  test("handles empty content array", () => {
    const msg = { role: "assistant", content: [] }
    expect(extractText(msg)).toBe("")
  })

  test("handles content array with null items", () => {
    const msg = {
      role: "assistant",
      content: [null, { type: "text", text: "valid" }, undefined],
    }
    expect(extractText(msg)).toContain("valid")
  })
})

describe("Monitor", () => {
  let monitor: Monitor

  beforeEach(() => {
    monitor = new Monitor()
  })

  // ── Initial state ───────────────────────────────────────────────────────

  test("starts with zero tokenEstimate", () => {
    expect(monitor.state.tokenEstimate).toBe(0)
  })

  test("starts with zero toolTokens", () => {
    expect(monitor.state.toolTokens).toBe(0)
  })

  test("starts with zero callCount", () => {
    expect(monitor.state.callCount).toBe(0)
  })

  test("starts with zero exchangeCount", () => {
    expect(monitor.state.exchangeCount).toBe(0)
  })

  test("starts with zero compactionCount", () => {
    expect(monitor.state.compactionCount).toBe(0)
  })

  // ── record() — token estimation ─────────────────────────────────────────

  test("accumulates tokens from string content (4 chars = 1 token)", () => {
    monitor.record(userMsg("abcd")) // 4 chars = 1 token
    expect(monitor.state.tokenEstimate).toBe(1)
  })

  test("rounds up partial tokens (3 chars = 1 token)", () => {
    monitor.record(userMsg("abc")) // 3 chars → ceil(3/4) = 1
    expect(monitor.state.tokenEstimate).toBe(1)
  })

  test("accumulates across multiple messages", () => {
    monitor.record(userMsg("abcd")) // 1 token
    monitor.record(userMsg("abcdefgh")) // 2 tokens
    expect(monitor.state.tokenEstimate).toBe(3)
  })

  test("increments callCount per record", () => {
    monitor.record(userMsg("a"))
    monitor.record(userMsg("b"))
    monitor.record(userMsg("c"))
    expect(monitor.state.callCount).toBe(3)
  })

  // ── record() — tool token tracking ──────────────────────────────────────

  test("tracks toolTokens for toolResult messages", () => {
    monitor.record(toolResult("a".repeat(40))) // 10 tokens
    expect(monitor.state.toolTokens).toBe(10)
    expect(monitor.state.tokenEstimate).toBe(10) // also in total
  })

  test("does not add toolTokens for non-toolResult messages", () => {
    monitor.record(userMsg("a".repeat(40)))
    expect(monitor.state.toolTokens).toBe(0)
    expect(monitor.state.tokenEstimate).toBe(10)
  })

  test("accumulates toolTokens separately from total", () => {
    monitor.record(userMsg("a".repeat(40))) // 10 total, 0 tool
    monitor.record(toolResult("b".repeat(80))) // 20 total added, 20 tool
    expect(monitor.state.tokenEstimate).toBe(30)
    expect(monitor.state.toolTokens).toBe(20)
  })

  // ── record() — exchange tracking ────────────────────────────────────────

  test("increments exchangeCount for user messages", () => {
    monitor.record(userMsg("a"))
    monitor.record(userMsg("b"))
    expect(monitor.state.exchangeCount).toBe(2)
  })

  test("does not increment exchangeCount for non-user messages", () => {
    monitor.record(assistantMsg("reply"))
    monitor.record(toolResult("data"))
    expect(monitor.state.exchangeCount).toBe(0)
  })

  test("updates lastUserMessageTime on user messages", () => {
    const before = monitor.state.lastUserMessageTime
    // Small delay to ensure time difference
    monitor.record(userMsg("hello"))
    expect(monitor.state.lastUserMessageTime).toBeGreaterThanOrEqual(before)
  })

  // ── recordCompaction() ──────────────────────────────────────────────────

  test("resets tokenEstimate to new value", () => {
    monitor.record(userMsg("a".repeat(400))) // 100 tokens
    monitor.recordCompaction(20)
    expect(monitor.state.tokenEstimate).toBe(20)
  })

  test("increments compactionCount", () => {
    expect(monitor.state.compactionCount).toBe(0)
    monitor.recordCompaction(0)
    expect(monitor.state.compactionCount).toBe(1)
    monitor.recordCompaction(0)
    expect(monitor.state.compactionCount).toBe(2)
  })

  test("resets toolTokens to zero", () => {
    monitor.record(toolResult("a".repeat(100))) // 25 tool tokens
    expect(monitor.state.toolTokens).toBe(25)
    monitor.recordCompaction(10)
    expect(monitor.state.toolTokens).toBe(0)
  })

  test("resets callCount to zero", () => {
    monitor.record(userMsg("a"))
    monitor.record(userMsg("b"))
    expect(monitor.state.callCount).toBe(2)
    monitor.recordCompaction(0)
    expect(monitor.state.callCount).toBe(0)
  })

  test("resets exchangeCount to zero", () => {
    monitor.record(userMsg("a"))
    monitor.record(userMsg("b"))
    expect(monitor.state.exchangeCount).toBe(2)
    monitor.recordCompaction(0)
    expect(monitor.state.exchangeCount).toBe(0)
  })

  test("updates lastCompactionTime", () => {
    const before = monitor.state.lastCompactionTime
    monitor.recordCompaction(0)
    expect(monitor.state.lastCompactionTime).toBeGreaterThanOrEqual(before)
  })

  // ── reset() ─────────────────────────────────────────────────────────────

  test("reset() zeroes all counters", () => {
    monitor.record(userMsg("a".repeat(400)))
    monitor.record(toolResult("b".repeat(400)))
    monitor.recordCompaction(50)
    monitor.reset()

    expect(monitor.state.tokenEstimate).toBe(0)
    expect(monitor.state.toolTokens).toBe(0)
    expect(monitor.state.callCount).toBe(0)
    expect(monitor.state.exchangeCount).toBe(0)
    expect(monitor.state.compactionCount).toBe(0)
  })

  test("reset() allows re-recording from zero", () => {
    monitor.record(userMsg("a".repeat(40)))
    monitor.reset()
    monitor.record(userMsg("b".repeat(40)))
    expect(monitor.state.tokenEstimate).toBe(10) // only the post-reset msg
  })

  // ── Derived getters ─────────────────────────────────────────────────────

  test("idleMs returns time since last user message", () => {
    monitor.record(userMsg("hello"))
    const idle = monitor.idleMs
    expect(idle).toBeGreaterThanOrEqual(0)
    expect(idle).toBeLessThan(1000) // should be near-instant
  })

  // ── recordApiUsage() ────────────────────────────────────────────────────────

  test("recordApiUsage() stores totalTokens", () => {
    monitor.recordApiUsage({ totalTokens: 120431, input: 119000, output: 1431 })
    expect(monitor.state.apiTokenCount).toBe(120431)
  })

  test("recordApiUsage() computes sum when totalTokens missing", () => {
    monitor.recordApiUsage({ input: 100, output: 50, cacheRead: 30, cacheWrite: 20 })
    expect(monitor.state.apiTokenCount).toBe(200)
  })

  test("recordApiUsage() ignores undefined usage", () => {
    monitor.recordApiUsage(undefined)
    expect(monitor.state.apiTokenCount).toBe(0)
  })

  test("recordApiUsage() ignores zero total", () => {
    monitor.recordApiUsage({ totalTokens: 0 })
    expect(monitor.state.apiTokenCount).toBe(0)
  })

  test("recordApiUsage() is overwritten by latest response", () => {
    monitor.recordApiUsage({ totalTokens: 50000 })
    monitor.recordApiUsage({ totalTokens: 120431 })
    expect(monitor.state.apiTokenCount).toBe(120431)
  })

  test("recordCompaction() resets apiTokenCount", () => {
    monitor.recordApiUsage({ totalTokens: 120431 })
    expect(monitor.state.apiTokenCount).toBe(120431)
    monitor.recordCompaction(50)
    expect(monitor.state.apiTokenCount).toBe(0)
  })

  test("recordCompaction() marks next usage sample as post-compaction baseline", () => {
    monitor.state.repeatBaselineTokens = 120_000
    monitor.recordCompaction(50)
    expect(monitor.state.repeatBaselineTokens).toBeNull()
    expect(monitor.state.awaitingPostCompactionSample).toBe(true)
  })

  test("reset() zeroes apiTokenCount", () => {
    monitor.recordApiUsage({ totalTokens: 80000 })
    monitor.reset()
    expect(monitor.state.apiTokenCount).toBe(0)
  })

  test("reset() clears repeat baseline state", () => {
    monitor.state.repeatBaselineTokens = 120_000
    monitor.state.awaitingPostCompactionSample = true
    monitor.reset()
    expect(monitor.state.repeatBaselineTokens).toBeNull()
    expect(monitor.state.awaitingPostCompactionSample).toBe(false)
  })

  // ── Integration: simulate a conversation arc ────────────────────────────

  test("simulated conversation arc: grow → compact → grow again", () => {
    // Phase 1: Build up context
    for (let i = 0; i < 10; i++) {
      monitor.record(userMsg(`user message ${i} `.repeat(25))) // ~25 tokens each
      monitor.record(assistantMsg(`assistant reply ${i} `.repeat(25)))
      monitor.record(toolResult(`result data ${i} `.repeat(50)))
    }
    const beforeCompact = monitor.state.tokenEstimate
    expect(beforeCompact).toBeGreaterThan(0)
    expect(monitor.state.toolTokens).toBeGreaterThan(0)

    // Phase 2: Compact
    monitor.recordCompaction(50) // summary ~50 tokens
    expect(monitor.state.tokenEstimate).toBe(50)
    expect(monitor.state.toolTokens).toBe(0)
    expect(monitor.state.exchangeCount).toBe(0)
    expect(monitor.state.compactionCount).toBe(1)

    // Phase 3: Build up again
    for (let i = 0; i < 5; i++) {
      monitor.record(userMsg(`new message ${i} `.repeat(25)))
    }
    expect(monitor.state.tokenEstimate).toBeGreaterThan(50)
    expect(monitor.state.exchangeCount).toBe(5)
    expect(monitor.state.compactionCount).toBe(1) // unchanged
  })
})
