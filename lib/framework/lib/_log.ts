// lib/_log.ts — single durable diagnostic sink for dc-framework.
// pi's TUI captures stderr; never console.* on a handler/boot path. Route here:
// durable append to ~/.pi/data/pi-dc-distill/guard-errors.log, stderr echo only when DC_GUARD_VERBOSE=1.
// Static imports — bare require() is undefined under Node ESM ("type": "module")
// and would silently kill this sink inside the try/catch.
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const VERBOSE = process.env.DC_GUARD_VERBOSE === "1";

export function logDiag(tag: string, err: unknown): void {
  const stack = err instanceof Error ? (err.stack ?? err.message) : String(err);
  const line = `${new Date().toISOString()} ${tag} ${stack}\n`;
  try {
    const base = join(homedir(), ".pi", "data", "pi-dc-distill");
    mkdirSync(base, { recursive: true });
    const logPath = join(base, "guard-errors.log");
    appendFileSync(logPath, line);
  } catch {
    // Last resort: if logging itself fails, drop silently. We are NOT going
    // to wedge the TUI by writing to stderr from a guard handler.
  }
  if (VERBOSE) {
    console.error(tag, "caught:", err);
  }
}
