import type { MemoryEngine } from "../memory/engine.js";
import type { TaskManager } from "../tasks/manager.js";
import type { ImprintDatabase } from "../db/connection.js";
import { buildDashboardHtml } from "./dashboard.js";

interface PluginApi {
  registerHttpRoute?(route: Record<string, unknown>): void;
}

export function registerHttpRoutes(
  api: PluginApi,
  engine: MemoryEngine,
  tasks: TaskManager,
  database: ImprintDatabase,
): void {
  if (!api.registerHttpRoute) return;

  // GET /imprint/health
  api.registerHttpRoute({
    method: "GET",
    path: "/imprint/health",
    handler: async () => {
      const memStats = engine.stats();
      const cacheStats = engine.getCache().stats();

      return {
        status: 200,
        body: {
          status: "healthy",
          database: {
            connected: true,
            sizeBytes: memStats.dbSizeBytes,
          },
          cache: {
            entries: cacheStats.entries,
            hitRate: cacheStats.hitRate,
          },
          embeddingModel: {
            loaded: true,
          },
        },
      };
    },
  });

  // GET /imprint/metrics
  api.registerHttpRoute({
    method: "GET",
    path: "/imprint/metrics",
    handler: async () => {
      const memStats = engine.stats();
      const taskStats = tasks.stats();
      const cacheStats = engine.getCache().stats();

      return {
        status: 200,
        body: {
          memories: {
            total: memStats.total,
            byLayer: memStats.byLayer,
            archived: memStats.archived,
          },
          tasks: {
            total: taskStats.total,
            byStatus: taskStats.byStatus,
          },
          cache: cacheStats,
          dbSizeBytes: memStats.dbSizeBytes,
        },
      };
    },
  });

  // GET /imprint/dashboard
  api.registerHttpRoute({
    method: "GET",
    path: "/imprint/dashboard",
    handler: async () => {
      const memStats = engine.stats();
      const taskStats = tasks.stats();
      const cacheStats = engine.getCache().stats();

      const html = buildDashboardHtml(memStats, taskStats, cacheStats);

      return {
        status: 200,
        headers: { "content-type": "text/html" },
        body: html,
      };
    },
  });
}
