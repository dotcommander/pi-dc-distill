import { uniqueValues } from "./helpers.ts";
import { dirname, isAbsolute, relative } from "node:path";

export function displayPath(path: string, root?: string): string {
  if (!root || !isAbsolute(root) || !isAbsolute(path)) return path;
  const child = relative(root, path);
  if (!child) return ".";
  if (child === ".." || child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(child)) return path;
  return `./${child}`;
}

export function choosePathRoot(paths: string[], sessionCwd?: string): string | undefined {
  const absolutePaths = uniqueValues(paths.filter(isAbsolute));
  if (sessionCwd && isAbsolute(sessionCwd) && absolutePaths.some((path) => displayPath(path, sessionCwd) !== path)) {
    return sessionCwd;
  }
  const candidates = new Set<string>();
  for (const path of absolutePaths) {
    let candidate = dirname(path);
    while (dirname(candidate) !== candidate) {
      candidates.add(candidate);
      candidate = dirname(candidate);
    }
  }
  let best: { root: string; savings: number } | undefined;
  for (const root of candidates) {
    const covered = absolutePaths.filter((path) => displayPath(path, root) !== path);
    if (covered.length < 2) continue;
    const savings = covered.reduce((sum, path) => sum + path.length - displayPath(path, root).length, 0)
      - `<path-root>${root}</path-root>\n`.length;
    if (savings <= 0) continue;
    if (!best || savings > best.savings || (savings === best.savings && root.length > best.root.length)) {
      best = { root, savings };
    }
  }
  return best?.root;
}
