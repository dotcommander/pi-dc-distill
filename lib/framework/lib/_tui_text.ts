export function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function truncateMiddlePath(value: string, maxChars: number): string {
  const compact = collapseWhitespace(value);
  if (compact.length <= maxChars) return compact;
  const parts = compact.split(/[\\/]/).filter(Boolean);
  const basename = parts.at(-1);
  if (!basename) return truncateText(compact, maxChars);
  const suffix = `…/${parts.slice(-2).join("/")}`;
  if (suffix.length <= maxChars) return suffix;
  return `…/${truncateText(basename, Math.max(8, maxChars - 2))}`;
}
