import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installCompactionCardDedupe,
  installPiCompactionCardDedupe,
} from "./compaction-card-dedupe.ts";
import { COMPACTION_CARD_TYPE } from "./compaction-card.ts";
import { Runtime } from "#shrink-framework/x/runtime";

type TestMessage = {
  role: string;
  summary?: string;
  tokensBefore?: number;
};

const RESULT = {
  summary: "_160,078 → 4,914 tokens (97% reduction)_",
  tokensBefore: 160_078,
  details: {
    compactor: "dc-shrink",
    version: 6,
    tier: 1,
    tokensAfter: 4_914,
    summaryTokens: 1_200,
    reductionPct: 97,
    digestScope: "compaction-input",
  },
};

const EVENT = {
  type: "compaction_end",
  aborted: false,
  result: RESULT,
};

function compactionCard(
  summary = RESULT.summary,
  tokensBefore = RESULT.tokensBefore,
): TestMessage {
  return { role: "compactionSummary", summary, tokensBefore };
}

const polishedCard = () => ({
  role: "custom",
  summary: RESULT.summary,
  tokensBefore: RESULT.tokensBefore,
  customType: COMPACTION_CARD_TYPE,
  content: RESULT.summary,
  display: true,
  details: {
    tokensBefore: RESULT.tokensBefore,
    tokensAfter: 4_914,
    apiTokensBefore: undefined,
    reductionPct: 97,
    summaryTokens: 1_200,
    compactor: "dc-shrink",
    version: 6,
    tier: 1,
    digestScope: "compaction-input",
  },
});

