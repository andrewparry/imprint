#!/usr/bin/env npx tsx
/**
 * Standalone migration script for importing OpenClaw workspace memories into Imprint.
 *
 * Usage: npx tsx scripts/migrate-openclaw.ts /path/to/.openclaw
 */

import { resolve, basename } from "node:path";
import { readdirSync, existsSync } from "node:fs";
import Database from "better-sqlite3";
import { imprintConfigSchema } from "../src/config.js";
import { MemoryEngine } from "../src/memory/engine.js";
import { TransformerEmbeddingService } from "../src/memory/embeddings.js";
import { initializeSchema, loadSqliteVec } from "../src/db/connection.js";
import { migrateMarkdownMemories } from "../src/cli/migrate.js";

const openclawDir = process.argv[2];
if (!openclawDir) {
  console.error("Usage: npx tsx scripts/migrate-openclaw.ts /path/to/.openclaw");
  process.exit(1);
}

const resolvedDir = resolve(openclawDir);
if (!existsSync(resolvedDir)) {
  console.error(`Directory not found: ${resolvedDir}`);
  process.exit(1);
}

// Find all workspace directories
const workspaces = readdirSync(resolvedDir)
  .filter((d) => d.startsWith("workspace-"))
  .map((d) => ({
    name: d.replace("workspace-", ""),
    path: resolve(resolvedDir, d),
  }));

if (workspaces.length === 0) {
  console.error("No workspace-* directories found");
  process.exit(1);
}

console.log(`\nImprint Migration — ${workspaces.length} workspaces found\n`);

// Initialize database
const dataDir = resolve(resolvedDir, ".imprint");
const dbPath = resolve(dataDir, "imprint.db");

// Ensure data directory exists
import { mkdirSync } from "node:fs";
mkdirSync(dataDir, { recursive: true });

console.log(`Database: ${dbPath}`);

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("cache_size = -65536");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

// Apply schema
const schemaPath = resolve(import.meta.dirname, "../src/db/schema.sql");
import { readFileSync } from "node:fs";
const schema = readFileSync(schemaPath, "utf-8");
db.exec(schema);

// Initialize embedding service
console.log("Loading embedding model (first run will download ~22MB)...\n");
const config = imprintConfigSchema.parse({});
const embeddingService = new TransformerEmbeddingService(config.embeddingModel);

// Wait for model to be ready
await embeddingService.embed("warmup");
console.log("Embedding model ready.\n");

// Load sqlite-vec
try {
  loadSqliteVec({ db, close() {} }, embeddingService.dimensions());
  console.log("sqlite-vec loaded.\n");
} catch (err) {
  console.warn("sqlite-vec not available — vector search will be disabled.");
  console.warn("Install with: npm install sqlite-vec\n");
}

// Create engine
const engine = new MemoryEngine(db, embeddingService, config);

// Migrate each workspace
let totalFiles = 0;
let totalRecords = 0;
let totalSkipped = 0;
const allErrors: string[] = [];

for (const ws of workspaces) {
  console.log(`━━━ ${ws.name} ━━━`);

  const result = await migrateMarkdownMemories(engine, db, {
    workspaceDir: ws.path,
    agentId: ws.name,
    verbose: true,
  });

  totalFiles += result.filesProcessed;
  totalRecords += result.recordsCreated;
  totalSkipped += result.skipped;
  allErrors.push(...result.errors);

  console.log(
    `  → ${result.recordsCreated} records from ${result.filesProcessed} files (${result.skipped} skipped)\n`,
  );
}

// Print summary
console.log("═══════════════════════════════════════");
console.log("Migration Complete");
console.log(`  Workspaces:  ${workspaces.length}`);
console.log(`  Files:       ${totalFiles}`);
console.log(`  Records:     ${totalRecords}`);
console.log(`  Skipped:     ${totalSkipped}`);
if (allErrors.length > 0) {
  console.log(`  Errors:      ${allErrors.length}`);
  for (const err of allErrors) {
    console.log(`    - ${err}`);
  }
}
console.log("═══════════════════════════════════════");

// Print stats
const stats = engine.stats();
console.log("\nMemory Stats:");
console.log(`  Total memories: ${stats.totalMemories}`);
console.log("  By layer:");
for (const [layer, count] of Object.entries(stats.byLayer)) {
  if (count > 0) console.log(`    ${layer}: ${count}`);
}
console.log("  By agent:");
for (const [agent, count] of Object.entries(stats.byAgent)) {
  if (count > 0) console.log(`    ${agent}: ${count}`);
}

db.close();
console.log("\nDone. Database at:", dbPath);
