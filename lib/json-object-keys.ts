/** String-aware duplicate-key check, scoped independently to every JSON object.
 * Callers validate JSON syntax and schema separately. */
export function hasNoDuplicateObjectKeys(json: string, rejectEscapedKeys = false): boolean {
  const stack: Array<{ type: "object" | "array"; keys?: Set<string>; expectingKey?: boolean }> = [];
  for (let index = 0; index < json.length; index++) {
    const char = json[index];
    if (char === '"') {
      const start = index;
      index++;
      while (index < json.length) {
        if (json[index] === "\\") {
          index += 2;
          continue;
        }
        if (json[index] === '"') break;
        index++;
      }
      if (index >= json.length) return false;
      const top = stack.at(-1);
      if (top?.type === "object" && top.expectingKey) {
        let key: string;
        try {
          const rawKey = json.slice(start, index + 1);
          if (rejectEscapedKeys && rawKey.includes("\\")) return false;
          key = JSON.parse(rawKey);
        } catch {
          return false;
        }
        if (top.keys!.has(key)) return false;
        top.keys!.add(key);
        top.expectingKey = false;
      }
      continue;
    }
    if (char === "{") stack.push({ type: "object", keys: new Set(), expectingKey: true });
    else if (char === "[") stack.push({ type: "array" });
    else if (char === "}" || char === "]") stack.pop();
    else if (char === "," && stack.at(-1)?.type === "object") stack.at(-1)!.expectingKey = true;
  }
  return stack.length === 0;
}