describe("compaction card dedupe", () => {
  test("leaves reviewed Pi 0.99's native card and prototype unchanged", async () => {
    const root = mkdtempSync(join(tmpdir(), "dc-shrink-reviewed-pi-"));
    try {
      mkdirSync(join(root, "bin"));
      mkdirSync(join(root, "modes", "interactive"), { recursive: true });
      writeFileSync(join(root, "bin", "pi"), "#!/bin/sh\n");
      writeFileSync(join(root, "package.json"), JSON.stringify({ version: "0.99.0", type: "module" }));
      writeFileSync(join(root, "index.js"), `
        export class InteractiveMode {
          async handleEvent(event) {
            this.addMessageToChat({ role: "compactionSummary", summary: event.result.summary, tokensBefore: event.result.tokensBefore });
          }
        }
      `);
      writeFileSync(join(root, "modes", "interactive", "interactive-mode.js"), "export {};\n");

      const entrypoint = join(root, "bin", "pi");
      const activePi = await Runtime.loadActivePiInteractiveMode(entrypoint);
      const original = activePi.prototype.handleEvent;
      const installation = await installPiCompactionCardDedupe(entrypoint);
      try {
        expect(installation).toBeNull();
        const rendered: TestMessage[] = [];
        await activePi.prototype.handleEvent.call({
          addMessageToChat(message: TestMessage) { rendered.push(message); },
        }, EVENT);
        expect(rendered).toEqual([compactionCard()]);
      } finally {
        installation?.dispose();
      }
      expect(activePi.prototype.handleEvent).toBe(original);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("renders one polished card from Pi's duplicate compaction cards", async () => {
    class DuplicateRenderer {
      readonly rendered: TestMessage[] = [];

      addMessageToChat(message: TestMessage): void {
        this.rendered.push(message);
      }

      async handleEvent(event: typeof EVENT): Promise<void> {
        this.addMessageToChat(compactionCard());
        this.addMessageToChat(
          compactionCard(event.result.summary, event.result.tokensBefore),
        );
      }
    }

    expect(installCompactionCardDedupe(DuplicateRenderer.prototype)).not.toBeNull();
    const renderer = new DuplicateRenderer();

    await renderer.handleEvent(EVENT);

    expect(renderer.rendered).toEqual([polishedCard()]);
    expect(Object.hasOwn(renderer, "addMessageToChat")).toBe(false);
  });

  test("preserves unrelated messages and a single host-rendered card", async () => {
    class SingleRenderer {
      readonly rendered: TestMessage[] = [];

      addMessageToChat(message: TestMessage): void {
        this.rendered.push(message);
      }

      async handleEvent(_event: typeof EVENT): Promise<void> {
        this.addMessageToChat({ role: "assistant" });
        this.addMessageToChat(compactionCard("older summary", 90_000));
        this.addMessageToChat(compactionCard());
      }
    }

    expect(installCompactionCardDedupe(SingleRenderer.prototype)).not.toBeNull();
    const renderer = new SingleRenderer();

    await renderer.handleEvent(EVENT);

    expect(renderer.rendered).toEqual([
      { role: "assistant" },
      compactionCard("older summary", 90_000),
      polishedCard(),
    ]);
  });

  test("installation is idempotent", () => {
    class Renderer {
      addMessageToChat(_message: TestMessage): void {}
      async handleEvent(): Promise<void> {}
    }

    expect(installCompactionCardDedupe(Renderer.prototype)).not.toBeNull();
    expect(installCompactionCardDedupe(Renderer.prototype)).toBeNull();
  });

  test("reinstalls after another integration replaces the patched handler", async () => {
    class Renderer {
      readonly rendered: TestMessage[] = [];

      addMessageToChat(message: TestMessage): void {
        this.rendered.push(message);
      }

      async handleEvent(_event: typeof EVENT): Promise<void> {}
    }

    expect(installCompactionCardDedupe(Renderer.prototype)).not.toBeNull();
    Renderer.prototype.handleEvent = async function (event: typeof EVENT) {
      this.addMessageToChat(compactionCard());
      this.addMessageToChat(
        compactionCard(event.result.summary, event.result.tokensBefore),
      );
    };
    expect(installCompactionCardDedupe(Renderer.prototype)).not.toBeNull();

    const renderer = new Renderer();
    await renderer.handleEvent(EVENT);

    expect(renderer.rendered).toEqual([polishedCard()]);
  });

  test("restores the renderer method when the host handler throws", async () => {
    class ThrowingRenderer {
      addMessageToChat(_message: TestMessage): void {}

      async handleEvent(_event: typeof EVENT): Promise<void> {
        this.addMessageToChat(compactionCard());
        throw new Error("render failed");
      }
    }

    expect(installCompactionCardDedupe(ThrowingRenderer.prototype)).not.toBeNull();
    const renderer = new ThrowingRenderer();
    const originalAddMessage = renderer.addMessageToChat;

    await expect(renderer.handleEvent(EVENT)).rejects.toThrow("render failed");

    expect(renderer.addMessageToChat).toBe(originalAddMessage);
    expect(Object.hasOwn(renderer, "addMessageToChat")).toBe(false);
  });

  test("uses the reviewed active Pi presentation with fixture session rendering", async () => {
    const activePi = await Runtime.loadActivePiInteractiveMode();
    expect([
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
      "0.99.0",
    ]).toContain(
      activePi.packageVersion,
    );
    const originalHandler = activePi.prototype.handleEvent;
    const installation = await installPiCompactionCardDedupe();
    const rendered: TestMessage[] = [];
    const fakeMode = {
      isInitialized: true,
      footer: { invalidate() {} },
      settingsManager: { getShowTerminalProgress: () => false },
      clearStatusIndicator() {},
      chatContainer: { clear() {} },
      sessionManager: {
        buildContextEntries() {
          return [{ type: "compaction" }];
        },
      },
      renderSessionEntries(entries: TestMessage[]) {
        for (const entry of entries) this.addMessageToChat(entry);
      },
      rebuildChatFromMessages() {
        this.addMessageToChat(compactionCard());
      },
      addMessageToChat(message: TestMessage) {
        rendered.push(message);
      },
      flushCompactionQueue() {},
      ui: { requestRender() {} },
    };

    // Session rendering is stubbed here; this is not an installed-renderer proof.
    try {
      await activePi.prototype.handleEvent.call(fakeMode, EVENT);
      if (activePi.packageVersion === "0.99.0") {
        expect(installation).toBeNull();
        expect(activePi.prototype.handleEvent).toBe(originalHandler);
        expect(rendered).toHaveLength(1);
        expect(rendered[0]).toMatchObject(compactionCard());
      } else {
        expect(rendered).toEqual([polishedCard()]);
      }
    } finally {
      installation?.dispose();
    }
  });

  test("disposal restores only the wrapper it installed", () => {
    class Renderer {
      addMessageToChat(_message: TestMessage): void {}
      async handleEvent(): Promise<void> {}
    }
    const original = Renderer.prototype.handleEvent;
    const installation = installCompactionCardDedupe(Renderer.prototype)!;

    installation.dispose();
    expect(Renderer.prototype.handleEvent).toBe(original);

    const second = installCompactionCardDedupe(Renderer.prototype)!;
    const replacement = async () => {};
    Renderer.prototype.handleEvent = replacement;
    second.dispose();
    expect(Renderer.prototype.handleEvent).toBe(replacement);
  });

  test("rejects active Pi versions that have not been reviewed", async () => {
    const root = mkdtempSync(join(tmpdir(), "dc-shrink-unsupported-pi-"));
    try {
      mkdirSync(join(root, "bin"));
      mkdirSync(join(root, "modes", "interactive"), { recursive: true });
      writeFileSync(join(root, "bin", "pi"), "#!/bin/sh\n");
      writeFileSync(join(root, "package.json"), JSON.stringify({ version: "0.81.0", type: "module" }));
      writeFileSync(join(root, "index.js"), "export class InteractiveMode { async handleEvent() {} }\n");
      writeFileSync(join(root, "modes", "interactive", "interactive-mode.js"), "export {};\n");

      await expect(installPiCompactionCardDedupe(join(root, "bin", "pi")))
        .rejects.toThrow("not reviewed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
