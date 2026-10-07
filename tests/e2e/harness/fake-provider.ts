/** Local scripted provider. All invocations are traced; no network/provider API is used. */
import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
const WINDOW = Number(process.env.DISTILL_FAKE_WINDOW ?? 200000);
const BASE = Number(process.env.DISTILL_FAKE_BASE ?? 4000);
const STEP = Number(process.env.DISTILL_FAKE_STEP ?? 25000);
let overflowErrorSent = false;
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(block => block?.type === "text").map(block => block.text).join("\n");
}
function streamScripted(model: Model<any>, context: Context, options?: SimpleStreamOptions) {
  const stream = createAssistantMessageEventStream();
  const output: AssistantMessage = {
    role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop", timestamp: Date.now(),
  };
  setTimeout(() => {
    try {
      const summary = /summariz|compaction summar/i.test(context.systemPrompt ?? "");
      const last = context.messages.at(-1);
      const lastText = textOf(last?.content);
      const carried = context.messages.some(message => textOf(message.content).startsWith(
        "The conversation history before this point was compacted into the following summary:\n\n<summary>\n"));
      const assistantCount = context.messages.filter(message => message.role === "assistant").length;
      const usage = carried && process.env.DISTILL_FAKE_POST_COMPACTION_USAGE !== undefined
        ? Number(process.env.DISTILL_FAKE_POST_COMPACTION_USAGE) : BASE + STEP * assistantCount;
      if (process.env.DISTILL_FAKE_TRACE) appendFileSync(process.env.DISTILL_FAKE_TRACE,
        JSON.stringify({ kind: summary ? "summary" : "turn", usageTotal: usage,
          lastRole: last?.role, lastText: lastText.slice(0, 400), messages: context.messages.length }) + "\n");
      stream.push({ type: "start", partial: output });
      if (options?.signal?.aborted) {
        output.stopReason = "aborted";
        stream.push({ type: "error", reason: "aborted", error: output }); stream.end(); return;
      }
      if (!summary && process.env.DISTILL_FAKE_OVERFLOW_ERROR === "1" && !overflowErrorSent && usage > WINDOW) {
        overflowErrorSent = true;
        output.stopReason = "error";
        output.errorMessage = "Your input exceeds the context window of this model";
        stream.push({ type: "error", reason: "error", error: output }); stream.end(); return;
      }
      const text = summary ? "FAKE-SUMMARY: default provider compaction was invoked" : `Acknowledged turn ${assistantCount + 1}.`;
      output.content.push({ type: "text", text });
      stream.push({ type: "text_start", contentIndex: 0, partial: output });
      stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
      stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
      const half = Math.floor(usage / 2);
      output.usage.input = usage - half - 20; output.usage.cacheRead = half;
      output.usage.output = 20; output.usage.totalTokens = usage;
      stream.push({ type: "done", reason: "stop", message: output }); stream.end();
    } catch (error) {
      output.stopReason = "error";
      output.errorMessage = String(error);
      stream.push({ type: "error", reason: "error", error: output }); stream.end();
    }
  }, 5);
  return stream;
}
export default function scriptedProvider(pi: ExtensionAPI): void {
  pi.registerProvider("fake", { name: "Fake scripted provider", baseUrl: "http://127.0.0.1:1/fake",
    apiKey: "fake-key", api: "openai-completions", models: [{ id: "scripted", name: "Scripted fake model",
      reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: WINDOW, maxTokens: 8192 }], streamSimple: streamScripted as any });
}
