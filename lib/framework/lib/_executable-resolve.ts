/**
 * Cross-platform executable resolution.
 *
 * Source: https://github.com/getcompanion-ai/feynman @ a16cf97
 * File: src/system/executables.ts
 * Adapted: removed Feynman-specific preset constants (PANDOC/BROWSER/MERMAID/BREW fallback paths
 *          and resolveAllExecutables), kept core resolveExecutable/resolveExecutableAsync.
 *          Consumers define their own fallbacks.
 * Date: 2026-04-26
 *
 * Why this pattern: finding system executables across macOS/Linux/Windows requires
 * common Homebrew/usr-local fallback paths and a safe PATH scan. Centralizing this
 * avoids every extension re-implementing executable lookup.
 */

import { accessSync, constants, existsSync, statSync } from "node:fs";
import { which } from "./_exec.ts";

function findInFallbackPaths(fallbackPaths: string[]): string | undefined {
  for (const candidate of fallbackPaths) {
    if (!existsSync(candidate)) {
      continue;
    }
    try {
      if (statSync(candidate).isFile()) {
        accessSync(candidate, constants.X_OK);
        return candidate;
      }
    } catch {
      // Candidate exists but is not stat-able or executable; keep scanning fallbacks.
      continue;
    }
  }
  return undefined;
}

function resolveFallbackThenPath(
  name: string,
  fallbackPaths: string[],
): string | undefined {
  const fallback = findInFallbackPaths(fallbackPaths);
  if (fallback) {
    return fallback;
  }

  return which(name) ?? undefined;
}

/**
 * Resolve an executable by name, checking fallback paths first, then the system PATH.
 * Returns the absolute path or undefined.
 */
export function resolveExecutable(
  name: string,
  fallbackPaths: string[] = [],
): string | undefined {
  return resolveFallbackThenPath(name, fallbackPaths);
}

/**
 * Async-signature variant of resolveExecutable, kept for API compatibility.
 * The underlying checks are synchronous (statSync/accessSync) — this does NOT
 * avoid blocking the event loop.
 */
export async function resolveExecutableAsync(
  name: string,
  fallbackPaths: string[] = [],
): Promise<string | undefined> {
  return resolveFallbackThenPath(name, fallbackPaths);
}
