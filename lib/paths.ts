/**
 * Path facade — owned port of dc-framework `lib/_paths` + `lib/path`.
 *
 * Single source of truth for ~/.pi paths:
 *
 *   data/<ext>/                       global writable state; survives cache wipes
 *   cache/<ext>/                      global cache; re-derivable
 *   data/<ext>/projects/<slug>/       project-scoped state
 *
 * All project call sites pass an explicit extName (`"dc-distill"`), so the
 * framework's App-container ambient resolution is not ported: extName is
 * required by `Path.data` / `Path.cache` / `Path.project`.
 *
 * Handles: reads are sync with fallback defaults; writes are atomic via
 * temp+fsync+rename (`writeFileAtomicSync` from `lib/fs-support.ts`).
 * Relative-name containment (`resolveWithin`) is preserved
 * byte-for-byte: an absolute name or `..` escape throws.
 *
 * @module lib/paths
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { writeFileAtomicSync } from "./fs-support.ts";

const PI_ROOT: string = join(homedir(), ".pi");
const CACHE_DIR: string = join(PI_ROOT, "cache");
const DATA_DIR: string = join(PI_ROOT, "data");

/**
 * extName is a directory NAMESPACE under ~/.pi/{data,cache} — a bare name,
 * never a path. Rejecting separators and dot segments here is what keeps
 * `Path.data("../other")` from escaping the namespace root.
 */
export function assertSafeExtName(extName: string): void {
  if (!extName || !extName.trim()) {
    throw new TypeError("extName must be a non-empty string");
  }
  if (/[\\/]/.test(extName) || extName === "." || extName === "..") {
    throw new TypeError(`extName must be a bare directory name: ${extName}`);
  }
}

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

const projectDirMemo = new Map<string, string>();

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

/** Handle bound to an extension-scoped directory. */
export interface PathHandle {
  /** Base directory (absolute, mkdir -p already done). */
  readonly path: string;
  /** Resolve a segment relative to the base directory. */
  join(seg: string): string;
  /** Non-throwing existence check. */
  exists(name: string): boolean;
  /** Parse JSON file, or return defaultValue if missing. Throws on bad JSON. */
  read<T = unknown>(name: string, defaultValue?: T): T;
  /** Atomic JSON write (stringified with indent 2 + trailing newline). */
  write(name: string, value: unknown): void;
  /** Raw UTF-8 read, or defaultValue if missing. Throws if both absent. */
  readText(name: string, defaultValue?: string): string;
  /** Atomic UTF-8 write. */
  writeText(name: string, content: string): void;
}

function resolveWithin(basePath: string, name: string): string {
  if (isAbsolute(name)) {
    throw new Error(`Path must be relative to ${basePath}: ${name}`);
  }
  const target = resolve(basePath, name);
  const rel = relative(basePath, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return target;
  }
  throw new Error(`Path escapes base directory ${basePath}: ${name}`);
}

function makeHandle(basePath: string): PathHandle {
  return {
    path: basePath,

    join(seg: string): string {
      return resolveWithin(basePath, seg);
    },

    exists(name: string): boolean {
      return existsSync(resolveWithin(basePath, name));
    },

    read<T = unknown>(name: string, defaultValue?: T): T {
      const fp = resolveWithin(basePath, name);
      if (!existsSync(fp)) {
        if (defaultValue !== undefined) return defaultValue;
        throw new Error(`File not found: ${fp}`);
      }
      try {
        return JSON.parse(readFileSync(fp, "utf8")) as T;
      } catch (cause) {
        throw new Error(`Invalid JSON in ${fp}: ${(cause as Error).message}`, {
          cause,
        });
      }
    },

    write(name: string, value: unknown): void {
      writeFileAtomicSync(
        resolveWithin(basePath, name),
        JSON.stringify(value, null, 2) + "\n",
      );
    },

    readText(name: string, defaultValue?: string): string {
      const fp = resolveWithin(basePath, name);
      if (!existsSync(fp)) {
        if (defaultValue !== undefined) return defaultValue;
        throw new Error(`File not found: ${fp}`);
      }
      return readFileSync(fp, "utf8");
    },

    writeText(name: string, content: string): void {
      writeFileAtomicSync(resolveWithin(basePath, name), content);
    },
  };
}

export interface PathOverloads {
  data(extName: string): PathHandle;
  cache(extName: string): PathHandle;
  project(extName: string, cwd: string): PathHandle;
}

export const Path: PathOverloads = {
  /** Persistent state directory: ~/.pi/data/<extName>/ */
  data(extName: string): PathHandle {
    assertSafeExtName(extName);
    return makeHandle(dataDir(extName));
  },

  /** Re-derivable cache directory: ~/.pi/cache/<extName>/ */
  cache(extName: string): PathHandle {
    assertSafeExtName(extName);
    return makeHandle(cacheDir(extName));
  },

  /** Per-project state directory: ~/.pi/data/<extName>/projects/<slug>/ */
  project(extName: string, cwd: string): PathHandle {
    assertSafeExtName(extName);
    return makeHandle(projectDir(extName, cwd));
  },
};
