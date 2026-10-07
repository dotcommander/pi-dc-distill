import { describe, expect, test } from "bun:test";
import {
  buildTypeSignatures,
  emptyTypeSignatures,
  extractSignatures,
  type SignatureObservation,
} from "./type-signatures.ts";

describe("extractSignatures language table", () => {
  test("TypeScript/JavaScript exported declarations are included", () => {
    const text = [
      "export function alpha(): void {}",
      "export async function beta() {}",
      "export class Gamma {}",
      "export abstract class Delta {}",
      "export interface Epsilon {}",
      "export type Zeta = string;",
      "export enum Eta {}",
      "export const Theta = 1;",
      "export let Iota = 2;",
      "export var Kappa = 3;",
      "export declare function Lambda(): number;",
    ].join("\n");
    const signatures = extractSignatures("src/mod.ts", text);
    expect(signatures.length).toBe(11);
    expect(signatures[0]).toBe("export function alpha(): void {}");
    expect(signatures[10]).toBe("export declare function Lambda(): number;");
  });

  test("non-exported and keyword-prefix lookalikes are excluded", () => {
    const text = [
      "function localOnly() {}",
      "const notExported = 1;",
      "export constx = 2;",
      "exportedThing = 3;",
      "// export function commented() {}",
    ].join("\n");
    expect(extractSignatures("src/mod.ts", text)).toEqual([]);
  });

  test("all TS/JS extensions map to the same table", () => {
    const text = "export const value = 1;";
    for (const path of ["a.ts", "a.tsx", "a.mts", "a.cts", "a.js", "a.jsx", "a.mjs", "a.cjs"]) {
      expect(extractSignatures(path, text).length).toBe(1);
    }
  });

  test("Python class and def declarations are included", () => {
    const text = [
      "class Widget:",
      "    def shape(self) -> str:",
      "async def handler(request):",
      "def top_level(x: int) -> int:",
      "definition = 5",
      "default: int = 3",
    ].join("\n");
    const signatures = extractSignatures("pkg/mod.py", text);
    expect(signatures).toEqual([
      "class Widget:…",
      "def shape(self) -> str:…",
      "async def handler(request):…",
      "def top_level(x: int) -> int:…",
    ]);
  });

  test("Go exported declarations are included, unexported excluded", () => {
    const text = [
      "func Exported() {}",
      "func (s *Server) Handle() error {",
      "type Config struct {",
      "func unexported() {}",
      "func (s *server) handle() {}",
      "type unexported struct {",
      "functionNotGo() {}",
    ].join("\n");
    expect(extractSignatures("pkg/server.go", text)).toEqual([
      "func Exported() {}",
      "func (s *Server) Handle() error {",
      "type Config struct {",
    ]);
  });

  test("Rust pub declarations are included, non-pub excluded", () => {
    const text = [
      "pub fn run() {}",
      "pub async fn fetch() {}",
      "pub struct Config;",
      "pub enum Mode {",
      "pub trait Store {}",
      "pub type Id = u32;",
      "pub const MAX: usize = 1;",
      "pub static NAME: &str = \"x\";",
      "fn private() {}",
      "struct Private;",
    ].join("\n");
    expect(extractSignatures("src/lib.rs", text).length).toBe(8);
  });

  test("unsupported extensions and extensionless paths extract nothing", () => {
    const text = "export const value = 1;\ndef f():\n";
    for (const path of ["notes.md", "data.json", "style.css", "Makefile", "a."]) {
      expect(extractSignatures(path, text)).toEqual([]);
    }
  });

  test("extension matching is case-insensitive", () => {
    expect(extractSignatures("MOD.TS", "export const value = 1;").length).toBe(1);
  });
});

describe("extractSignatures line shaping", () => {
  test("continuation endings are cut with an ellipsis", () => {
    expect(extractSignatures("a.ts", "export function open(")[0]).toBe("export function open(…");
    expect(extractSignatures("a.ts", "export function pair<")[0]).toBe("export function pair<…");
    expect(extractSignatures("a.py", "def widget():")[0]).toBe("def widget():…");
    expect(extractSignatures("a.go", "func Exported()[")[0]).toBe("func Exported()[…");
  });

  test("open brace is not a continuation cut", () => {
    expect(extractSignatures("a.ts", "export function kept(){}")[0]).toBe("export function kept(){}");
  });

  test("Unicode identifiers are recognized", () => {
    expect(extractSignatures("a.ts", "export function über() {}")[0]).toBe("export function über() {}");
    expect(extractSignatures("a.py", "def über():")[0]).toBe("def über():…");
  });

  test("items over 512 code points truncate on complete code points", () => {
    const emoji = "🎉".repeat(600); // surrogate pairs: 1200 UTF-16 units, 600 code points
    const line = `export const big = "${emoji}";`;
    const [signature] = extractSignatures("a.ts", line);
    expect(signature.length).toBeGreaterThan(0);
    const counted = Array.from(signature).length;
    expect(counted).toBe(512);
    // No lone surrogate at the boundary: the sliced string re-encodes cleanly.
    expect(signature).toBe(Array.from(signature).join(""));
  });

  test("exactly 512 code points are preserved untouched", () => {
    const line = `export const exact = "${"x".repeat(488)}";`;
    const [signature] = extractSignatures("a.ts", line);
    expect(Array.from(signature).length).toBe(512);
    expect(signature).toBe(line);
  });
});

