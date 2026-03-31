import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryEngine } from "../../src/memory/engine.js";
import { imprintConfigSchema } from "../../src/config.js";
import type { EmbeddingService } from "../../src/memory/embeddings.js";

// Mock embedding service that returns deterministic embeddings
class MockEmbeddingService implements EmbeddingService {
  private dim = 384;

  embed(text: string): Promise<Float32Array> {
    // Simple hash-based embedding for deterministic tests
    const arr = new Float32Array(this.dim);
    for (let i = 0; i < this.dim; i++) {
      arr[i] = Math.sin(text.charCodeAt(i % text.length) * (i + 1));
    }
    // Normalize
    let norm = 0;
    for (let i = 0; i < this.dim; i++) norm += arr[i] * arr[i];
    norm = Math.sqrt(norm);
    for (let i = 0; i < this.dim; i++) arr[i] /= norm;
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

describe("MemoryEngine", () => {
  let db: Database.Database;
  let engine: MemoryEngine;

  beforeEach(() => {
    db = createTestDb();
    const config = imprintConfigSchema.parse({});
    engine = new MemoryEngine(db, new MockEmbeddingService(), config);
  });

  describe("encode", () => {
    it("stores a new memory", async () => {
      const record = await engine.encode({
        content: "Test memory content",
        layer: "semantic",
      });

      expect(record.id).toBeTruthy();
      expect(record.layer).toBe("semantic");
      expect(record.content).toBe("Test memory content");
      expect(record.agentId).toBe("default");
      expect(record.importance).toBe(0.6); // semantic default
    });

    it("deduplicates exact content", async () => {
      const r1 = await engine.encode({
        content: "Duplicate content",
        layer: "semantic",
      });
      const r2 = await engine.encode({
        content: "Duplicate content",
        layer: "semantic",
      });

      expect(r1.id).toBe(r2.id);
      expect(r2.accessCount).toBe(1); // incremented
    });

    it("validates empty content", async () => {
      await expect(
        engine.encode({ content: "", layer: "semantic" }),
      ).rejects.toThrow("Content must not be empty");
    });

    it("validates session layer requires sessionId", async () => {
      await expect(
        engine.encode({ content: "test", layer: "session" }),
      ).rejects.toThrow("requires a sessionId");
    });

    it("stores session memory with sessionId", async () => {
      const record = await engine.encode({
        content: "Session data",
        layer: "session",
        sessionId: "sess-123",
      });

      expect(record.sessionId).toBe("sess-123");
    });

    it("applies layer defaults for importance", async () => {
      const soul = await engine.encode({
        content: "I am helpful",
        layer: "soul",
      });
      expect(soul.importance).toBe(0.9);

      const project = await engine.encode({
        content: "Project context",
        layer: "project",
      });
      expect(project.importance).toBe(0.7);
    });
  });

  describe("getById", () => {
    it("retrieves a stored memory", async () => {
      const stored = await engine.encode({
        content: "Find me",
        layer: "episodic",
      });

      const found = engine.getById(stored.id);
      expect(found).not.toBeNull();
      expect(found!.content).toBe("Find me");
    });

    it("returns null for missing ID", () => {
      expect(engine.getById("nonexistent")).toBeNull();
    });
  });

  describe("getByLayer", () => {
    it("returns memories for a layer", async () => {
      await engine.encode({ content: "Soul 1", layer: "soul" });
      await engine.encode({ content: "Soul 2", layer: "soul" });
      await engine.encode({ content: "Project 1", layer: "project" });

      const souls = engine.getByLayer("soul");
      expect(souls).toHaveLength(2);

      const projects = engine.getByLayer("project");
      expect(projects).toHaveLength(1);
    });
  });

  describe("update", () => {
    it("updates content and importance", async () => {
      const record = await engine.encode({
        content: "Original",
        layer: "semantic",
      });

      const updated = await engine.update(record.id, {
        content: "Updated content",
        importance: 0.9,
      });

      expect(updated!.content).toBe("Updated content");
      expect(updated!.importance).toBe(0.9);
    });

    it("returns null for missing record", async () => {
      expect(await engine.update("nonexistent", { importance: 0.5 })).toBeNull();
    });
  });

  describe("forget", () => {
    it("deletes memories by IDs", async () => {
      const r1 = await engine.encode({ content: "Delete me", layer: "episodic" });
      const r2 = await engine.encode({ content: "Keep me", layer: "episodic" });

      const count = engine.forget({ ids: [r1.id] });
      expect(count).toBe(1);
      expect(engine.getById(r1.id)).toBeNull();
      expect(engine.getById(r2.id)).not.toBeNull();
    });

    it("archives memories instead of deleting", async () => {
      const record = await engine.encode({
        content: "Archive me",
        layer: "episodic",
      });

      const count = engine.forget({ ids: [record.id], archive: true });
      expect(count).toBe(1);

      // Archived, not deleted - can still find in DB directly
      const row = db
        .prepare("SELECT is_archived FROM memories WHERE id = ?")
        .get(record.id) as { is_archived: number };
      expect(row.is_archived).toBe(1);
    });

    it("forgets by layer", async () => {
      await engine.encode({ content: "E1", layer: "episodic" });
      await engine.encode({ content: "E2", layer: "episodic" });
      await engine.encode({ content: "S1", layer: "semantic" });

      const count = engine.forget({ layer: "episodic" });
      expect(count).toBe(2);

      const semantic = engine.getByLayer("semantic");
      expect(semantic).toHaveLength(1);
    });
  });

  describe("stats", () => {
    it("returns correct statistics", async () => {
      await engine.encode({ content: "S1", layer: "soul" });
      await engine.encode({ content: "P1", layer: "project" });
      await engine.encode({ content: "P2", layer: "project" });

      const stats = engine.stats();
      expect(stats.total).toBe(3);
      expect(stats.byLayer.soul).toBe(1);
      expect(stats.byLayer.project).toBe(2);
      expect(stats.byAgent.default).toBe(3);
    });
  });
});
