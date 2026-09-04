/**
 * Path facade — task-shaped wrapper around pi path resolution and file IO.
 *
 * Factory methods return PathHandle objects bound to extension-scoped directories.
 * Reads are sync with fallback defaults; writes are atomic via temp+rename.
 *
 * @module dc-framework/lib/path
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { assertSafeExtName, dataDir, cacheDir, projectDir } from "./_paths.ts";
import { writeFileAtomicSync } from "./_atomic-write.ts";
import { name as appName } from "./_app.ts";

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

// Single source of truth: _paths.assertSafeExtName (non-empty + bare name).
function requireExtName(extName: string): void {
  assertSafeExtName(extName);
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
  data(): PathHandle;
  data(extName: string): PathHandle;
  cache(): PathHandle;
  cache(extName: string): PathHandle;
  project(cwd: string): PathHandle;
  project(extName: string, cwd: string): PathHandle;
}

export const Path: PathOverloads = {
  /**
   * Persistent state directory: ~/.pi/data/<extName>/
   * Omitting extName resolves it from the App container.
   */
  data(extName?: string): PathHandle {
    const n = extName ?? appName();
    requireExtName(n);
    return makeHandle(dataDir(n));
  },

  /**
   * Re-derivable cache directory: ~/.pi/cache/<extName>/
   * Omitting extName resolves it from the App container.
   */
  cache(extName?: string): PathHandle {
    const n = extName ?? appName();
    requireExtName(n);
    return makeHandle(cacheDir(n));
  },

  /**
   * Per-project state directory: ~/.pi/data/<extName>/projects/<slug>/
   * Omitting extName resolves it from the App container.
   */
  project(a: string, b?: string): PathHandle {
    const [ext, cwd] = b === undefined ? [appName(), a] : [a, b];
    requireExtName(ext);
    return makeHandle(projectDir(ext, cwd));
  },
};
