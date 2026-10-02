import { open, readFile, stat } from "node:fs/promises";
import { compileSessionJsonl } from "./local-compact.ts";
import type { LocalCompileResult } from "./compiler/types.ts";

const MAX_SESSION_BYTES = 20 * 1024 * 1024;

const HEAD_BYTES = 64 * 1024;

/** Diagnostic compatibility reader: oversized files keep whole head/tail lines.
 *  The omitted middle is outside the explicitly bounded digest scope. */

interface BoundedSessionRead {
  content: string;
  digestScope: LocalCompileResult["digestScope"];
}

async function readSessionBounded(path: string): Promise<BoundedSessionRead> {
  const { size } = await stat(path);
  if (size <= MAX_SESSION_BYTES) {
    return { content: await readFile(path, "utf8"), digestScope: "compaction-input" };
  }
  const handle = await open(path, "r");
  try {
    const head = Buffer.alloc(HEAD_BYTES);
    await handle.read(head, 0, HEAD_BYTES, 0);
    const tailLen = MAX_SESSION_BYTES - HEAD_BYTES;
    const tail = Buffer.alloc(tailLen);
    await handle.read(tail, 0, tailLen, size - tailLen);
    const headText = head.toString("utf8");
    const tailText = tail.toString("utf8");
    // Drop partial lines at both cut points; retained malformed records are rejected.
    return {
      content: `${headText.slice(0, headText.lastIndexOf("\n") + 1)}\n${tailText.slice(tailText.indexOf("\n") + 1)}`,
      digestScope: "bounded-compaction-input",
    };
  } finally {
    await handle.close();
  }
}

export async function compileSessionFile(path: string, userFocus?: string, recallEnabled = true): Promise<LocalCompileResult> {
  const input = await readSessionBounded(path);
  const result = compileSessionJsonl(input.content, userFocus, undefined, recallEnabled);
  return { ...result, digestScope: input.digestScope };
}
