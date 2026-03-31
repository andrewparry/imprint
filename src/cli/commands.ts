import type { MemoryEngine } from "../memory/engine.js";
import type { TaskManager } from "../tasks/manager.js";
import type { ImprintDatabase } from "../db/connection.js";
import type { ImprintConfig } from "../config.js";
import { migrateMarkdownMemories } from "./migrate.js";
import { exportMemories } from "./export.js";
import { MEMORY_LAYERS, type MemoryLayer } from "../memory/types.js";

/**
 * Register CLI commands under the `imprint` subcommand.
 */
export function registerCliCommands(
  program: any,
  engine: MemoryEngine,
  tasks: TaskManager,
  database: ImprintDatabase,
  config: ImprintConfig,
): void {
  const imprint = program
    .command("imprint")
    .description("Imprint memory & task management");

  // imprint migrate
  imprint
    .command("migrate")
    .description("Import existing MEMORY.md and daily notes into Imprint")
    .option("--workspace <dir>", "Workspace directory", ".")
    .option("--dry-run", "Preview without importing")
    .option("--verbose", "Show detailed output")
    .action(async (opts: { workspace: string; dryRun?: boolean; verbose?: boolean }) => {
      console.log("Imprint: Starting migration...");

      const result = await migrateMarkdownMemories(engine, database.db, {
        workspaceDir: opts.workspace,
        dryRun: opts.dryRun,
        verbose: opts.verbose,
      });

      console.log(`\nMigration ${opts.dryRun ? "(dry run) " : ""}complete:`);
      console.log(`  Files processed: ${result.filesProcessed}`);
      console.log(`  Records created: ${result.recordsCreated}`);
      console.log(`  Skipped: ${result.skipped}`);

      if (result.errors.length > 0) {
        console.log(`  Errors: ${result.errors.length}`);
        for (const err of result.errors) {
          console.log(`    - ${err}`);
        }
      }
    });

  // imprint export
  imprint
    .command("export")
    .description("Export memories to Markdown files")
    .option("--output <dir>", "Output directory", "./imprint-export")
    .option("--layer <layer>", "Export specific layer only")
    .option("--agent <id>", "Export specific agent only")
    .action((opts: { output: string; layer?: string; agent?: string }) => {
      const result = exportMemories(engine, {
        outputDir: opts.output,
        layers: opts.layer
          ? [opts.layer as MemoryLayer]
          : undefined,
        agentId: opts.agent,
      });

      console.log(`Export complete:`);
      console.log(`  Files created: ${result.filesCreated}`);
      console.log(`  Records exported: ${result.recordsExported}`);
      console.log(`  Output: ${opts.output}`);
    });

  // imprint stats
  imprint
    .command("stats")
    .description("Show memory and task statistics")
    .action(() => {
      const memStats = engine.stats();
      const taskStats = tasks.stats();
      const cacheStats = engine.getCache().stats();

      console.log("Imprint Statistics");
      console.log("==================");
      console.log("");
      console.log("Memory:");
      console.log(`  Total: ${memStats.total} (archived: ${memStats.archived})`);
      for (const [layer, count] of Object.entries(memStats.byLayer)) {
        console.log(`  ${layer}: ${count}`);
      }
      console.log(`  DB size: ${(memStats.dbSizeBytes / 1024).toFixed(1)} KB`);
      console.log("");
      console.log("Tasks:");
      console.log(`  Total: ${taskStats.total}`);
      for (const [status, count] of Object.entries(taskStats.byStatus)) {
        console.log(`  ${status}: ${count}`);
      }
      console.log("");
      console.log("Cache:");
      console.log(`  Entries: ${cacheStats.entries}/${cacheStats.maxEntries}`);
      console.log(`  Hit rate: ${(cacheStats.hitRate * 100).toFixed(1)}%`);
    });

  // imprint search
  imprint
    .command("search")
    .description("Search memories from the command line")
    .argument("<query>", "Search query")
    .option("--limit <n>", "Max results", "10")
    .option("--layer <layer>", "Filter by layer")
    .action(async (query: string, opts: { limit: string; layer?: string }) => {
      const results = await engine.recall({
        query,
        limit: parseInt(opts.limit),
        layers: opts.layer ? [opts.layer as MemoryLayer] : undefined,
      });

      if (results.length === 0) {
        console.log("No results found.");
        return;
      }

      for (const r of results) {
        console.log(
          `[${r.record.layer}] (score: ${(r.score * 100).toFixed(0)}%) ${r.record.content.slice(0, 120)}`,
        );
        console.log(`  id: ${r.record.id} | importance: ${r.record.importance}`);
        console.log("");
      }
    });

  // imprint reset
  imprint
    .command("reset")
    .description("Clear a specific memory layer")
    .argument("<layer>", `Layer to clear: ${MEMORY_LAYERS.join(", ")}`)
    .option("--agent <id>", "Clear only for specific agent")
    .option("--force", "Skip confirmation")
    .action((layer: string, opts: { agent?: string; force?: boolean }) => {
      if (!MEMORY_LAYERS.includes(layer as MemoryLayer)) {
        console.error(
          `Invalid layer: ${layer}. Valid: ${MEMORY_LAYERS.join(", ")}`,
        );
        return;
      }

      const count = engine.forget({
        layer: layer as MemoryLayer,
        agentId: opts.agent,
      });

      console.log(`Cleared ${count} memories from '${layer}' layer.`);
    });
}
