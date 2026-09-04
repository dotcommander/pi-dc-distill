/**
 * Shared minimal YAML-like frontmatter parser.
 *
 * The implementation is intentionally narrow: it handles only the shapes used in
 * this repository while keeping one canonical return shape.
 */

export type FrontmatterValue = string | string[];

export interface FrontmatterParseResult {
  frontmatter: Record<string, FrontmatterValue>;
  body: string;
  bodyStart: number;
  error?: string;
}

/** Parse a YAML-style frontmatter block at the start of a file-like string. */
export function parseFrontmatter(text: string): FrontmatterParseResult {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return {
      frontmatter: {},
      body: text,
      bodyStart: 0,
    };
  }

  const normalized = text.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) {
    return {
      frontmatter: {},
      body: text,
      bodyStart: 0,
      error: "frontmatter block is not terminated",
    };
  }

  const rawBlock = match[1] ?? "";
  const bodyStart = match[0].length;
  const body = normalized.slice(bodyStart).replace(/^\n/, "");

  const frontmatter: Record<string, FrontmatterValue> = {};
  const lines = rawBlock.split("\n");
  let i = 0;
  let error: string | undefined;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }

    const matchLine = line.match(/^([A-Za-z0-9_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!matchLine) {
      error ??= `frontmatter is not parseable near: ${line}`;
      i++;
      continue;
    }

    const key = matchLine[1]!;
    const value = matchLine[2].trim();

    if (value.startsWith("[") && value.endsWith("]")) {
      frontmatter[key] = value
        .slice(1, -1)
        .split(",")
        .map((part) => stripQuotes(part.trim()))
        .filter(Boolean);
      i++;
      continue;
    }

    if (value === "") {
      const listValues = collectYamlListValues(lines, i + 1);
      if (listValues) {
        frontmatter[key] = listValues.values;
        i = listValues.nextIndex;
        continue;
      }

      frontmatter[key] = "";
      i++;
      continue;
    }

    if (value === ">" || value === "|") {
      const parts: string[] = [];
      i++;
      while (
        i < lines.length &&
        (lines[i].startsWith("  ") || lines[i].startsWith("\t") || lines[i] === "")
      ) {
        if (lines[i].trim()) parts.push(lines[i].trim());
        i++;
      }
      frontmatter[key] = parts.join(" ");
      continue;
    }

    frontmatter[key] = stripQuotes(value);
    i++;
  }

  return {
    frontmatter,
    body,
    bodyStart,
    error,
  };
}

function collectYamlListValues(
  lines: string[],
  start: number,
): { values: string[]; nextIndex: number } | null {
  const values: string[] = [];
  let i = start;
  while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
    values.push(stripQuotes(lines[i].replace(/^\s*-\s+/, "").trim()));
    i++;
  }
  if (values.length === 0) return null;
  return { values, nextIndex: i };
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, "");
}
