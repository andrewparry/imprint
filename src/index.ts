import { resolve } from "node:path";
import { imprintConfigSchema } from "./config.js";
import { openDatabase, initializeSchema, loadSqliteVec } from "./db/connection.js";
import { TransformerEmbeddingService } from "./memory/embeddings.js";
import { MemoryEngine } from "./memory/engine.js";
import { TaskManager } from "./tasks/manager.js";
import { createMemoryTools } from "./tools/memory-tools.js";
import { createTaskTools } from "./tools/task-tools.js";
import { createAdminTools } from "./tools/admin-tools.js";
import {
  createSessionStartHook,
  createSessionEndHook,
} from "./hooks/session-hooks.js";
import { createAutoCaptureHook } from "./hooks/auto-capture.js";
import { registerCliCommands } from "./cli/commands.js";
import { registerHttpRoutes } from "./http/routes.js";

// Type definitions for OpenClaw plugin API
// These are minimal type stubs; the real types come from openclaw peer dep
interface OpenClawPluginApi {
  pluginConfig: unknown;
  resolvePath(path: string): string;
  logger: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
  registerTool(tool: Record<string, unknown>, options?: Record<string, unknown>): void;
  registerCli(
    handler: (ctx: { program: unknown }) => void,
    options?: Record<string, unknown>,
  ): void;
  registerService(service: {
    id: string;
    start: () => void;
    stop: () => void;
  }): void;
  registerHttpRoute?(route: Record<string, unknown>): void;
  on(event: string, handler: (...args: unknown[]) => Promise<unknown>): void;
}

interface PluginEntry {
  id: string;
  name: string;
  description: string;
  kind: string;
  configSchema: unknown;
  register(api: OpenClawPluginApi): void;
}

// definePluginEntry is a passthrough — OpenClaw discovers the exported object directly
function definePluginEntry(entry: PluginEntry): PluginEntry {
  return entry;
}

let consolidationTimer: ReturnType<typeof setInterval> | null = null;

export default definePluginEntry({
  id: "imprint",
  name: "Imprint Memory & Tasks",
  description:
    "Multi-layered cognitive memory and task management for multi-agent OpenClaw",
  kind: "memory",
  configSchema: imprintConfigSchema,

  register(api: OpenClawPluginApi) {
    // 1. Parse config
    const rawConfig = api.pluginConfig ?? {};
    const config = imprintConfigSchema.parse(rawConfig);

    // 2. Initialize database
    const dbPath = resolve(api.resolvePath(config.dataDir), "imprint.db");
    const database = openDatabase(dbPath);
    initializeSchema(database);

    // 3. Load sqlite-vec for vector search
    const embeddingService = new TransformerEmbeddingService(config.embeddingModel);
    loadSqliteVec(database, embeddingService.dimensions());

    // 4. Initialize core systems
    const engine = new MemoryEngine(database.db, embeddingService, config);
    const taskManager = new TaskManager(database.db);

    api.logger.info(
      `imprint: initialized (db: ${dbPath}, model: ${config.embeddingModel})`,
    );

    // 5. Register memory tools
    const memoryTools = createMemoryTools(engine);
    for (const tool of Object.values(memoryTools)) {
      api.registerTool(tool as Record<string, unknown>, { name: tool.name });
    }

    // 6. Register task tools
    const taskTools = createTaskTools(taskManager, database.db);
    for (const tool of Object.values(taskTools)) {
      api.registerTool(tool as Record<string, unknown>, { name: tool.name });
    }

    // 7. Register admin tools
    const adminTools = createAdminTools(engine, taskManager);
    for (const tool of Object.values(adminTools)) {
      api.registerTool(tool as Record<string, unknown>, { name: tool.name });
    }

    // 8. Register hooks
    if (config.autoRecall) {
      api.on(
        "before_agent_start",
        createSessionStartHook(engine, taskManager, database.db) as (
          ...args: unknown[]
        ) => Promise<unknown>,
      );
    }

    api.on(
      "agent_end",
      createSessionEndHook(engine) as (...args: unknown[]) => Promise<unknown>,
    );

    if (config.autoCapture) {
      api.on(
        "agent_end",
        createAutoCaptureHook(engine) as (...args: unknown[]) => Promise<unknown>,
      );
    }

    // 9. Register CLI
    api.registerCli(
      ({ program }) => {
        registerCliCommands(
          program as any,
          engine,
          taskManager,
          database,
          config,
        );
      },
      {
        descriptors: [
          {
            name: "imprint",
            description:
              "Imprint memory & task management: migrate, export, stats, search, reset",
            hasSubcommands: true,
          },
        ],
      },
    );

    // 10. Register HTTP routes
    if (api.registerHttpRoute) {
      registerHttpRoutes(api, engine, taskManager, database);
    }

    // 11. Register consolidation background service
    api.registerService({
      id: "imprint-consolidation",
      start() {
        const intervalMs = config.consolidation.intervalMinutes * 60 * 1000;
        consolidationTimer = setInterval(async () => {
          try {
            const result = await engine.consolidate();
            if (result.archived > 0 || result.merged > 0 || result.deleted > 0) {
              api.logger.info(
                `imprint: consolidation complete - archived: ${result.archived}, merged: ${result.merged}, deleted: ${result.deleted}`,
              );
            }
          } catch (err) {
            api.logger.warn(
              `imprint: consolidation error: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }, intervalMs);

        api.logger.info(
          `imprint: consolidation service started (interval: ${config.consolidation.intervalMinutes}m)`,
        );
      },
      stop() {
        if (consolidationTimer) {
          clearInterval(consolidationTimer);
          consolidationTimer = null;
        }
        database.close();
        api.logger.info("imprint: stopped");
      },
    });
  },
});

// Export core classes for programmatic use
export { MemoryEngine } from "./memory/engine.js";
export { TaskManager } from "./tasks/manager.js";
export { LRUCache } from "./memory/cache.js";
export { TransformerEmbeddingService } from "./memory/embeddings.js";
export { openDatabase, initializeSchema } from "./db/connection.js";
export type { ImprintConfig } from "./config.js";
export type { MemoryRecord, MemoryLayer, RankedMemory } from "./memory/types.js";
export type { Task, Decision, TaskStatus } from "./tasks/types.js";
