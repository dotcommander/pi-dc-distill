import { describe, test, expect } from "bun:test";
import {
  tokenize,
  tokenizeUnicode,
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

  test("ASCII tokenizer drops CJK text entirely (motivating limitation)", () => {
    expect(tokenize("数据库")).toEqual([]);
    expect(tokenize("修复 fix")).toEqual(["fix"]);
  });
});

describe("Unicode search tokenization (tokenizeUnicode)", () => {
  test("indexes Han characters as unigram terms and keeps the whole run", () => {
    const tokens = tokenizeUnicode("数据库");
    expect(tokens).toContain("数据库");
    expect(tokens).toContain("数");
    expect(tokens).toContain("据");
    expect(tokens).toContain("库");
  });

  test("keeps ASCII output byte-identical to tokenize", () => {
    const text = "getAuthToken auth_token lib/recall.ts deploy --force 123";
    expect(tokenizeUnicode(text)).toEqual(tokenize(text));
    expect(tokenizeUnicode("")).toEqual([]);
  });

  test("indexes non-Han non-ASCII scripts as whole letter runs", () => {
    const tokens = tokenizeUnicode("よろしく 안녕 Привет");
    expect(tokens).toContain("よろしく");
    expect(tokens).toContain("안녕");
    expect(tokens).toContain("привет");
  });

  test("adds Han unigrams inside fused Latin-CJK runs", () => {
    const tokens = tokenizeUnicode("read数据库");
    expect(tokens).toContain("read数据库");
    expect(tokens).toContain("数");
    expect(tokens).toContain("据");
    expect(tokens).toContain("库");
    expect(tokens).toContain("read");
  });

  test("does not index CJK punctuation", () => {
    expect(tokenizeUnicode("，。！？")).toEqual([]);
  });

  test("Han term frequency follows character occurrences", () => {
    const tokens = tokenizeUnicode("数据 数据");
    expect(tokens.filter((t) => t === "数").length).toBe(2);
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

  test("ranks Chinese query against Chinese document content", () => {
    const docs = [
      { id: "en", text: "fixed cache invalidation bug" },
      { id: "zh", text: "修复了数据库连接错误" },
    ];
    const results = bm25Rank(docs, (d) => d.text, "数据库");
    expect(results).toHaveLength(1);
    expect(results[0].doc.id).toBe("zh");
    expect(results[0].score).toBeGreaterThan(0);
  });

  test("Chinese substring query matches via Han unigrams where whole runs cannot", () => {
    // Run tokens alone would miss: run 数据库 vs run 数据丢失风险 share no whole run.
    const docs = [
      { id: "risk", text: "数据丢失风险 needs review" },
      { id: "other", text: "unrelated migration notes" },
    ];
    const results = bm25Rank(docs, (d) => d.text, "数据");
    expect(results).toHaveLength(1);
    expect(results[0].doc.id).toBe("risk");
  });

  test("mixed Chinese-English query ranks on both scripts' terms", () => {
    const docs = [
      { id: "1", text: "cache layer tuning notes" },
      { id: "2", text: "缓存 cache 层调优记录" },
    ];
    const results = bm25Rank(docs, (d) => d.text, "cache 缓存");
    // Doc 2 matches both scripts' terms and outranks doc 1's single ASCII match.
    expect(results[0].doc.id).toBe("2");
    expect(results[0].score).toBeGreaterThan(results[1]!.score);
    expect(results[1].doc.id).toBe("1");
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
