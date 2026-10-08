/** Missing, null and non-string values retain the host's session-cwd fallback. */
export function resolveCwd(value: unknown, sessionCwd: string): string | null {
  return (typeof value === "string" ? value : sessionCwd) || null;
}
