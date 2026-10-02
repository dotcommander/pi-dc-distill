import { describe, test, expect } from "bun:test";
import {
  tokenize,
  bm25Rank,
  computeBM25Score,
  type BM25Document,
} from "./bm25.ts";

describe("BM25 Tokenizer", () => {
  test("lowercases and splits on whitespace and punctuation", () => {
    const tokens = tokenize("Hello, World! This is a test.");
    expect(tokens).toContain("hello");
    expect(tokens).toContain("world");
    expect(tokens).toContain("test");
  });

  test("preserves and expands camelCase identifiers", () => {
    const tokens = tokenize("getAuthToken and parseJwtSignature");
    expect(tokens).toContain("getauthtoken");
    expect(tokens).toContain("auth");
    expect(tokens).toContain("token");
    expect(tokens).toContain("parsejwtsignature");
    expect(tokens).toContain("jwt");
    expect(tokens).toContain("signature");
  });

  test("preserves and expands snake_case and kebab-case identifiers", () => {
    const tokens = tokenize("auth_token and resume-index");
    expect(tokens).toContain("auth_token");
    expect(tokens).toContain("auth");
    expect(tokens).toContain("token");
    expect(tokens).toContain("resume-index");
    expect(tokens).toContain("resume");
    expect(tokens).toContain("index");
  });

  test("preserves file paths and extensions", () => {
    const tokens = tokenize("lib/recall.ts and /tmp/source/auth.md");
    expect(tokens).toContain("lib/recall.ts");
    expect(tokens).toContain("recall.ts");
    expect(tokens).toContain("auth.md");
    expect(tokens).toContain("recall");
    expect(tokens).toContain("auth");
  });

  test("returns empty array for empty or whitespace-only string", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   \n\t  ")).toEqual([]);
  });
});

describe("BM25 Scoring & Ranking", () => {
  test("guarantees non-negative scores using Lucene-style IDF", () => {
    // When a term appears in all documents, standard Okapi BM25 produces negative IDF.
    // Lucene BM25: ln(1 + (N - n + 0.5) / (n + 0.5)) >= 0 always.
    const docs = [
      { id: "1", text: "error in auth" },
      { id: "2", text: "error in network" },
    ];
    const results = bm25Rank(docs, (d) => d.text, "error");
    expect(results.length).toBe(2);
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[1].score).toBeGreaterThan(0);
  });

  test("ranks higher when query term is more frequent (term saturation)", () => {
    const docs = [
      { id: "1", text: "auth failure" },
      { id: "2", text: "auth auth auth failure" },
    ];
    const results = bm25Rank(docs, (d) => d.text, "auth");
    expect(results[0].doc.id).toBe("2");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  test("ranks shorter document higher when term frequency is identical (length normalization)", () => {
    const docs = [
      { id: "long", text: "this is a very long text with lots of words talking about auth and many other things" },
      { id: "short", text: "auth details" },
    ];
    const results = bm25Rank(docs, (d) => d.text, "auth");
    expect(results[0].doc.id).toBe("short");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  test("weights rarer terms higher (IDF)", () => {
    // "common" is in both docs; "unique" is only in doc 1
    const docs = [
      { id: "1", text: "common unique" },
      { id: "2", text: "common other" },
    ];
    // Querying "common unique" should rank doc 1 much higher because "unique" has higher IDF
    const results = bm25Rank(docs, (d) => d.text, "common unique");
    expect(results[0].doc.id).toBe("1");
  });

  test("multi-term query: doc matching all terms outranks doc matching single term", () => {
    const docs = [
      { id: "single", text: "user authentication verified" },
      { id: "both", text: "user authentication and token refresh verified" },
    ];
    const results = bm25Rank(docs, (d) => d.text, "authentication token");
    expect(results[0].doc.id).toBe("both");
  });

  test("exact phrase match gives a boost over scattered terms", () => {
    const docs = [
      { id: "scattered", text: "token is valid for auth" },
      { id: "exact", text: "auth token is valid" },
    ];
    const results = bm25Rank(docs, (d) => d.text, "auth token");
    expect(results[0].doc.id).toBe("exact");
  });

  test("returns empty array when query does not match any document", () => {
    const docs = [
      { id: "1", text: "database migration complete" },
    ];
    const results = bm25Rank(docs, (d) => d.text, "authentication");
    expect(results).toHaveLength(0);
  });

  test("deterministic tie-breaking preserves original order on equal scores", () => {
    const docs = [
      { id: "1", text: "deploy cluster" },
      { id: "2", text: "deploy cluster" },
    ];
    const results = bm25Rank(docs, (d) => d.text, "deploy");
    expect(results[0].doc.id).toBe("1");
    expect(results[1].doc.id).toBe("2");
  });
});
