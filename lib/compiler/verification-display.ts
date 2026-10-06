import type { ResumeCheckpointV1 } from "./checkpoint.ts";
import type { VerificationReceipt } from "./types.ts";
import { renderVerificationReceipt } from "./tool-tracker.ts";

function category(command: string): string {
  if (/\b(?:tsc|typecheck|check-types)\b/.test(command)) return "types";
  if (/\b(?:lint|eslint|biome|vet)\b/.test(command)) return "lint";
  if (/\b(?:architecture|distill:architecture)\b/.test(command)) return "architecture";
  if (/\b(?:test|pytest|vitest|jest)\b/.test(command)) return "tests";
  if (/\b(?:build|compile)\b/.test(command)) return "build";
  if (/\bgit\s+diff\s+--check\b/.test(command)) return "whitespace";
  return "other";
}
function required(receipt: VerificationReceipt, checkpoint: ResumeCheckpointV1): boolean {
  const requirements = new Set(checkpoint.tasks.filter(task => task.status !== "done").flatMap(task => task.requires));
  return checkpoint.preconditions.some(item => requirements.has(item.id) && item.kind === "verification-pass" &&
    item.runner === receipt.tool && item.command === receipt.command && item.cwd === receipt.cwd);
}
function protectedReceipt(receipt: VerificationReceipt, checkpoint: ResumeCheckpointV1): boolean {
  return required(receipt, checkpoint) || receipt.status === "FAIL" || receipt.status === "INCOMPLETE";
}
/** Match required identities before display shortening; share all eviction fences. */
export function verificationProtection(checkpoint?: ResumeCheckpointV1): (line: string) => boolean {
  const protectedLines = new Set(checkpoint ? checkpoint.evidence.verification.filter(receipt => protectedReceipt(receipt, checkpoint))
    .map(receipt => renderVerificationReceipt(receipt, checkpoint.evidence.mutationEpoch)) : []);
  return line => line.startsWith("FAIL ") || line.startsWith("INCOMPLETE ") || protectedLines.has(line);
}
/** Only presentation changes: checkpoint retains full identity, chronology and failures. */
export function prioritizeVerificationDisplay(checkpoint: ResumeCheckpointV1, limit = 10): string[] {
  const latest = new Map<string, VerificationReceipt>();
  for (const receipt of checkpoint.evidence.verification) {
    // An incomplete newer attempt cannot erase the last completed observation.
    const identity = JSON.stringify([receipt.tool, receipt.command, receipt.cwd, receipt.status === "INCOMPLETE" ? "pending" : "completed"]);
    latest.delete(identity);
    latest.set(identity, receipt);
  }
  const newestFirst = [...latest.values()].reverse();
  const stalePasses = newestFirst.filter(receipt => receipt.status === "PASS" &&
    (receipt.freshnessEstablished === false || receipt.mutationEpoch < checkpoint.evidence.mutationEpoch) && !protectedReceipt(receipt, checkpoint));
  const skippedStale = new Set(stalePasses.slice(1));
  const recency = newestFirst.filter(receipt => !skippedStale.has(receipt));
  const selected: VerificationReceipt[] = [];
  const add = (receipt: VerificationReceipt) => { if (!selected.includes(receipt) && selected.length < limit) selected.push(receipt); };
  recency.filter(receipt => required(receipt, checkpoint)).forEach(add);
  recency.filter(receipt => receipt.status === "FAIL" || receipt.status === "INCOMPLETE").forEach(add);
  const categories = new Set<string>();
  for (const receipt of recency) {
    const kind = category(receipt.command);
    if (kind !== "other" && !categories.has(kind)) { add(receipt); categories.add(kind); }
  }
  recency.forEach(add);
  const lines = selected.map(receipt => renderVerificationReceipt(receipt, checkpoint.evidence.mutationEpoch));
  if (skippedStale.size) lines.push(`... (${skippedStale.size} stale verification receipts omitted; exact observations retained in checkpoint)`);
  if (recency.length > selected.length) lines.push(`... (${recency.length - selected.length} verification rows omitted; exact observations retained in checkpoint)`);
  return lines;
}
export function verificationEvictionIndex(lines: string[], checkpoint?: ResumeCheckpointV1): number {
  const isProtected = verificationProtection(checkpoint);
  return lines.findLastIndex(line => !isProtected(line));
}
