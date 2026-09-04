/**
 * dc-framework/lib/_theme-map.ts — Per-extension default theme assignments
 *
 * Themes live in .pi/themes/ and are mapped by extension filename (no extension).
 * Session.init calls applyExtensionDefaults(import.meta.url, ctx) to load the
 * mapped theme and terminal title on boot.
 *
 * Available themes (.pi/themes/):
 *   catppuccin-mocha · cyberpunk · dracula · everforest · gruvbox
 *   midnight-ocean   · nord      · ocean-breeze · rose-pine
 *   synthwave        · tokyo-night
 */

import type { ExtensionContext, ExtensionAPI } from "../pi/coding-agent";
import { existsSync, readFileSync } from "fs";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "node:module";
import { AGENT_DIR } from "./_paths.ts";
import { JsonStore } from "./_json-store.ts";
import { logDiag } from "./_log.ts";

const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const defaultThemes = _require("./defaults/themes.json") as {
  map: Record<string, string>;
  fallback: string;
};

// ── Theme assignments (config-backed) ───────────────────────────────────────
//
// Per-extension theme assignments + fallback live in
// ~/.pi/agent/pi-dc-distill-themes.json, NOT in source (workspace config-data
// rule). Embedded defaults (./defaults/themes.json) are materialized to that
// path on first read, then the user may edit it. Key = extension filename
// without extension; value = theme name from .pi/themes/<value>.json.

interface ThemeConfig {
  map: Record<string, string>;
  fallback: string;
}

const THEME_STORE_PATH = join(AGENT_DIR, "pi-dc-distill-themes.json");

// Memoized: load once per process. update(c => c) materializes embedded
// defaults on first read when the file is absent, so users get an editable file.
let themeConfigMemo: ThemeConfig | null = null;
function loadThemeConfig(): ThemeConfig {
  if (themeConfigMemo) return themeConfigMemo;
  const store = new JsonStore<ThemeConfig>(
    THEME_STORE_PATH,
    defaultThemes as ThemeConfig,
  );
  try {
    if (!store.exists()) store.update((c) => c);
    themeConfigMemo = store.read();
  } catch (err) {
    logDiag("[dc-framework theme-map] theme config unreadable", err);
    themeConfigMemo = defaultThemes as ThemeConfig;
  }
  return themeConfigMemo;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Derive the extension name (e.g. "dc-minimal") from its import.meta.url. */
function extensionName(fileUrl: string): string {
  const filePath = fileUrl.startsWith("file://")
    ? fileURLToPath(fileUrl)
    : fileUrl;
  let name = basename(filePath).replace(/\.[^.]+$/, "");
  if (name === "index") {
    name = basename(dirname(filePath));
  }
  return name;
}

/** Read the `theme` key from settings.json. Returns null if absent/unreadable. */
function settingsTheme(): string | null {
  try {
    const settingsPath = join(AGENT_DIR, "settings.json");
    if (!existsSync(settingsPath)) return null;
    const raw = JSON.parse(readFileSync(settingsPath, "utf8"));
    return raw?.theme || null;
  } catch (err) {
    logDiag("[dc-framework theme-map] settings.json unreadable", err);
    return null;
  }
}

// ── Theme ──────────────────────────────────────────────────────────────────

/**
 * Apply the mapped theme for an extension on session boot.
 *
 * @param fileUrl   Pass `import.meta.url` from the calling extension file.
 * @param ctx       The ExtensionContext from the session_start handler.
 * @returns         true if the theme was applied successfully, false otherwise.
 */
function applyExtensionTheme(fileUrl: string, ctx: ExtensionContext): boolean {
  if (!ctx.hasUI) return false;

  const name = extensionName(fileUrl);

  // If there are multiple extensions stacked in 'ipi', they each fire session_start
  // and try to apply their own mapped theme. The LAST one to fire wins.
  // Since system-select is last in the ipi alias array, it was setting 'catppuccin-mocha'.

  // We want to skip theme application for all secondary extensions if they are stacked,
  // so the primary extension (first in the array) dictates the theme.
  const primaryExt = primaryExtensionName();
  if (primaryExt && primaryExt !== name) {
    return true; // Pretend we succeeded, but don't overwrite the primary theme
  }

  // Respect settings.json theme — if the user set one, use it; don't override.
  const saved = settingsTheme();
  if (saved) {
    const result = ctx.ui.setTheme(saved);
    return result.success;
  }

  // No saved preference: fall back to extension map, then configured fallback.
  const cfg = loadThemeConfig();
  const themeName =
    cfg.map[name] || cfg.map[name.replace(/^dc-/, "")] || cfg.fallback;

  const result = ctx.ui.setTheme(themeName);
  if (!result.success && themeName !== cfg.fallback) {
    return ctx.ui.setTheme(cfg.fallback).success;
  }

  return result.success;
}
// ── Title ──────────────────────────────────────────────────────────────────

/**
 * Read process.argv to find the first -e / --extension flag value.
 *
 * When Pi is launched as:
 *   pi -e extensions/taskagent-widget.ts -e extensions/index.ts
 *
 * process.argv contains those paths verbatim. Every stacked extension calls
 * this and gets the same answer ("taskagent-widget"), so all setTitle calls
 * are idempotent — no shared state or deduplication needed.
 *
 * Returns null if no -e flag is present (e.g. plain `pi` with no extensions).
 */
function primaryExtensionName(): string | null {
  const argv = process.argv;
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === "-e" || argv[i] === "--extension") {
      const filePath = argv[i + 1];
      let name = basename(filePath).replace(/\.[^.]+$/, "");
      if (name === "index") {
        name = basename(dirname(filePath));
      }
      return name;
    }
  }
  return null;
}

/**
 * Set the terminal title to "π - <first-extension-name>" on session boot.
 * Reads the title from process.argv so all stacked extensions agree on the
 * same value — no coordination or shared state required.
 *
 * Deferred 150 ms to fire after Pi's own startup title-set.
 */
function applyExtensionTitle(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  const name = primaryExtensionName();
  if (!name) return;
  setTimeout(() => ctx.ui.setTitle(`π - ${name}`), 150);
}

// ── Combined default ───────────────────────────────────────────────────────

/**
 * Apply both the mapped theme AND the terminal title for an extension.
 * Apply the extension defaults — call this in every session_start.
 *
 * Usage:
 *   import { applyExtensionDefaults } from "./dc-framework/lib/_theme-map.ts";
 *
 *   pi.on("session_start", async (_event, ctx) => {
 *     applyExtensionDefaults(import.meta.url, ctx);
 *     // ... rest of handler
 *   });
 */
export function applyExtensionDefaults(
  fileUrl: string,
  ctx: ExtensionContext,
  _api?: ExtensionAPI,
): void {
  applyExtensionTheme(fileUrl, ctx);
  applyExtensionTitle(ctx);
}
