/**
 * Deterministic, bounded terminal layout for a deliberately small Mermaid
 * flowchart subset. The ranking, barycenter ordering, coordinate relaxation,
 * and greedy route-track ideas are adapted from mermaidtext v0.1.1.
 */
import { visibleWidth } from "../../../pi/tui.ts";
import { MERMAID_LIMITS } from "./limits.ts";
import type { MermaidArt, MermaidRole, MermaidSpan } from "./types.ts";

interface Node { id: string; label: string }
interface Edge { from: number; to: number }
interface Graph { direction: "TD" | "LR"; nodes: Node[]; edges: Edge[] }
interface Placed { x: number; y: number; w: number; h: number; cx: number; cy: number; rank: number }

const EDGE_RE = /^\s*([A-Za-z0-9_.:-]+(?:\s*[\[(\{][^\]\)\}]*[\]\)\}])?)\s*(?:--\s*([^>-]+?)\s*)?(-->|==>|-.->)\s*([A-Za-z0-9_.:-]+(?:\s*[\[(\{][^\]\)\}]*[\]\)\}])?)\s*$/;
const NODE_RE = /^\s*([A-Za-z0-9_.:-]+)(?:\s*[\[(\{]([^\]\)\}]*)[\]\)\}])?\s*$/;
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function graphemes(text: string): string[] {
  return Array.from(GRAPHEME_SEGMENTER.segment(text), (part) => part.segment);
}

function sourceLines(source: string): string[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function escapeTerminalControls(text: string): string {
  let escaped = "";
  for (const codepoint of text) {
    const code = codepoint.codePointAt(0)!;
    if (codepoint === "\t") escaped += "\\t";
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) escaped += `\\x${code.toString(16).padStart(2, "0")}`;
    else escaped += codepoint;
  }
  return escaped;
}

