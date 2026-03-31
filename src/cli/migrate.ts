import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, basename, relative } from "node:path";
import type { MemoryEngine } from "../memory/engine.js";
import type { MemoryLayer } from "../memory/types.js";
import { isMigrated, recordMigration } from "../db/migrator.js";
import { contentHash } from "../utils/hashing.js";
import {
  parseMarkdownSections,
  estimateImportance,
} from "../utils/markdown.js";
import type Database from "better-sqlite3";

const DAILY_NOTE_PATTERN = /^\d{4}-\d{2}-\d{2}\.md$/;

export interface MigrateOptions {
  workspaceDir: string;
  agentId?: string;
  dryRun?: boolean;
  verbose?: boolean;
}

export interface MigrateResult {
  filesProcessed: number;
  recordsCreated: number;
  skipped: number;
  errors: string[];
}

export async function migrateMarkdownMemories(
  engine: MemoryEngine,
  db: Database.Database,
  options: MigrateOptions,
): Promise<MigrateResult> {
  const result: MigrateResult = {
    filesProcessed: 0,
    recordsCreated: 0,
    skipped: 0,
    errors: [],
  };

  // 1. Migrate SOUL.md as soul layer
  const soulMdPath = resolve(options.workspaceDir, "SOUL.md");
  if (existsSync(soulMdPath)) {
    await migrateFile(engine, db, soulMdPath, "soul", options, result);
  }

  // 2. Migrate IDENTITY.md as soul layer
  const identityMdPath = resolve(options.workspaceDir, "IDENTITY.md");
  if (existsSync(identityMdPath)) {
    await migrateFile(engine, db, identityMdPath, "soul", options, result);
  }

  // 3. Migrate MEMORY.md as project layer
  const memoryMdPath = resolve(options.workspaceDir, "MEMORY.md");
  if (existsSync(memoryMdPath)) {
    await migrateFile(engine, db, memoryMdPath, "project", options, result);
  }

  // 4. Migrate memory/ directory
  const memoryDir = resolve(options.workspaceDir, "memory");
  if (existsSync(memoryDir)) {
    const files = readdirSync(memoryDir).filter((f) => f.endsWith(".md"));

    for (const file of files) {
      const filePath = resolve(memoryDir, file);
      const layer: MemoryLayer = DAILY_NOTE_PATTERN.test(file)
        ? "episodic"
        : "semantic";

      await migrateFile(engine, db, filePath, layer, options, result);
    }
  }

  return result;
}

async function migrateFile(
  engine: MemoryEngine,
  db: Database.Database,
  filePath: string,
  layer: MemoryLayer,
  options: MigrateOptions,
  result: MigrateResult,
): Promise<void> {
  const rawRelativePath = relative(options.workspaceDir, filePath);
  // Include agentId in the migration key to distinguish same-named files across workspaces
  const relativePath = options.agentId
    ? `${options.agentId}:${rawRelativePath}`
    : rawRelativePath;

  // Check if already migrated
  if (isMigrated(db, relativePath)) {
    result.skipped++;
    if (options.verbose) {
      console.log(`  Skipped (already migrated): ${relativePath}`);
    }
    return;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    if (!content.trim()) {
      result.skipped++;
      return;
    }

    const sections = parseMarkdownSections(content);
    let recordsCreated = 0;

    for (const section of sections) {
      if (!section.content.trim()) continue;

      const sectionContent = section.heading
        ? `${section.heading}: ${section.content}`
        : section.content;

      if (options.dryRun) {
        recordsCreated++;
        if (options.verbose) {
          console.log(
            `  [DRY RUN] Would create ${layer} memory: ${sectionContent.slice(0, 80)}...`,
          );
        }
        continue;
      }

      try {
        await engine.encode({
          content: sectionContent,
          layer,
          agentId: options.agentId,
          importance: estimateImportance(sectionContent),
          sourceType: "migration",
          metadata: {
            source: relativePath,
            heading: section.heading || undefined,
          },
        });
        recordsCreated++;
      } catch (err) {
        result.errors.push(
          `${relativePath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (!options.dryRun) {
      recordMigration(db, {
        filePath: relativePath,
        contentHash: contentHash(content),
        recordsCreated,
      });
    }

    result.filesProcessed++;
    result.recordsCreated += recordsCreated;

    if (options.verbose) {
      console.log(
        `  Migrated ${relativePath}: ${recordsCreated} records (${layer})`,
      );
    }
  } catch (err) {
    result.errors.push(
      `${relativePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
