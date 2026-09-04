import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface ConflictReport {
  conflicts: ConflictGroup[];
  safe: string[];
}

export interface ConflictGroup {
  agents: string[];
  files: string[];
  recommendation: "serialize" | "warn";
}

type AgentConfig = { builtinToolNames: readonly string[] };

const SOURCE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "go", "py", "rs", "rb", "java", "c", "cpp",
  "h", "hpp", "css", "html", "json", "yaml", "yml", "toml", "md", "txt",
  "sh", "sql", "proto", "graphql",
]);
const QUOTED_RE = /['"`]([^'"`\s]+)['"`]/g;
const TOKEN_SEP_RE = /[\s,;()\[\]{}|<>&!'"`]+/;

function hasSourceExtension(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && SOURCE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

function isCandidate(path: string): boolean {
  return !/^https?:\/\//i.test(path) && (path.includes("*") || hasSourceExtension(path));
}

export function extractFileReferences(prompt: string, cwd: string): Set<string> {
  const raw = new Set<string>();
  for (const match of prompt.matchAll(QUOTED_RE)) {
    if (isCandidate(match[1])) raw.add(match[1]);
  }
  for (const token of prompt.split(TOKEN_SEP_RE)) {
    if (token && isCandidate(token)) raw.add(token);
  }
  return new Set(
    [...raw]
      .map((path) => resolve(cwd, path))
      .filter((path) => path.includes("*") || existsSync(path)),
  );
}

export function detectConflicts(
  agents: Array<{ id: string; prompt: string; type: string }>,
  cwd: string,
  getAgentConfig: (type: string) => AgentConfig | undefined,
): ConflictReport {
  const workAgents = agents.filter((agent) => {
    const tools = getAgentConfig(agent.type)?.builtinToolNames ?? [];
    return tools.includes("edit") || tools.includes("write");
  });
  const files = new Map(
    workAgents.map((agent) => [agent.id, extractFileReferences(agent.prompt, cwd)]),
  );
  const conflicts: ConflictGroup[] = [];
  const conflicted = new Set<string>();
  for (let left = 0; left < workAgents.length; left++) {
    for (let right = left + 1; right < workAgents.length; right++) {
      const overlap = [...files.get(workAgents[left].id)!]
        .filter((path) => files.get(workAgents[right].id)!.has(path));
      if (overlap.length === 0) continue;
      conflicts.push({
        agents: [workAgents[left].id, workAgents[right].id],
        files: overlap,
        recommendation: "serialize",
      });
      conflicted.add(workAgents[left].id);
      conflicted.add(workAgents[right].id);
    }
  }
  return {
    conflicts,
    safe: agents.filter((agent) => !conflicted.has(agent.id)).map((agent) => agent.id),
  };
}
