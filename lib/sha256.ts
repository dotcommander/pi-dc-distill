import { createHash } from "node:crypto";

/** Full SHA-256 digest; callers own any display/slug truncation. */
export function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
