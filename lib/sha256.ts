import { createHash } from "node:crypto";

/** Full SHA-256 hex digest; callers own any display/slug truncation. */
export function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** 22-character base64url identity (leading 16 bytes of SHA-256). */
export function sha256Identity(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("base64url").slice(0, 22);
}
