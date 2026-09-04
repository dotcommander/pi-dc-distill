export type MermaidRole = "plain" | "border" | "nodeText" | "edge" | "title" | "source";

export interface MermaidSpan {
  text: string;
  role: MermaidRole;
}

export interface MermaidArt {
  lines: MermaidSpan[][];
  plainLines: string[];
  fallback: boolean;
  fallbackReason?: "unsupported" | "invalid" | "too-wide" | "oversize";
}
