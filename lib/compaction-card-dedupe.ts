import { Runtime } from "./runtime-probe.ts";
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

const PATCH_MARKER = Symbol.for("dc-distill.compaction-card-dedupe");
const NATIVE_CARD_PI_VERSIONS = new Set(["0.99.0", "0.99.2", "1.0.0"]);
const SUPPORTED_PI_VERSIONS = new Set([
  "0.79.8",
  "0.80.9",
  "0.80.10",
  "0.82.0",
  "0.82.1",
  "0.83.0",
  "0.84.4",
  "0.85.1",
  "0.87.0",
  "0.87.1",
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
 * Present a successful compaction with dc-framework's typed house card.
 * The first matching native card is converted; later matches within the same
 * event are suppressed for older hosts that render duplicates. Reviewed newer Pi
 * hosts use their native card; the adapter leaves their prototype untouched.
 * Unrelated messages pass through unchanged.
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
  // Reviewed Pi 0.99.0, 0.99.2 and 1.0.0 render the latest compaction once and show
  // metrics when expanded. Their native presentation does not need this private shim.
  if (NATIVE_CARD_PI_VERSIONS.has(activePi.packageVersion)) return null;
  if (!SUPPORTED_PI_VERSIONS.has(activePi.packageVersion)) {
    throw new Error(
      `active Pi ${activePi.packageVersion} is not reviewed for compaction-card dedupe`,
    );
  }
  return installCompactionCardDedupe(activePi.prototype);
}
