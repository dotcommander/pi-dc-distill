/**
 * dc-framework/lib/_ansi.ts — Thin ANSI true-color helpers
 *
 * Single source of truth for \x1b[ and \x1b] escape literals.
 * Every extension that needs raw RGB coloring imports from here
 * instead of embedding escape sequences inline.
 *
 * Invariant: this is the ONLY file in extensions/ that may contain raw ANSI/OSC
 * escape literals.
 */

// ── Opening sequences (prefix-only, no reset) ────────────────────────────────
// Use when callers manually append FG_RESET / BG_RESET.

/** True-color foreground opening sequence only (no reset). */
// eslint-disable-next-line pi-no-ansi
// eslint-disable-next-line pi-no-ansi
export function fgOpen(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}

/** True-color background opening sequence only (no reset). */
// eslint-disable-next-line pi-no-ansi
// eslint-disable-next-line pi-no-ansi
export function bgOpen(r: number, g: number, b: number): string {
  return `\x1b[48;2;${r};${g};${b}m`;
}

// ── Wrap helpers (opening + content + reset) ─────────────────────────────────
// Use when you want a self-contained colored string.

/** Wrap text with a true-color foreground and reset. */
// eslint-disable-next-line pi-no-ansi
// eslint-disable-next-line pi-no-ansi
export function fgRgb(r: number, g: number, b: number, s: string): string {
  return `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m`;
}

/** Wrap text with a true-color background and reset. */
// eslint-disable-next-line pi-no-ansi
// eslint-disable-next-line pi-no-ansi
export function bgRgb(r: number, g: number, b: number, s: string): string {
  return `\x1b[48;2;${r};${g};${b}m${s}\x1b[49m`;
}

/** Bold text (1m) with reset (22m). */
// eslint-disable-next-line pi-no-ansi
export function bold(s: string): string {
  return `\x1b[1m${s}\x1b[22m`;
}

/** Dim attribute (2m) with reset (22m). */
// eslint-disable-next-line pi-no-ansi
export function dim(s: string): string {
  return `\x1b[2m${s}\x1b[22m`;
}

/** 256-color foreground opening sequence only (no reset). Pair with RESET or FG_RESET. */
// eslint-disable-next-line pi-no-ansi
export function fg256(n: number): string {
  return `\x1b[38;5;${n}m`;
}

// ── Reset sequences ───────────────────────────────────────────────────────────

/** ANSI foreground reset sequence. */
// eslint-disable-next-line pi-no-ansi
export const FG_RESET = "\x1b[39m";

/** ANSI background reset sequence. */
// eslint-disable-next-line pi-no-ansi
export const BG_RESET = "\x1b[49m";

/** Full SGR reset sequence (0m) — clears all attributes including FG, BG, bold, dim. */
// eslint-disable-next-line pi-no-ansi
export const RESET = "\x1b[0m";

// ── Terminal control sequences (CSI commands, not SGR) ───────────────────────

/** Clear entire screen + move cursor to home (1,1). ED 2 + CUP 1;1. */
// eslint-disable-next-line pi-no-ansi
export const CLEAR_SCREEN = "\x1b[2J\x1b[H";

// ── Operating system commands (OSC) ──────────────────────────────────────────

type TerminalProgressState =
  | "clear"
  | "normal"
  | "error"
  | "indeterminate"
  | "warning";

const TERMINAL_PROGRESS_CODES: Record<TerminalProgressState, number> = {
  clear: 0,
  normal: 1,
  error: 2,
  indeterminate: 3,
  warning: 4,
};

function canWriteTerminalControl(opts: { force?: boolean } = {}): boolean {
  return Boolean(opts.force || process.stdout.isTTY);
}

function writeTerminalControl(sequence: string): boolean {
  try {
    process.stdout.write(sequence);
    return true;
  } catch {
    return false;
  }
}

export function sanitizeTerminalTitle(title: string): string {
  return title
    .replace(/[\r\n\t]+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
    .trim()
    .slice(0, 200);
}

export function writeTerminalTitle(
  title: string,
  opts: { force?: boolean } = {},
): boolean {
  if (!canWriteTerminalControl(opts)) return false;
  const safe = sanitizeTerminalTitle(title);
  if (!safe) return false;
  // eslint-disable-next-line pi-no-ansi
  return writeTerminalControl(`\x1b]0;${safe}\x07`);
}

export function writeTerminalProgress(
  state: TerminalProgressState,
  value?: number,
  opts: { force?: boolean } = {},
): boolean {
  if (!canWriteTerminalControl(opts)) return false;
  const code = TERMINAL_PROGRESS_CODES[state];
  const boundedValue = typeof value === "number"
    ? Math.max(0, Math.min(100, Math.round(value)))
    : undefined;
  const suffix = state === "clear"
    ? ";"
    : boundedValue === undefined
      ? ""
      : `;${boundedValue}`;
  // eslint-disable-next-line pi-no-ansi
  return writeTerminalControl(`\x1b]9;4;${code}${suffix}\x07`);
}

/** Strip ANSI SGR escape codes from a string. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
