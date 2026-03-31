import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryEngine } from "../../src/memory/engine.js";
import { imprintConfigSchema } from "../../src/config.js";
import type { EmbeddingService } from "../../src/memory/embeddings.js";
import { searchBM25, buildFtsQuery, rankToScore } from "../../src/retrieval/bm25.js";
import { reciprocalRankFusion } from "../../src/retrieval/ranker.js";

// Deterministic mock embeddings - similar texts get similar vectors
class MockEmbeddingService implements EmbeddingService {
  private dim = 384;

  embed(text: string): Promise<Float32Array> {
    const arr = new Float32Array(this.dim);
    const words = text.toLowerCase().split(/\s+/);
    for (let i = 0; i < this.dim; i++) {
      let val = 0;
      for (const word of words) {
        val += Math.sin(word.charCodeAt(i % word.length) * (i + 1) * 0.1);
      }
      arr[i] = val / words.length;
    }
    let norm = 0;
    for (let i = 0; i < this.dim; i++) norm += arr[i] * arr[i];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < this.dim; i++) arr[i] /= norm;
    return Promise.resolve(arr);
  }

  embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  dimensions(): number {
    return this.dim;
  }

  isReady(): boolean {
    return true;
  }
}

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = resolve(import.meta.dirname, "../../src/db/schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  db.exec(schema);
  return db;
}

describe("BM25 Search", () => {
  let db: Database.Database;
  let engine: MemoryEngine;

  beforeEach(async () => {
    db = createTestDb();
    const config = imprintConfigSchema.parse({});
    engine = new MemoryEngine(db, new MockEmbeddingService(), config);

    // Seed test data
    await engine.encode({ content: "TypeScript is a typed superset of JavaScript", layer: "semantic" });
    await engine.encode({ content: "Python is great for data science and machine learning", layer: "semantic" });
    await engine.encode({ content: "SQLite uses a B-tree for indexing data on disk", layer: "semantic" });
    await engine.encode({ content: "Redis provides in-memory key-value storage", layer: "semantic" });
    await engine.encode({ content: "The user prefers dark mode in all applications", layer: "project" });
  });

  it("finds relevant results by keyword", () => {
    const results = searchBM25(db, {
      query: "TypeScript JavaScript",
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("filters by layer", () => {
    const results = searchBM25(db, {
      query: "user prefers",
      limit: 5,
      layerFilter: ["project"],
    });

    expect(results.length).toBe(1);
  });

  it("returns empty for no matches", () => {
    const results = searchBM25(db, {
      query: "quantum computing blockchain",
      limit: 5,
    });

    expect(results.length).toBe(0);
  });
});

describe("buildFtsQuery", () => {
  it("tokenizes and quotes terms", () => {
    expect(buildFtsQuery("hello world")).toBe('"hello" OR "world"');
  });

  it("returns null for empty input", () => {
    expect(buildFtsQuery("")).toBeNull();
    expect(buildFtsQuery("   ")).toBeNull();
  });

  it("handles special characters", () => {
    expect(buildFtsQuery('test "quoted" value')).toBe('"test" OR "quoted" OR "value"');
  });
});

describe("rankToScore", () => {
  it("converts negative rank to positive score", () => {
    expect(rankToScore(-5)).toBeCloseTo(5 / 6, 3);
    expect(rankToScore(-1)).toBeCloseTo(0.5, 3);
  });

  it("handles zero and positive ranks", () => {
    expect(rankToScore(0)).toBeCloseTo(1, 3);
    expect(rankToScore(1)).toBeCloseTo(0.5, 3);
  });

  it("handles non-finite values", () => {
    expect(rankToScore(Infinity)).toBeCloseTo(1 / 1000, 2);
    expect(rankToScore(NaN)).toBeCloseTo(1 / 1000, 2);
  });
});

describe("Reciprocal Rank Fusion", () => {
  it("merges results from two lists", () => {
    const vectorResults = [
      { id: "a", score: 0.9 },
      { id: "b", score: 0.8 },
      { id: "c", score: 0.7 },
    ];

    const bm25Results = [
      { id: "b", score: 0.95 },
      { id: "d", score: 0.85 },
      { id: "a", score: 0.6 },
    ];

    const fused = reciprocalRankFusion(vectorResults, bm25Results);

    // Items appearing in both lists should rank higher than single-list items
    const topTwo = fused.slice(0, 2).map((f) => f.id).sort();
    expect(topTwo).toEqual(["a", "b"]);

    // All items should be present
    const ids = fused.map((f) => f.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).toContain("c");
    expect(ids).toContain("d");
  });

  it("handles empty inputs", () => {
    expect(reciprocalRankFusion([], [])).toEqual([]);
    expect(reciprocalRankFusion([{ id: "a", score: 0.9 }], [])).toHaveLength(1);
  });

  it("normalizes scores to [0, 1]", () => {
    const result = reciprocalRankFusion(
      [{ id: "a", score: 0.9 }],
      [{ id: "a", score: 0.8 }],
    );

    expect(result[0].fusedScore).toBeLessThanOrEqual(1);
    expect(result[0].fusedScore).toBeGreaterThanOrEqual(0);
  });
});

describe("Full Recall Pipeline", () => {
  let engine: MemoryEngine;

  beforeEach(async () => {
    const db = createTestDb();
    const config = imprintConfigSchema.parse({});
    engine = new MemoryEngine(db, new MockEmbeddingService(), config);

    // Seed diverse memories
    await engine.encode({
      content: "The project uses PostgreSQL for production data storage",
      layer: "project",
      importance: 0.8,
    });
    await engine.encode({
      content: "Redis is used for caching session data",
      layer: "project",
      importance: 0.7,
    });
    await engine.encode({
      content: "The team decided to use TypeScript for all new code",
      layer: "semantic",
      importance: 0.9,
    });
    await engine.encode({
      content: "Deploy to staging every Monday at 9am",
      layer: "procedural",
      importance: 0.6,
    });
    await engine.encode({
      content: "User prefers concise responses without emojis",
      layer: "soul",
      importance: 0.95,
    });
  });

  it("recalls memories by semantic query", async () => {
    const results = await engine.recall({
      query: "what database does the project use",
      limit: 3,
    });

    expect(results.length).toBeGreaterThan(0);
    // BM25 should find "PostgreSQL" and "Redis" mentions
  });

  it("filters by layer", async () => {
    const results = await engine.recall({
      query: "project settings",
      layers: ["project"],
      limit: 10,
    });

    for (const r of results) {
      expect(r.record.layer).toBe("project");
    }
  });

  it("filters by minimum importance", async () => {
    const results = await engine.recall({
      query: "project code",
      minImportance: 0.8,
      limit: 10,
    });

    for (const r of results) {
      expect(r.record.importance).toBeGreaterThanOrEqual(0.8);
    }
  });

  it("returns scored results", async () => {
    const results = await engine.recall({
      query: "TypeScript",
      limit: 5,
    });

    if (results.length > 1) {
      // Results should be sorted by score descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    }
  });
});