describe("buildTypeSignatures catalog", () => {
  const file = (body: string) => body;

  test("latest observation per path wins and empty extractions are skipped", () => {
    const observations: SignatureObservation[] = [
      { path: "a.ts", text: file("export const old = 1;"), seq: 1, kind: "read" },
      { path: "a.ts", text: file("export const fresh = 2;\nexport const more = 3;"), seq: 5, kind: "read" },
      { path: "data.json", text: file('{"no":"signatures"}'), seq: 6, kind: "read" },
    ];
    const catalog = buildTypeSignatures(observations, [], null);
    expect(catalog.entries).toEqual([
      { path: "a.ts", signatures: ["export const fresh = 2;", "export const more = 3;"] },
    ]);
    expect(catalog.omittedFiles).toBe(0);
    expect(catalog.omittedSignatures).toBe(0);
  });

  test("modified-class first, then read-class, most recent first, ties lexical", () => {
    const observations: SignatureObservation[] = [
      { path: "read-a.ts", text: "export const a = 1;", seq: 1, kind: "read" },
      { path: "mod-a.ts", text: "export const a = 1;", seq: 2, kind: "modified" },
      { path: "read-b.ts", text: "export const b = 1;", seq: 4, kind: "read" },
      { path: "mod-b.ts", text: "export const b = 1;", seq: 3, kind: "modified" },
      { path: "read-c.ts", text: "export const c = 1;", seq: 4, kind: "read" },
    ];
    const catalog = buildTypeSignatures(observations, [], null);
    expect(catalog.entries.map((entry) => entry.path)).toEqual([
      "mod-b.ts", "mod-a.ts", "read-b.ts", "read-c.ts", "read-a.ts",
    ]);
  });

  test("per-file cap 8 drops complete signatures with accounting", () => {
    const text = Array.from({ length: 10 }, (_, i) => `export const v${i} = ${i};`).join("\n");
    const catalog = buildTypeSignatures([{ path: "a.ts", text, seq: 1, kind: "read" }], [], null);
    expect(catalog.entries[0].signatures.length).toBe(8);
    expect(catalog.omittedSignatures).toBe(2);
  });

  test("duplicate signature lines collapse within a file", () => {
    const text = ["export const same = 1;", "export const same = 1;", "export const other = 2;"].join("\n");
    const catalog = buildTypeSignatures([{ path: "a.ts", text, seq: 1, kind: "read" }], [], null);
    expect(catalog.entries[0].signatures).toEqual(["export const same = 1;", "export const other = 2;"]);
    expect(catalog.omittedSignatures).toBe(0);
  });

  test("catalog cap 12 keeps modified-class first and counts dropped files", () => {
    const observations: SignatureObservation[] = [];
    for (let i = 0; i < 5; i++) observations.push({ path: `m${i}.ts`, text: "export const m = 1;", seq: i + 1, kind: "modified" });
    for (let i = 0; i < 10; i++) observations.push({ path: `r${i}.ts`, text: "export const r = 1;", seq: i + 1, kind: "read" });
    const catalog = buildTypeSignatures(observations, [], null);
    expect(catalog.entries.length).toBe(12);
    expect(catalog.omittedFiles).toBe(3);
    // All five modified files survive; the oldest two read files drop.
    expect(catalog.entries.slice(0, 5).map((entry) => entry.path)).toEqual(["m4.ts", "m3.ts", "m2.ts", "m1.ts", "m0.ts"]);
    expect(catalog.entries.slice(5).map((entry) => entry.path)).toEqual(["r9.ts", "r8.ts", "r7.ts", "r6.ts", "r5.ts", "r4.ts", "r3.ts"]);
  });

  test("carried prior entries survive only on frontier paths without fresh observation", () => {
    const priorMarker = [
      "signatures: extracted from successful paired tool results; may be stale if a file changed outside observation",
      "- kept.ts: export function kept(): void",
      "- replaced.ts: export function stale(): void",
      "- left.ts: export function gone(): void",
      "- escaped.ts: export function pair&lt;T&gt;(x: T): T",
      "omitted: 1 file",
    ].join("\n");
    const observations: SignatureObservation[] = [
      { path: "replaced.ts", text: "export function fresh(): void", seq: 2, kind: "read" },
    ];
    const catalog = buildTypeSignatures(observations, ["kept.ts", "replaced.ts", "escaped.ts"], priorMarker);
    // Fresh replaces carried; left.ts dropped (not in frontier); carried rank last.
    expect(catalog.entries).toEqual([
      { path: "replaced.ts", signatures: ["export function fresh(): void"] },
      { path: "escaped.ts", signatures: ["export function pair<T>(x: T): T"] },
      { path: "kept.ts", signatures: ["export function kept(): void"] },
    ]);
  });

  test("fresh zero-signature observation suppresses carried entries for that path", () => {
    const priorMarker = "- gone.json: export const wasHere = 1;";
    const observations: SignatureObservation[] = [
      { path: "gone.json", text: '{"now":"json"}', seq: 1, kind: "read" },
    ];
    expect(buildTypeSignatures(observations, ["gone.json"], priorMarker).entries).toEqual([]);
  });

  test("identical inputs build identical catalogs", () => {
    const observations: SignatureObservation[] = [
      { path: "a.ts", text: "export const a = 1;", seq: 1, kind: "modified" },
      { path: "b.py", text: "def b():", seq: 2, kind: "read" },
    ];
    const first = buildTypeSignatures(observations, [], null);
    const second = buildTypeSignatures(observations, [], null);
    expect(first).toEqual(second);
  });

  test("empty inputs yield the empty catalog", () => {
    expect(buildTypeSignatures([], [], null)).toEqual(emptyTypeSignatures());
  });
});
