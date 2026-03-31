import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryEngine } from "../../src/memory/engine.js";
import { imprintConfigSchema } from "../../src/config.js";
import { migrateMarkdownMemories } from "../../src/cli/migrate.js";
import { exportMemories } from "../../src/cli/export.js";
import {
  parseMarkdownSections,
  estimateImportance,
} from "../../src/utils/markdown.js";
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

const TEMP_DIR = resolve(import.meta.dirname, "../.tmp-migration-test");

describe("Markdown Parsing", () => {
  it("parses sections from Markdown", () => {
    const md = `# Main Title

Introduction paragraph.

## Section One

Content of section one.
More content.

## Section Two

Content of section two.

### Subsection

Nested content.
`;
    const sections = parseMarkdownSections(md);

    expect(sections.length).toBeGreaterThanOrEqual(3);
    expect(sections[0].heading).toBe("Main Title");
    expect(sections[1].heading).toBe("Section One");
    expect(sections[1].content).toContain("Content of section one");
  });

  it("handles files without headings", () => {
    const md = "Just plain text\nwith multiple lines\n";
    const sections = parseMarkdownSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].content).toContain("Just plain text");
  });

  it("handles empty content", () => {
    expect(parseMarkdownSections("")).toHaveLength(0);
    expect(parseMarkdownSections("   \n  \n  ")).toHaveLength(0);
  });
});

describe("Importance Estimation", () => {
  it("assigns higher importance to action items", () => {
    const actionScore = estimateImportance("TODO: fix the authentication bug");
    const normalScore = estimateImportance("This is a regular note");
    expect(actionScore).toBeGreaterThan(normalScore);
  });

  it("assigns higher importance to rules", () => {
    const ruleScore = estimateImportance("Always use TypeScript for new code");
    const normalScore = estimateImportance("Went to the meeting today");
    expect(ruleScore).toBeGreaterThan(normalScore);
  });

  it("caps at 1.0", () => {
    const score = estimateImportance(
      "CRITICAL TODO: always never prefer rule convention standard important must blocker",
    );
    expect(score).toBeLessThanOrEqual(1.0);
  });
});

describe("Migration", () => {
  let db: Database.Database;
  let engine: MemoryEngine;

  beforeEach(() => {
    db = createTestDb();
    const config = imprintConfigSchema.parse({});
    engine = new MemoryEngine(db, new MockEmbeddingService(), config);

    // Create temp workspace
    rmSync(TEMP_DIR, { recursive: true, force: true });
    mkdirSync(resolve(TEMP_DIR, "memory"), { recursive: true });
  });

  it("migrates MEMORY.md as project memories", async () => {
    writeFileSync(
      resolve(TEMP_DIR, "MEMORY.md"),
      `# Project Memory

## Architecture

We use a microservices architecture with Docker.

## Team

- Alice: Backend lead
- Bob: Frontend lead
`,
    );

    const result = await migrateMarkdownMemories(engine, db, {
      workspaceDir: TEMP_DIR,
    });

    expect(result.filesProcessed).toBe(1);
    expect(result.recordsCreated).toBeGreaterThanOrEqual(2);

    const projects = engine.getByLayer("project");
    expect(projects.length).toBeGreaterThanOrEqual(2);
  });

  it("migrates daily notes as episodic memories", async () => {
    writeFileSync(
      resolve(TEMP_DIR, "memory/2026-03-30.md"),
      `## Morning Standup

Discussed the new feature rollout plan.

## Afternoon Review

Found a bug in the payment processing module.
`,
    );

    const result = await migrateMarkdownMemories(engine, db, {
      workspaceDir: TEMP_DIR,
    });

    expect(result.filesProcessed).toBe(1);
    expect(result.recordsCreated).toBeGreaterThanOrEqual(2);

    const episodic = engine.getByLayer("episodic");
    expect(episodic.length).toBeGreaterThanOrEqual(2);
  });

  it("migrates non-daily memory files as semantic", async () => {
    writeFileSync(
      resolve(TEMP_DIR, "memory/api-reference.md"),
      `## Endpoints

- GET /api/users - List users
- POST /api/users - Create user
`,
    );

    const result = await migrateMarkdownMemories(engine, db, {
      workspaceDir: TEMP_DIR,
    });

    const semantic = engine.getByLayer("semantic");
    expect(semantic.length).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent (skips already migrated files)", async () => {
    writeFileSync(
      resolve(TEMP_DIR, "MEMORY.md"),
      "## Note\n\nSome content.\n",
    );

    const r1 = await migrateMarkdownMemories(engine, db, { workspaceDir: TEMP_DIR });
    const r2 = await migrateMarkdownMemories(engine, db, { workspaceDir: TEMP_DIR });

    expect(r1.filesProcessed).toBe(1);
    expect(r2.skipped).toBe(1);
    expect(r2.filesProcessed).toBe(0);
  });

  it("supports dry run mode", async () => {
    writeFileSync(
      resolve(TEMP_DIR, "MEMORY.md"),
      "## Note\n\nSome content.\n",
    );

    const result = await migrateMarkdownMemories(engine, db, {
      workspaceDir: TEMP_DIR,
      dryRun: true,
    });

    expect(result.recordsCreated).toBeGreaterThan(0);

    // No actual records should have been created
    const stats = engine.stats();
    expect(stats.total).toBe(0);
  });
});

describe("Export", () => {
  let db: Database.Database;
  let engine: MemoryEngine;
  const EXPORT_DIR = resolve(TEMP_DIR, "export");

  beforeEach(async () => {
    db = createTestDb();
    const config = imprintConfigSchema.parse({});
    engine = new MemoryEngine(db, new MockEmbeddingService(), config);

    rmSync(TEMP_DIR, { recursive: true, force: true });

    await engine.encode({ content: "Soul memory", layer: "soul" });
    await engine.encode({ content: "Project memory", layer: "project" });
    await engine.encode({ content: "Semantic fact", layer: "semantic" });
  });

  it("exports memories to Markdown files", () => {
    const result = exportMemories(engine, { outputDir: EXPORT_DIR });

    expect(result.filesCreated).toBe(3);
    expect(result.recordsExported).toBe(3);

    const soulMd = readFileSync(resolve(EXPORT_DIR, "soul.md"), "utf-8");
    expect(soulMd).toContain("Soul memory");
    expect(soulMd).toContain("layer: soul");
  });

  it("exports specific layers only", () => {
    const result = exportMemories(engine, {
      outputDir: EXPORT_DIR,
      layers: ["soul"],
    });

    expect(result.filesCreated).toBe(1);
    expect(result.recordsExported).toBe(1);
  });
});
