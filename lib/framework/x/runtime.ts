/**
 * Runtime facade — thin dc-framework boundary over Pi host runtime APIs.
 *
 * Use this for Pi operations that are intentionally host-level rather than
 * command, tool, notification, or lifecycle semantics.
 *
 * @module dc-framework/x/runtime
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI } from "../pi/coding-agent";

type FlagOptions = Parameters<ExtensionAPI["registerFlag"]>[1];
type ShortcutKey = Parameters<ExtensionAPI["registerShortcut"]>[0];
type ShortcutOptions = Parameters<ExtensionAPI["registerShortcut"]>[1];

interface RuntimeHost {
  registerFlag?(name: string, options: FlagOptions): void;
  getFlag?(name: string): unknown;
  registerShortcut?(key: ShortcutKey | string, options: ShortcutOptions): void;
  getCommands?(): unknown[];
  getAllTools?(): unknown[];
  getActiveTools?(): string[];
  setActiveTools?(names: string[]): void;
  getThinkingLevel?(): string;
}

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

function runtimeHost(host: RuntimeHost | unknown | undefined): RuntimeHost | undefined {
  return host && typeof host === "object" ? (host as RuntimeHost) : undefined;
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

  registerFlag(
    pi: RuntimeHost,
    name: string,
    options: FlagOptions,
  ): void {
    pi.registerFlag?.(name, options);
  },

  getFlag<T = unknown>(pi: RuntimeHost, name: string): T | undefined {
    return pi.getFlag?.(name) as T | undefined;
  },

  registerShortcut(
    pi: RuntimeHost,
    key: ShortcutKey | string,
    options: ShortcutOptions,
  ): void {
    pi.registerShortcut?.(key, options);
  },

  getCommands<T = unknown>(host: RuntimeHost | unknown | undefined): T[] {
    return (runtimeHost(host)?.getCommands?.() ?? []) as T[];
  },

  getAllTools<T = unknown>(host: RuntimeHost | unknown | undefined): T[] {
    return (runtimeHost(host)?.getAllTools?.() ?? []) as T[];
  },

  getActiveTools(host: RuntimeHost | unknown | undefined): string[] {
    return runtimeHost(host)?.getActiveTools?.() ?? [];
  },

  setActiveTools(host: RuntimeHost | unknown | undefined, names: readonly string[]): void {
    runtimeHost(host)?.setActiveTools?.([...names]);
  },

  getThinkingLevel(piApi?: RuntimeHost | unknown, piContext?: RuntimeHost | unknown): string {
    return (
      runtimeHost(piApi)?.getThinkingLevel?.() ??
      runtimeHost(piContext)?.getThinkingLevel?.() ??
      "off"
    );
  },
};
