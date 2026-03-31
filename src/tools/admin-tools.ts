import { Type } from "@sinclair/typebox";
import type { MemoryEngine } from "../memory/engine.js";
import type { TaskManager } from "../tasks/manager.js";

export function createAdminTools(engine: MemoryEngine, tasks: TaskManager) {
  return {
    imprint_stats: {
      name: "imprint_stats",
      label: "Imprint Stats",
      description:
        "Get Imprint system statistics: memory counts by layer, task counts by status, cache hit rate, database size.",
      parameters: Type.Object({}),
      async execute(_toolCallId: string) {
        const memoryStats = engine.stats();
        const taskStats = tasks.stats();
        const cacheStats = engine.getCache().stats();

        const text = [
          "**Imprint Statistics**",
          "",
          "Memory:",
          `  Total: ${memoryStats.total} (archived: ${memoryStats.archived})`,
          ...Object.entries(memoryStats.byLayer).map(
            ([layer, count]) => `  ${layer}: ${count}`,
          ),
          "",
          "Tasks:",
          `  Total: ${taskStats.total}`,
          ...Object.entries(taskStats.byStatus).map(
            ([status, count]) => `  ${status}: ${count}`,
          ),
          "",
          "Cache:",
          `  Entries: ${cacheStats.entries}/${cacheStats.maxEntries}`,
          `  Hit rate: ${(cacheStats.hitRate * 100).toFixed(1)}%`,
          "",
          `Database size: ${(memoryStats.dbSizeBytes / 1024).toFixed(1)} KB`,
        ].join("\n");

        return {
          content: [{ type: "text" as const, text }],
          details: { memory: memoryStats, tasks: taskStats, cache: cacheStats },
        };
      },
    },
  };
}
