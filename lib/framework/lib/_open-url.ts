/**
 * Cross-platform URL/file opening (macOS, Linux, Windows).
 *
 * Promoted from dc-html/lib/system/open-url.ts + dc-html/lib/page/open.ts on
 * 2026-05-06. Public surface: openInBrowser.
 */

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolveExecutable } from "./_executable-resolve.ts";

type ResolveExecutableFn = (
  name: string,
  fallbackPaths?: string[],
) => string | undefined;

type OpenUrlCommand = {
  command: string;
  args: string[];
};

/**
 * Build the platform-appropriate command to open a URL.
 * Returns undefined if the opener executable (open / xdg-open) cannot be found.
 */
function getOpenUrlCommand(
  url: string,
  platform = process.platform,
  resolveCommand: ResolveExecutableFn = resolveExecutable,
): OpenUrlCommand | undefined {
  if (platform === "win32") {
    return {
      command: "cmd",
      args: ["/c", "start", "", url],
    };
  }

  if (platform === "darwin") {
    const command = resolveCommand("open");
    return command ? { command, args: [url] } : undefined;
  }

  const command = resolveCommand("xdg-open");
  return command ? { command, args: [url] } : undefined;
}

/**
 * Open a URL in the user's default browser. Returns true if the command was spawned.
 * Errors are silently swallowed — this is best-effort UX.
 */
function openUrl(url: string): boolean {
  const command = getOpenUrlCommand(url);
  if (!command) {
    return false;
  }

  try {
    const child = spawn(command.command, command.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** Open a local file path in the default browser. Throws if no opener is available. */
export function openInBrowser(filePath: string): void {
  const url = pathToFileURL(filePath).href;
  if (!openUrl(url)) {
    throw new Error("No browser opener found (open/xdg-open/start)");
  }
}
