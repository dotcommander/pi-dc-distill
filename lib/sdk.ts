/** Single Pi SDK boundary for the host adapter and active source projection. */
import * as codingAgent from "@earendil-works/pi-coding-agent";
import * as ai from "@earendil-works/pi-ai";
export * from "@earendil-works/pi-coding-agent";

function capability<T>(value: T): T {
  if (typeof value !== "function") throw new Error("missing SDK capability");
  return value;
}
/** Namespace access defers missing-capability failures until the registered hook. */
export function runtimeCapabilities() {
  return {
    buildSessionContext: capability(codingAgent.buildSessionContext),
    buildSessionProjection: capability(codingAgent.buildSessionProjection),
    estimateTokens: capability(codingAgent.estimateTokens),
    sessionEntryToContextMessages: capability(codingAgent.sessionEntryToContextMessages),
    getCurrentSystemMessage: capability(ai.getCurrentSystemMessage),
  };
}
export const buildSessionProjection: typeof codingAgent.buildSessionProjection = (...args) => capability(codingAgent.buildSessionProjection)(...args);
export const getCurrentSystemMessage: typeof ai.getCurrentSystemMessage = (...args) => capability(ai.getCurrentSystemMessage)(...args);
