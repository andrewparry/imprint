import type { MemoryStats } from "../memory/types.js";
import type { TaskStats } from "../tasks/types.js";

interface CacheStats {
  entries: number;
  maxEntries: number;
  hits: number;
  misses: number;
  hitRate: number;
}

export function buildDashboardHtml(
  memory: MemoryStats,
  tasks: TaskStats,
  cache: CacheStats,
): string {
  const memoryRows = Object.entries(memory.byLayer)
    .map(
      ([layer, count]) =>
        `<tr><td>${layer}</td><td>${count}</td><td><div class="bar" style="width:${Math.min(100, (count / Math.max(memory.total, 1)) * 100)}%"></div></td></tr>`,
    )
    .join("");

  const taskRows = Object.entries(tasks.byStatus)
    .map(
      ([status, count]) => {
        const color = {
          open: "#3b82f6",
          in_progress: "#f59e0b",
          blocked: "#ef4444",
          done: "#22c55e",
          cancelled: "#6b7280",
        }[status] ?? "#6b7280";
        return `<tr><td><span class="badge" style="background:${color}">${status}</span></td><td>${count}</td></tr>`;
      },
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Imprint Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; color: #f8fafc; }
    h2 { font-size: 1.1rem; margin-bottom: 0.75rem; color: #94a3b8; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; }
    .card { background: #1e293b; border-radius: 0.75rem; padding: 1.25rem; border: 1px solid #334155; }
    .stat { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #334155; }
    .stat:last-child { border: none; }
    .stat-value { font-weight: 600; color: #f8fafc; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 0.4rem 0.5rem; }
    tr:not(:last-child) td { border-bottom: 1px solid #334155; }
    .bar { height: 8px; background: #3b82f6; border-radius: 4px; min-width: 4px; }
    .badge { padding: 0.15rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; color: white; }
    .footer { margin-top: 2rem; text-align: center; color: #475569; font-size: 0.8rem; }
  </style>
</head>
<body>
  <h1>Imprint Dashboard</h1>

  <div class="grid">
    <div class="card">
      <h2>Memory</h2>
      <div class="stat"><span>Total</span><span class="stat-value">${memory.total}</span></div>
      <div class="stat"><span>Archived</span><span class="stat-value">${memory.archived}</span></div>
      <div class="stat"><span>DB Size</span><span class="stat-value">${(memory.dbSizeBytes / 1024).toFixed(1)} KB</span></div>
      <table style="margin-top:0.75rem">${memoryRows}</table>
    </div>

    <div class="card">
      <h2>Tasks</h2>
      <div class="stat"><span>Total</span><span class="stat-value">${tasks.total}</span></div>
      <table style="margin-top:0.75rem">${taskRows}</table>
    </div>

    <div class="card">
      <h2>Cache</h2>
      <div class="stat"><span>Entries</span><span class="stat-value">${cache.entries} / ${cache.maxEntries}</span></div>
      <div class="stat"><span>Hit Rate</span><span class="stat-value">${(cache.hitRate * 100).toFixed(1)}%</span></div>
      <div class="stat"><span>Hits</span><span class="stat-value">${cache.hits}</span></div>
      <div class="stat"><span>Misses</span><span class="stat-value">${cache.misses}</span></div>
    </div>
  </div>

  <div class="footer">Imprint v0.1.0 &mdash; Refreshed ${new Date().toISOString()}</div>
</body>
</html>`;
}
