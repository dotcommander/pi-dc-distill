/**
 * Framework path conventions.
 *
 * Single source of truth for ~/.pi paths, replacing the mix of `os.homedir()`,
 * `process.env.HOME`, and `dirname(fileURLToPath())` that used to be scattered
 * across extensions.
 *
 * Convention:
 *   data/<ext>/                       global writable state; survives cache wipes
 *   cache/<ext>/                      global cache; re-derivable
 *   data/<ext>/projects/<slug>/       project-scoped state
 *
 * @module dc-framework/lib/_paths
 */

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PI_ROOT: string = join(homedir(), ".pi");

/** ~/.pi/agent */
export const AGENT_DIR: string = join(PI_ROOT, "agent");

/** ~/.pi/agent/extensions */
export const EXTENSIONS_DIR: string = join(AGENT_DIR, "extensions");

/** ~/.pi/agent/git — git-cloned extension packages */
export const GIT_DIR: string = join(AGENT_DIR, "git");

const CACHE_DIR: string = join(PI_ROOT, "cache");
const DATA_DIR: string = join(PI_ROOT, "data");

/**
 * extName is a directory NAMESPACE under ~/.pi/{data,cache} — a bare name,
 * never a path. Rejecting separators and dot segments here is what keeps
 * Path.data("../other") from escaping the namespace root.
 */
export function assertSafeExtName(extName: string): void {
  if (!extName || !extName.trim()) {
    throw new TypeError("extName must be a non-empty string");
  }
  if (/[\\/]/.test(extName) || extName === "." || extName === "..") {
    throw new TypeError(`extName must be a bare directory name: ${extName}`);
  }
}

const projectDirMemo = new Map<string, string>();

/** global-state: ~/.pi/data/<extName>/ — survives cache wipes */
export function dataDir(extName: string): string {
  assertSafeExtName(extName);
  const p = join(DATA_DIR, extName);
  mkdirSync(p, { recursive: true });
  return p;
}

/** global-cache: ~/.pi/cache/<extName>/ — re-derivable, safe to delete */
export function cacheDir(extName: string): string {
  assertSafeExtName(extName);
  const p = join(CACHE_DIR, extName);
  mkdirSync(p, { recursive: true });
  return p;
}

/**
 * Derive a short, stable slug from a directory path.
 *
 * Format: <basename>-<first 8 hex chars of SHA-256(cwd)>.
 * Example: vvw-a1b2c3d4
 */
export function projectSlug(cwd: string): string {
  const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 8);
  const name = basename(cwd)
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .slice(0, 24);
  return `${name}-${hash}`;
}

/**
 * project-state: ~/.pi/data/<extName>/projects/<slug>/.
 *
 * All project-scoped state is stored under ~/.pi/data/ keyed by a slug derived
 * from the project directory path. No files are written inside the project
 * directory itself.
 */
export function projectDir(extName: string, cwd: string): string {
  assertSafeExtName(extName);
  const memoKey = `${extName}\0${cwd}`;
  const memoized = projectDirMemo.get(memoKey);
  if (memoized) return memoized;

  const base = dataDir(extName);
  const p = join(base, "projects", projectSlug(cwd));
  mkdirSync(p, { recursive: true });
  projectDirMemo.set(memoKey, p);
  return p;
}

/**
 * Directory containing the file identified by `importMetaUrl`.
 *
 * This is `dirname(fileURLToPath(importMeta.url))` — nothing more.
 */
export function extensionDir(importMetaUrl: string): string {
  return dirname(fileURLToPath(importMetaUrl));
}
