/** Build a collision entirely in a new sandbox, through a real Pi manual commit. */
import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RpcClient } from "./rpc-client.ts";
import { latestSessionFile, piEnv, scriptedArgs, type TestDir } from "./env.ts";
import { assertCurrentCompaction } from "./current-compaction.ts";
export const COLLISION_FOCUS = "Preserve collision regression observations.";
export function readRecords(file: string): Array<Record<string, any>> {
  return readFileSync(file, "utf8").split("\n").filter(line => line.trim()).map(line => JSON.parse(line));
}
export function collisionEnv(t: TestDir): Record<string, string> {
  return piEnv(t, { DISTILL_FAKE_BASE: "3000", DISTILL_FAKE_STEP: "500", DISTILL_FAKE_WINDOW: "200000" });
}
export async function seedSummaryCollision(t: TestDir): Promise<{ session: string; abandoned: Record<string, any>; sibling: string }> {
  const client = new RpcClient({ args: scriptedArgs(t), cwd: t.dir, logFile: join(t.dir, "seed-rpc.log"),
    env: collisionEnv(t) });
  try {
    for (let i = 1; i <= 3; i++) {
      const since = client.mark();
      const response = await client.request({ type: "prompt", message: `Collision input turn ${i}. `
        + "discardable collision source ".repeat(2000) });
      if (response.success !== true) throw new Error("Collision seed prompt rejected");
      await client.waitFor(event => event.type === "agent_settled", 30000, { since });
    }
    const compact = await client.request({ type: "compact", customInstructions: COLLISION_FOCUS });
    if (compact.success !== true) throw new Error("Collision seed compact rejected");
  } finally { await client.close(); }
  const session = latestSessionFile(t);
  if (!session) throw new Error("Missing collision seed journal");
  const entries = readRecords(session);
  const compactions = entries.filter(entry => entry.type === "compaction");
  if (compactions.length !== 1) throw new Error("Collision seed must have exactly one compaction");
  const abandoned = compactions[0]!;
  assertCurrentCompaction(abandoned.summary, abandoned.details);
  const sibling = randomBytes(4).toString("hex");
  // Pi reopens the last journal leaf. Keep the real commit as an abandoned sibling,
  // while the new active leaf projects exactly the original conversation input.
  appendFileSync(session, JSON.stringify({ type: "custom", id: sibling, parentId: abandoned.parentId,
    timestamp: new Date().toISOString(), customType: "test-inert-collision-sibling", data: {} }) + "\n");
  return { session, abandoned, sibling };
}
