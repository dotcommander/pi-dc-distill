/**
 * Runtime probe — owned port of the consumed dc-framework `x/runtime.ts`
 * surface: `Runtime.loadActivePiInteractiveMode`.
 *
 * Locates the active pi binary (explicit entrypoint, else `process.argv[1]`,
 * else every `pi` on PATH), walks up to 4 directories for the package that
 * has both the public entry and the interactive mode, and dynamically
 * imports it to return the live `InteractiveMode` prototype plus its module
 * URL and package version.
 *
 * `lib/compaction-card-dedupe.ts` uses this to detect the installed host's
 * compaction-card rendering path; ADR 0001/0002 records that hosts are
 * verified by inspecting the installed handler, never assumed from fixtures.
 *
 * @module lib/runtime-probe
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export interface ActivePiInteractiveMode {
  prototype: Record<PropertyKey, unknown> & {
    handleEvent: (...args: unknown[]) => unknown;
  };
  moduleUrl: string;
  packageVersion: string;
}

const ACTIVE_PI_SEARCH_DEPTH = 4;

function activePiEntrypoints(entrypoint?: string): string[] {
  const candidates = entrypoint ? [entrypoint] : [process.argv[1]];
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory) candidates.push(join(directory, "pi"));
  }
  return candidates.filter(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.length > 0,
  );
}

function findActivePiPackage(entrypoint?: string): {
  moduleUrl: string;
  packageJson: string;
} | null {
  for (const candidate of activePiEntrypoints(entrypoint)) {
    if (!existsSync(candidate)) continue;

    let directory = dirname(realpathSync(candidate));
    for (let depth = 0; depth < ACTIVE_PI_SEARCH_DEPTH; depth += 1) {
      const publicEntry = join(directory, "index.js");
      const interactiveMode = join(
        directory,
        "modes",
        "interactive",
        "interactive-mode.js",
      );
      const packageJson = [
        join(directory, "package.json"),
        join(dirname(directory), "package.json"),
      ].find(existsSync);
      if (
        existsSync(publicEntry) &&
        existsSync(interactiveMode) &&
        packageJson
      ) {
        return { moduleUrl: pathToFileURL(publicEntry).href, packageJson };
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return null;
}

function packageVersion(packageJson: string): string {
  const parsed = JSON.parse(readFileSync(packageJson, "utf8")) as {
    version?: unknown;
  };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error("active Pi package has no valid version");
  }
  return parsed.version;
}

export const Runtime = {
  async loadActivePiInteractiveMode(
    entrypoint?: string,
  ): Promise<ActivePiInteractiveMode> {
    const activePi = findActivePiPackage(entrypoint);
    if (!activePi) {
      throw new Error("active Pi module could not be resolved");
    }

    const imported = await import(activePi.moduleUrl) as {
      InteractiveMode?: unknown;
    };
    if (typeof imported.InteractiveMode !== "function") {
      throw new Error("active Pi module does not export InteractiveMode");
    }
    const prototype = imported.InteractiveMode.prototype as
      | ActivePiInteractiveMode["prototype"]
      | undefined;
    if (!prototype || typeof prototype.handleEvent !== "function") {
      throw new Error("active Pi InteractiveMode prototype is invalid");
    }

    return {
      prototype,
      moduleUrl: activePi.moduleUrl,
      packageVersion: packageVersion(activePi.packageJson),
    };
  },
};
