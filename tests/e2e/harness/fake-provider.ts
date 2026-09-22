/**
 * Test-only Pi extension: registers the scripted provider "fake" with model
 * "scripted".
 *
 * The model reports env-driven context usage each turn, so dc-shrink's
 * autonomous monitor crosses real thresholds through the real CLI with zero
 * API cost. Every provider request is traced. dc-shrink's compactor is
 * deterministic and local: the provider must see exactly one request per
 * agent run — any extra request (e.g. a host-side LLM summarizer fallback)
 * fails the E2E request-count assertion.
 *
 * Environment:
 *   SHRINK_FAKE_WINDOW  context window (default 200000)
 *   SHRINK_FAKE_BASE    total context tokens reported on the first turn (default 4000)
 *   SHRINK_FAKE_STEP    extra tokens per assistant message in context (default 25000)
 *   SHRINK_FAKE_TRACE   path to append a JSONL trace of every model request
 */
import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";

const env = (key: string, fallback: string) => process.env[key] ?? fallback;
const WINDOW = Number(env("SHRINK_FAKE_WINDOW", "200000"));
const BASE = Number(env("SHRINK_FAKE_BASE", "4000"));
const STEP = Number(env("SHRINK_FAKE_STEP", "25000"));
const TRACE = process.env.SHRINK_FAKE_TRACE;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block && typeof block === "object" && (block as { type?: string }).type === "text"
          ? String((block as { text?: string }).text ?? "")
          : "",
      )
      .join("\n");
  }
  return "";
}

function trace(record: object): void {
  if (!TRACE) return;
  try {
    appendFileSync(TRACE, `${JSON.stringify({ at: Date.now(), ...record })}\n`);
  } catch {
    // Tracing is best effort.
  }
}

interface TraceTurn {
  kind: "turn" | "summary";
  usageTotal: number;
  lastRole?: string;
  lastText: string;
  messages: number;
}

function decide(context: Context): { text: string; usageTotal: number } {
  const messages = context.messages;
  const assistantCount = messages.filter((m) => m.role === "assistant").length;
  const usageTotal = BASE + STEP * assistantCount;
  const last = messages[messages.length - 1];
  const lastText = last ? textOf((last as { content?: unknown }).content) : "";

  // dc-shrink's autonomous continuation arrives as a user-role message;
  // answer it briefly with a small post-compaction context so the cycle
  // completes and thresholds re-arm.
  if (last?.role === "user" && /Context was compacted to free space\./.test(lastText)) {
    return { text: "Continued after compaction.", usageTotal: BASE + 1000 };
  }
  return { text: `Acknowledged turn ${assistantCount + 1}.`, usageTotal };
}

function streamScripted(model: Model<any>, context: Context, options?: SimpleStreamOptions) {
  const stream = createAssistantMessageEventStream();
  const output: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending",
    timestamp: Date.now(),
  };
  const isSummary = /summariz|compaction summar/i.test(context.systemPrompt ?? "");
  setTimeout(() => {
    try {
      stream.push({ type: "start", partial: output });
      const lastMessage = context.messages[context.messages.length - 1];
      const lastText = lastMessage ? textOf((lastMessage as { content?: unknown }).content) : "";

      if (isSummary) {
        // Only reachable if a host asks the provider to summarize — the exact
        // fallback path dc-shrink must never take.
        const text = `FAKE-SUMMARY[${(context.systemPrompt ?? "").slice(0, 120)}]`;
        const record: TraceTurn = {
          kind: "summary",
          usageTotal: 1000,
          lastRole: lastMessage?.role,
          lastText,
          messages: context.messages.length,
        };
        trace(record);
        output.content.push({ type: "text", text });
        stream.push({ type: "text_start", contentIndex: 0, partial: output });
        (output.content[0] as { text: string }).text = text;
        stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
        stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
        output.usage.input = 1000;
        output.usage.output = 50;
        output.usage.totalTokens = 1050;
        output.stopReason = "stop";
      } else {
        const plan = decide(context);
        const record: TraceTurn = {
          kind: "turn",
          usageTotal: plan.usageTotal,
          lastRole: lastMessage?.role,
          lastText: lastText.slice(0, 400),
          messages: context.messages.length,
        };
        trace(record);
        output.content.push({ type: "text", text: plan.text });
        stream.push({ type: "text_start", contentIndex: 0, partial: output });
        (output.content[0] as { text: string }).text = plan.text;
        stream.push({ type: "text_delta", contentIndex: 0, delta: plan.text, partial: output });
        stream.push({ type: "text_end", contentIndex: 0, content: plan.text, partial: output });
        const half = Math.floor(plan.usageTotal / 2);
        output.usage.input = plan.usageTotal - half - 20;
        output.usage.cacheRead = half;
        output.usage.output = 20;
        output.usage.totalTokens = plan.usageTotal;
        output.stopReason = "stop";
      }
      stream.push({ type: "done", reason: output.stopReason as "stop", message: output });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  }, 5);
  return stream;
}

export default function scriptedProvider(pi: ExtensionAPI): void {
  pi.registerProvider("fake", {
    name: "Fake scripted provider",
    baseUrl: "http://127.0.0.1:1/fake",
    apiKey: "fake-key",
    api: "openai-completions",
    models: [
      {
        id: "scripted",
        name: "Scripted fake model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: WINDOW,
        maxTokens: 8192,
      },
    ],
    streamSimple: streamScripted as any,
  });
}