function parseNode(text: string, graph: Graph, index: Map<string, number>): number | null {
  const match = NODE_RE.exec(text);
  if (!match) return null;
  const id = match[1]!;
  const label = (match[2] ?? id).trim().replace(/^['"]|['"]$/g, "");
  const existing = index.get(id);
  if (existing !== undefined) {
    if (match[2] !== undefined) graph.nodes[existing]!.label = label;
    return existing;
  }
  if (graph.nodes.length >= MERMAID_LIMITS.maxNodes) return null;
  const next = graph.nodes.length;
  graph.nodes.push({ id, label });
  index.set(id, next);
  return next;
}

function parse(source: string): Graph | null {
  if (source.length > MERMAID_LIMITS.maxSourceChars) return null;
  const statements = sourceLines(source)
    .flatMap((line) => line.split(";"))
    .map((line) => line.trim())
    .filter(Boolean);
  const header = /^(?:flowchart|graph)\s+(TD|TB|LR)\b/i.exec(statements.shift() ?? "");
  if (!header) return null;
  const graph: Graph = { direction: header[1]!.toUpperCase() === "LR" ? "LR" : "TD", nodes: [], edges: [] };
  const index = new Map<string, number>();
  for (const statement of statements) {
    if (/^(?:classDef|class|style|linkStyle|click)\b/i.test(statement)) return null;
    const edge = EDGE_RE.exec(statement);
    if (edge) {
      const from = parseNode(edge[1]!, graph, index);
      const to = parseNode(edge[4]!, graph, index);
      if (from === null || to === null || graph.edges.length >= MERMAID_LIMITS.maxEdges) return null;
      const label = (edge[2] ?? "").trim();
      if (label) return null;
      graph.edges.push({ from, to });
      continue;
    }
    if (parseNode(statement, graph, index) === null) return null;
  }
  return graph.nodes.length > 0 ? graph : null;
}

function computeRanks(graph: Graph): number[] {
  const children = graph.nodes.map(() => [] as number[]);
  const indegree = graph.nodes.map(() => 0);
  for (const edge of graph.edges) {
    if (edge.from === edge.to) continue;
    children[edge.from]!.push(edge.to);
    indegree[edge.to]!++;
  }
  const color = graph.nodes.map(() => 0);
  const dag = graph.nodes.map(() => [] as number[]);
  const order: number[] = [];
  const visit = (start: number): void => {
    const stack: Array<[number, number]> = [[start, 0]];
    color[start] = 1;
    while (stack.length) {
      const frame = stack.at(-1)!;
      const child = children[frame[0]]![frame[1]];
      if (child !== undefined) {
        frame[1]++;
        if (color[child] === 1) continue;
        dag[frame[0]]!.push(child);
        if (color[child] === 0) {
          color[child] = 1;
          stack.push([child, 0]);
        }
      } else {
        color[frame[0]] = 2;
        order.push(frame[0]);
        stack.pop();
      }
    }
  };
  for (let i = 0; i < graph.nodes.length; i++) if (indegree[i] === 0 && color[i] === 0) visit(i);
  for (let i = 0; i < graph.nodes.length; i++) if (color[i] === 0) visit(i);
  const ranks = graph.nodes.map(() => 0);
  for (let i = order.length - 1; i >= 0; i--) {
    const from = order[i]!;
    for (const to of dag[from]!) ranks[to] = Math.max(ranks[to]!, ranks[from]! + 1);
  }
  return ranks;
}

function forwardNeighbors(graph: Graph, ranks: number[]): { parents: number[][]; children: number[][] } {
  const parents = graph.nodes.map(() => [] as number[]);
  const children = graph.nodes.map(() => [] as number[]);
  for (const edge of graph.edges) {
    if (edge.from !== edge.to && ranks[edge.to]! > ranks[edge.from]!) {
      parents[edge.to]!.push(edge.from);
      children[edge.from]!.push(edge.to);
    }
  }
  return { parents, children };
}

function orderRanks(rows: number[][], graph: Graph, ranks: number[]): void {
  const { parents, children } = forwardNeighbors(graph, ranks);
  const pos = graph.nodes.map(() => 0);
  const remember = (row: number[]) => row.forEach((node, i) => { pos[node] = i; });
  rows.forEach(remember);
  for (let sweep = 0; sweep < MERMAID_LIMITS.barycenterSweeps; sweep++) {
    const indices = sweep % 2 === 0
      ? Array.from({ length: rows.length - 1 }, (_, i) => i + 1)
      : Array.from({ length: rows.length - 1 }, (_, i) => rows.length - 2 - i);
    for (const rank of indices) {
      const neighbors = sweep % 2 === 0 ? parents : children;
      rows[rank] = rows[rank]!.map((node, prior) => ({
        node,
        prior,
        barycenter: neighbors[node]!.length
          ? neighbors[node]!.reduce((sum, other) => sum + pos[other]!, 0) / neighbors[node]!.length
          : pos[node]!,
      })).sort((a, b) => a.barycenter - b.barycenter || a.prior - b.prior).map((item) => item.node);
      remember(rows[rank]!);
    }
  }
}

function truncate(text: string, width: number): string {
  if (visibleWidth(text) <= width) return text;
  let out = "";
  for (const cluster of graphemes(text)) {
    if (visibleWidth(out + cluster + "…") > width) break;
    out += cluster;
  }
  return `${out}…`;
}

function nodeWidth(node: Node): number {
  return Math.max(5, visibleWidth(truncate(node.label, MERMAID_LIMITS.maxLabelWidth)) + 2);
}

function assignPositions(rows: number[][], sizes: number[], graph: Graph, ranks: number[]): number[] {
  const { parents, children } = forwardNeighbors(graph, ranks);
  const positions = graph.nodes.map(() => 0);
  for (const row of rows) {
    let cursor = 0;
    for (const node of row) {
      positions[node] = cursor + sizes[node]! / 2;
      cursor += sizes[node]! + MERMAID_LIMITS.nodeGap;
    }
  }
  for (let sweep = 0; sweep < MERMAID_LIMITS.coordinateSweeps; sweep++) {
    const orderedRows = sweep % 2 === 0 ? rows : [...rows].reverse();
    const neighbors = sweep % 2 === 0 ? parents : children;
    for (const row of orderedRows) {
      const desired = row.map((node) => neighbors[node]!.length
        ? neighbors[node]!.reduce((sum, other) => sum + positions[other]!, 0) / neighbors[node]!.length
        : positions[node]!);
      for (let i = 1; i < row.length; i++) {
        const minimum = desired[i - 1]! + sizes[row[i - 1]!]! / 2 + MERMAID_LIMITS.nodeGap + sizes[row[i]!]! / 2;
        desired[i] = Math.max(desired[i]!, minimum);
      }
      row.forEach((node, i) => { positions[node] = desired[i]!; });
    }
  }
  const minLeft = Math.min(...positions.map((position, node) => position - sizes[node]! / 2));
  return positions.map((position) => Math.max(0, Math.round(position - minLeft)));
}

function place(graph: Graph, ranks: number[]): { placed: Placed[]; width: number; height: number } {
  const maxRank = Math.max(...ranks);
  const rows = Array.from({ length: maxRank + 1 }, () => [] as number[]);
  ranks.forEach((rank, node) => rows[rank]!.push(node));
  orderRanks(rows, graph, ranks);
  const widths = graph.nodes.map(nodeWidth);
  const centers = assignPositions(rows, graph.direction === "TD" ? widths : graph.nodes.map(() => 3), graph, ranks);
  const placed = graph.nodes.map(() => ({ x: 0, y: 0, w: 0, h: 3, cx: 0, cy: 0, rank: 0 }));
  if (graph.direction === "LR") {
    const columnWidths = rows.map((row) => Math.max(...row.map((node) => widths[node]!), 1));
    const columnX: number[] = [];
    let x = 0;
    for (let rank = 0; rank < rows.length; rank++) {
      columnX[rank] = x;
      x += columnWidths[rank]! + MERMAID_LIMITS.rankGap;
    }
    const canvasHeight = Math.max(...centers.map((center) => center + 2), 3);
    rows.forEach((row, rank) => {
      for (const node of row) {
        const w = widths[node]!;
        const px = columnX[rank]! + Math.floor((columnWidths[rank]! - w) / 2);
        const y = Math.floor(centers[node]! - 1.5);
        placed[node] = { x: px, y, w, h: 3, cx: px + Math.floor(w / 2), cy: y + 1, rank };
      }
    });
    return {
      placed,
      width: Math.max(...placed.map((p) => p.x + p.w)),
      height: Math.max(...placed.map((p) => p.y + p.h)),
    };
  }
  rows.forEach((row, rank) => {
    for (const node of row) {
      const w = widths[node]!;
      const primary = rank * (3 + MERMAID_LIMITS.rankGap);
      const cursor = Math.floor(centers[node]! - w / 2);
      placed[node] = { x: cursor, y: primary, w, h: 3, cx: cursor + Math.floor(w / 2), cy: primary + 1, rank };
    }
  });
  const width = Math.max(...placed.map((p) => p.x + p.w));
  const height = Math.max(...placed.map((p) => p.y + p.h));
  return { placed, width, height };
}

interface Cell { char: string; role: MermaidRole; mask: number }
const U = 1, R = 2, D = 4, L = 8;
const MASK_CHARS: Record<number, string> = { 0: " ", 1: "│", 2: "─", 3: "└", 4: "│", 5: "│", 6: "┌", 7: "├", 8: "─", 9: "┘", 10: "─", 11: "┴", 12: "┐", 13: "┤", 14: "┬", 15: "┼" };

function draw(graph: Graph, placed: Placed[], width: number, height: number): MermaidArt | null {
  if (width * height > MERMAID_LIMITS.maxCanvasCells) return null;
  const cells: Cell[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => ({ char: " ", role: "plain", mask: 0 })));
  const set = (x: number, y: number, char: string, role: MermaidRole) => {
    if (x >= 0 && y >= 0 && y < height && x < width) cells[y]![x] = { char, role, mask: 0 };
  };
  const text = (x: number, y: number, value: string, role: MermaidRole) => {
    let cursor = x;
    for (const cluster of graphemes(value)) {
      const columns = visibleWidth(cluster);
      if (columns === 0) continue;
      set(cursor, y, cluster, role);
      for (let continuation = 1; continuation < columns; continuation++) set(cursor + continuation, y, "", role);
      cursor += columns;
    }
  };
  const bits = (x: number, y: number, mask: number) => {
    if (x < 0 || y < 0 || y >= height || x >= width) return;
    const cell = cells[y]![x]!;
    if (cell.role === "border" || cell.role === "nodeText") return;
    cell.role = "edge";
    cell.mask |= mask;
    cell.char = MASK_CHARS[cell.mask] ?? "┼";
  };
  const hline = (y: number, a: number, b: number) => {
    const [left, right] = a <= b ? [a, b] : [b, a];
    for (let x = left; x <= right; x++) bits(x, y, (x > left ? L : 0) | (x < right ? R : 0));
  };
  const vline = (x: number, a: number, b: number) => {
    const [top, bottom] = a <= b ? [a, b] : [b, a];
    for (let y = top; y <= bottom; y++) bits(x, y, (y > top ? U : 0) | (y < bottom ? D : 0));
  };

  // Greedy track assignment keeps overlapping spans on distinct rows/columns.
  const tracks = new Map<number, Array<[number, number]>>();
  graph.edges.forEach((edge) => {
    const from = placed[edge.from]!, to = placed[edge.to]!;
    const rank = from.rank;
    const start = graph.direction === "TD" ? from.cx : from.cy;
    const end = graph.direction === "TD" ? to.cx : to.cy;
    const span: [number, number] = [Math.min(start, end), Math.max(start, end)];
    const occupied = tracks.get(rank) ?? [];
    let slot = 0;
    while (occupied.some(([a, b], i) => i === slot && !(b + 2 <= span[0] || span[1] + 2 <= a))) slot++;
    occupied[slot] = span;
    tracks.set(rank, occupied);
    if (graph.direction === "TD") {
      const y1 = from.y + from.h, y2 = to.y - 1;
      const bus = Math.min(y2, y1 + slot);
      vline(from.cx, y1, bus); hline(bus, from.cx, to.cx); vline(to.cx, bus, y2);
      bits(from.cx, y1, U);
      set(to.cx, y2, "▼", "edge");
    } else {
      const x1 = from.x + from.w, x2 = to.x - 1;
      const bus = Math.min(x2, x1 + slot);
      hline(from.cy, x1, bus); vline(bus, from.cy, to.cy); hline(to.cy, bus, x2);
      bits(x1, from.cy, L);
      set(x2, to.cy, "▶", "edge");
    }
  });

  graph.nodes.forEach((node, index) => {
    const p = placed[index]!;
    for (let x = p.x + 1; x < p.x + p.w - 1; x++) { set(x, p.y, "─", "border"); set(x, p.y + p.h - 1, "─", "border"); }
    for (let y = p.y + 1; y < p.y + p.h - 1; y++) { set(p.x, y, "│", "border"); set(p.x + p.w - 1, y, "│", "border"); }
    set(p.x, p.y, "┌", "border"); set(p.x + p.w - 1, p.y, "┐", "border");
    set(p.x, p.y + p.h - 1, "└", "border"); set(p.x + p.w - 1, p.y + p.h - 1, "┘", "border");
    const label = truncate(node.label, Math.max(1, p.w - 2));
    text(p.x + Math.floor((p.w - visibleWidth(label)) / 2), p.y + 1, label, "nodeText");
  });
  return artFromCells(cells);
}

function artFromCells(cells: Cell[][]): MermaidArt {
  const plainLines = cells.map((row) => row.map((cell) => cell.char).join("").trimEnd());
  const lines = cells.map((row, y) => {
    const spans: MermaidSpan[] = [];
    let x = 0;
    while (x < row.length) {
      const cell = row[x]!;
      const text = cell.char;
      const prior = spans.at(-1);
      if (prior?.role === cell.role) prior.text += text;
      else spans.push({ text, role: cell.role });
      x++;
    }
    // Keep semantic and plain representations byte-identical.
    const plain = plainLines[y]!;
    let joined = spans.map((span) => span.text).join("").trimEnd();
    if (joined !== plain) return [{ text: plain, role: "plain" as const }];
    while (spans.at(-1)?.text.endsWith(" ")) spans.at(-1)!.text = spans.at(-1)!.text.trimEnd();
    return spans.filter((span) => span.text.length > 0);
  });
  return { lines, plainLines, fallback: false };
}

function chunk(text: string, width: number): string[] {
  if (visibleWidth(text) <= width) return [text];
  const out: string[] = [];
  let current = "";
  for (const cluster of graphemes(text)) {
    if (visibleWidth(cluster) > width) {
      if (current) { out.push(current); current = ""; }
      const escaped = Array.from(cluster, (codepoint) => `\\u{${codepoint.codePointAt(0)!.toString(16)}}`).join("");
      out.push(...escaped.match(new RegExp(`.{1,${width}}`, "g"))!);
      continue;
    }
    if (current && visibleWidth(current + cluster) > width) { out.push(current); current = ""; }
    current += cluster;
  }
  if (current || out.length === 0) out.push(current);
  return out;
}

function boundedFallbackSource(source: string): string {
  if (source.length <= MERMAID_LIMITS.maxFallbackSourceChars) return source;

  const sliced = source.slice(0, MERMAID_LIMITS.maxFallbackSourceChars);
  const head = /[\uD800-\uDBFF]$/.test(sliced) ? sliced.slice(0, -1) : sliced;
  return `${head}\n… [${source.length - head.length} source chars omitted]`;
}

function fallback(source: string, width: number, reason: MermaidArt["fallbackReason"]): MermaidArt {
  const boundedSource = boundedFallbackSource(source);
  if (width < 8) {
    const plainLines = sourceLines(boundedSource).flatMap((line) => chunk(escapeTerminalControls(line), Math.max(1, width)));
    return {
      lines: plainLines.map((line) => [{ text: line, role: "source" }]),
      plainLines,
      fallback: true,
      fallbackReason: reason,
    };
  }
  const safeWidth = width;
  const bodyWidth = Math.max(1, safeWidth - 4);
  const body = sourceLines(boundedSource).flatMap((line) => chunk(escapeTerminalControls(line), bodyWidth));
  const title = truncate(" mermaid ", Math.max(1, safeWidth - 2));
  const top = `┌${title}${"─".repeat(Math.max(0, safeWidth - 2 - visibleWidth(title)))}┐`;
  const plainLines = [top, ...body.map((line) => `│ ${line}${" ".repeat(Math.max(0, bodyWidth - visibleWidth(line)))} │`), `└${"─".repeat(safeWidth - 2)}┘`];
  const lines = plainLines.map((line, index) => index === 0
    ? [{ text: line, role: "title" as const }]
    : index === plainLines.length - 1
      ? [{ text: line, role: "border" as const }]
      : [{ text: "│ ", role: "border" as const }, { text: line.slice(2, -2), role: "source" as const }, { text: " │", role: "border" as const }]);
  return { lines, plainLines, fallback: true, fallbackReason: reason };
}

export function renderMermaid(source: string, width: number): MermaidArt {
  const normalizedWidth = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
  if (/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(source)) {
    return fallback(source, normalizedWidth, "invalid");
  }
  const graph = parse(source);
  if (!graph) return fallback(source, normalizedWidth, /^\s*(?:flowchart|graph)\b/i.test(source) ? "invalid" : "unsupported");
  if (graph.nodes.some((node) => graphemes(node.label).some((cluster) => visibleWidth(cluster) === 0))) {
    return fallback(source, normalizedWidth, "invalid");
  }
  const ranks = computeRanks(graph);
  if (graph.edges.some((edge) => edge.from === edge.to || ranks[edge.to]! <= ranks[edge.from]!)) {
    return fallback(source, normalizedWidth, "invalid");
  }
  const layout = place(graph, ranks);
  if (layout.width > normalizedWidth) return fallback(source, normalizedWidth, "too-wide");
  const art = draw(graph, layout.placed, layout.width, layout.height);
  return art ?? fallback(source, normalizedWidth, "oversize");
}
