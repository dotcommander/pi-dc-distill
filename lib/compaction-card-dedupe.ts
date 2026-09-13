import { Runtime } from "#shrink-framework/x/runtime";
import {
  COMPACTION_CARD_TYPE,
  type CompactionCardDetails,
} from "./compaction-card.ts";

type CompactionResultLike = {
  summary?: unknown;
  tokensBefore?: unknown;
  estimatedTokensAfter?: unknown;
  details?: unknown;
};

type AgentEventLike = {
  type?: unknown;
  aborted?: unknown;
  result?: CompactionResultLike;
};

type MessageLike = {
  role?: unknown;
  summary?: unknown;
  tokensBefore?: unknown;
  customType?: unknown;
  content?: unknown;
  display?: unknown;
  details?: unknown;
};

type AddMessageToChat = (message: MessageLike, ...args: unknown[]) => unknown;

type InteractiveModeLike = {
  addMessageToChat: AddMessageToChat;
};

type HandleEvent = (
  this: InteractiveModeLike,
  event: AgentEventLike,
) => unknown | Promise<unknown>;

type InteractiveModePrototype = Record<PropertyKey, unknown> & {
  handleEvent?: HandleEvent;
};

const PATCH_MARKER = Symbol.for("dc-shrink.compaction-card-dedupe");
const SUPPORTED_PI_VERSIONS = new Set([
  "0.79.8",
  "0.80.9",
  "0.80.10",
  "0.82.0",
  "0.82.1",
  "0.83.0",
  "0.84.4",
  "0.85.1",
]);

export interface CompactionCardDedupeHandle {
  dispose(): void;
}

function successfulCompaction(
  event: AgentEventLike,
): CompactionResultLike | null {
  if (
    event.type !== "compaction_end" ||
    event.aborted === true ||
    typeof event.result?.summary !== "string" ||
    typeof event.result.tokensBefore !== "number"
  ) {
    return null;
  }
  return event.result;
}

function isMatchingCompactionCard(
  message: MessageLike,
  result: CompactionResultLike,
): boolean {
  return (
    message.role === "compactionSummary" &&
    message.summary === result.summary &&
    message.tokensBefore === result.tokensBefore
  );
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function compactionCardDetails(
  result: CompactionResultLike,
): CompactionCardDetails {
  const source = result.details && typeof result.details === "object"
    ? result.details as Record<string, unknown>
    : {};
  return {
    tokensBefore: finiteNumber(result.tokensBefore) ?? 0,
    tokensAfter: finiteNumber(source.tokensAfter)
      ?? finiteNumber(result.estimatedTokensAfter),
    apiTokensBefore: finiteNumber(source.apiTokensBefore),
    reductionPct: finiteNumber(source.reductionPct),
    summaryTokens: finiteNumber(source.summaryTokens),
    compactor: typeof source.compactor === "string"
      ? source.compactor
      : undefined,
    version: finiteNumber(source.version),
    tier: finiteNumber(source.tier),
    digestScope: typeof source.digestScope === "string"
      ? source.digestScope
      : undefined,
  };
}

function polishedCompactionCard(
  message: MessageLike,
  result: CompactionResultLike,
): MessageLike {
  return {
    ...message,
    role: "custom",
    customType: COMPACTION_CARD_TYPE,
    content: result.summary,
    display: true,
    details: compactionCardDetails(result),
  };
}

/**
 * Prevent Pi's compaction_end TUI handler from rendering the same persisted
 * compaction card twice. The first matching card is converted to dc-framework's
 * typed house presentation; later matches within the same successful event are
 * suppressed. Unrelated messages and future host implementations that render
 * one card pass through unchanged.
 */
export function installCompactionCardDedupe(
  prototype: object,
): CompactionCardDedupeHandle | null {
  const target = prototype as InteractiveModePrototype;
  if (
    typeof target[PATCH_MARKER] === "function" &&
    target[PATCH_MARKER] === target.handleEvent
  ) {
    return null;
  }
  if (typeof target.handleEvent !== "function") return null;

  const originalHandleEvent = target.handleEvent;
  const dedupingHandleEvent: HandleEvent = async function (
    event: AgentEventLike,
  ) {
    const result = successfulCompaction(event);
    if (!result || typeof this.addMessageToChat !== "function") {
      return originalHandleEvent.call(this, event);
    }

    const originalAddMessage = this.addMessageToChat;
    const hadOwnAddMessage = Object.prototype.hasOwnProperty.call(
      this,
      "addMessageToChat",
    );
    let matchingCards = 0;

    this.addMessageToChat = function (
      message: MessageLike,
      ...args: unknown[]
    ) {
      if (isMatchingCompactionCard(message, result)) {
        matchingCards += 1;
        if (matchingCards > 1) return undefined;
        return originalAddMessage.call(
          this,
          polishedCompactionCard(message, result),
          ...args,
        );
      }
      return originalAddMessage.call(this, message, ...args);
    };

    try {
      return await originalHandleEvent.call(this, event);
    } finally {
      if (hadOwnAddMessage) {
        this.addMessageToChat = originalAddMessage;
      } else {
        delete (this as Partial<InteractiveModeLike>).addMessageToChat;
      }
    }
  };

  target.handleEvent = dedupingHandleEvent;
  Object.defineProperty(target, PATCH_MARKER, {
    value: dedupingHandleEvent,
    configurable: true,
    enumerable: false,
    writable: true,
  });
  return {
    dispose(): void {
      if (target.handleEvent !== dedupingHandleEvent) return;
      target.handleEvent = originalHandleEvent;
      if (target[PATCH_MARKER] === dedupingHandleEvent) {
        delete target[PATCH_MARKER];
      }
    },
  };
}

/** Install the shim lazily so headless extension loading does not initialize TUI code. */
export async function installPiCompactionCardDedupe(
  entrypoint?: string,
): Promise<CompactionCardDedupeHandle | null> {
  const activePi = await Runtime.loadActivePiInteractiveMode(entrypoint);
  if (!SUPPORTED_PI_VERSIONS.has(activePi.packageVersion)) {
    throw new Error(
      `active Pi ${activePi.packageVersion} is not reviewed for compaction-card dedupe`,
    );
  }
  return installCompactionCardDedupe(activePi.prototype);
}
