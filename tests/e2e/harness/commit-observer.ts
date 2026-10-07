/** Test-only observation of real host callbacks and native UI notify calls. */
import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function commitObserver(pi: ExtensionAPI): void {
  const log = (value: unknown) => {
    const path = process.env.DISTILL_COMMIT_OBSERVER;
    if (path) appendFileSync(path, JSON.stringify(value) + "\n");
  };
  pi.on("session_start", (_event, ctx) => {
    log({ kind: "start", hasUI: ctx.hasUI });
    const notify = ctx.ui.notify.bind(ctx.ui);
    ctx.ui.notify = (message, type) => {
      log({ kind: "notify", message, type, hasUI: ctx.hasUI });
      return notify(message, type);
    };
  });
  pi.on("session_compact", (event, ctx) => {
    const newest = ctx.sessionManager.getBranch().findLast(entry => entry.type === "compaction");
    log({ kind: "commit", hasUI: ctx.hasUI, fromExtension: event.fromExtension,
      eventId: event.compactionEntry.id, eventAttempt: (event.compactionEntry.details as any)?.attemptId,
      newestId: newest?.id, newestAttempt: (newest?.details as any)?.attemptId,
      sameSummary: event.compactionEntry.summary === newest?.summary });
  });
}
