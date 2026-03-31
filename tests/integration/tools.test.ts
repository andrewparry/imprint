import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryEngine } from "../../src/memory/engine.js";
import { TaskManager } from "../../src/tasks/manager.js";
import { imprintConfigSchema } from "../../src/config.js";
import { createMemoryTools } from "../../src/tools/memory-tools.js";
import { createTaskTools } from "../../src/tools/task-tools.js";
import { createAdminTools } from "../../src/tools/admin-tools.js";
import type { EmbeddingService } from "../../src/memory/embeddings.js";

class MockEmbeddingService implements EmbeddingService {
  embed(text: string): Promise<Float32Array> {
    const arr = new Float32Array(384);
    for (let i = 0; i < 384; i++) {
      arr[i] = Math.sin(text.charCodeAt(i % text.length) * (i + 1));
    }
    let norm = 0;
    for (let i = 0; i < 384; i++) norm += arr[i] * arr[i];
    norm = Math.sqrt(norm);
    for (let i = 0; i < 384; i++) arr[i] /= norm;
    return Promise.resolve(arr);
  }
  embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
  dimensions(): number { return 384; }
  isReady(): boolean { return true; }
}

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schemaPath = resolve(import.meta.dirname, "../../src/db/schema.sql");
  db.exec(readFileSync(schemaPath, "utf-8"));
  return db;
}

describe("Memory Tools", () => {
  let memoryTools: ReturnType<typeof createMemoryTools>;

  beforeEach(() => {
    const db = createTestDb();
    const config = imprintConfigSchema.parse({});
    const engine = new MemoryEngine(db, new MockEmbeddingService(), config);
    memoryTools = createMemoryTools(engine);
  });

  it("imprint_remember stores and returns result", async () => {
    const result = await memoryTools.imprint_remember.execute("call-1", {
      content: "The user prefers dark mode",
      layer: "project",
    });

    expect(result.content[0].text).toContain("Stored memory");
    expect(result.details?.id).toBeTruthy();
    expect(result.details?.layer).toBe("project");
  });

  it("imprint_remember validates layer", async () => {
    const result = await memoryTools.imprint_remember.execute("call-1", {
      content: "test",
      layer: "session",
      // Missing sessionId
    });

    expect(result.content[0].text).toContain("Error");
  });

  it("imprint_recall searches memories", async () => {
    await memoryTools.imprint_remember.execute("call-1", {
      content: "TypeScript is our main language",
      layer: "semantic",
    });

    const result = await memoryTools.imprint_recall.execute("call-2", {
      query: "programming language",
    });

    // Should find something (via BM25 at minimum)
    expect(result.details?.count).toBeDefined();
  });

  it("imprint_soul_set and imprint_soul_get work together", async () => {
    await memoryTools.imprint_soul_set.execute("call-1", {
      identity: "I am a helpful coding assistant",
      values: "Accuracy, clarity, and brevity",
      style: "Technical and concise",
    });

    const result = await memoryTools.imprint_soul_get.execute("call-2", {});

    expect(result.content[0].text).toContain("Soul identity");
    expect(result.details?.count).toBe(3);
  });

  it("imprint_forget removes memories", async () => {
    const stored = await memoryTools.imprint_remember.execute("call-1", {
      content: "Temporary note",
      layer: "episodic",
    });

    const result = await memoryTools.imprint_forget.execute("call-2", {
      ids: [stored.details?.id],
      archive: false,
    });

    expect(result.content[0].text).toContain("deleted");
  });
});

describe("Task Tools", () => {
  let taskTools: ReturnType<typeof createTaskTools>;

  beforeEach(() => {
    const db = createTestDb();
    const manager = new TaskManager(db);
    taskTools = createTaskTools(manager, db);
  });

  it("creates and lists tasks", async () => {
    await taskTools.imprint_task_create.execute("call-1", {
      title: "Build memory system",
      description: "Implement the core memory engine",
      priority: 1,
      createdBy: "agent-a",
      assignedTo: "agent-b",
    });

    const listResult = await taskTools.imprint_task_list.execute("call-2", {
      assignedTo: "agent-b",
    });

    expect(listResult.details?.count).toBe(1);
  });

  it("updates task status", async () => {
    const created = await taskTools.imprint_task_create.execute("call-1", {
      title: "Test task",
      createdBy: "agent-a",
    });

    await taskTools.imprint_task_update.execute("call-2", {
      id: created.details?.id,
      status: "in_progress",
    });

    const getResult = await taskTools.imprint_task_get.execute("call-3", {
      id: created.details?.id,
    });

    expect(getResult.content[0].text).toContain("in_progress");
  });

  it("records decisions linked to tasks", async () => {
    const created = await taskTools.imprint_task_create.execute("call-1", {
      title: "Choose database",
      createdBy: "agent-a",
    });

    await taskTools.imprint_decision_record.execute("call-2", {
      title: "Use SQLite",
      reasoning: "Local-first, zero setup, excellent performance for our scale",
      outcome: "SQLite with WAL mode adopted",
      taskId: created.details?.id,
      agentId: "agent-a",
    });

    const getResult = await taskTools.imprint_task_get.execute("call-3", {
      id: created.details?.id,
    });

    expect(getResult.content[0].text).toContain("Use SQLite");
    expect(getResult.details?.decisions).toHaveLength(1);
  });

  it("rejects invalid status transitions", async () => {
    const created = await taskTools.imprint_task_create.execute("call-1", {
      title: "Test",
      createdBy: "a",
    });

    const result = await taskTools.imprint_task_update.execute("call-2", {
      id: created.details?.id,
      status: "done", // Can't go directly from open to done
    });

    expect(result.content[0].text).toContain("Error");
  });
});

describe("Admin Tools", () => {
  it("returns stats", async () => {
    const db = createTestDb();
    const config = imprintConfigSchema.parse({});
    const engine = new MemoryEngine(db, new MockEmbeddingService(), config);
    const tasks = new TaskManager(db);

    await engine.encode({ content: "Test", layer: "semantic" });
    tasks.create({ title: "Task 1", createdBy: "a" });

    const adminTools = createAdminTools(engine, tasks);
    const result = await adminTools.imprint_stats.execute("call-1");

    expect(result.content[0].text).toContain("Imprint Statistics");
    expect(result.details?.memory.total).toBe(1);
    expect(result.details?.tasks.total).toBe(1);
  });
});
