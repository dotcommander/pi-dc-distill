/**
 * Minimal UTF-8 file helpers — Node-native replacements for Bun.file / Bun.write.
 *
 * readText  — UTF-8 read; throws ENOENT, caller decides recovery.
 * exists    — non-throwing existence check.
 */

import { promises as fs } from "node:fs";

/** UTF-8 read. Throws on missing file (ENOENT) — caller decides recovery. */
export function readText(path: string): Promise<string> {
  return fs.readFile(path, "utf8");
}

/** Non-throwing existence check. */
export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
