import type Database from "better-sqlite3";
import type { Task, TaskListQuery, TaskStatus } from "./types.js";

/**
 * Dynamic task list query builder with FTS5 search support.
 */
export function listTasks(
  db: Database.Database,
  query: TaskListQuery,
): Task[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  let usesFts = false;

  if (query.status) {
    const statuses = Array.isArray(query.status)
      ? query.status
      : [query.status];
    const placeholders = statuses.map(() => "?").join(",");
    conditions.push(`t.status IN (${placeholders})`);
    params.push(...statuses);
  }

  if (query.assignedTo) {
    conditions.push("t.assigned_to = ?");
    params.push(query.assignedTo);
  }

  if (query.createdBy) {
    conditions.push("t.created_by = ?");
    params.push(query.createdBy);
  }

  if (query.priority !== undefined) {
    conditions.push("t.priority <= ?");
    params.push(query.priority);
  }

  if (query.deadlineBefore) {
    conditions.push("t.deadline IS NOT NULL AND t.deadline <= ?");
    params.push(query.deadlineBefore);
  }

  if (query.hasBlockers) {
    conditions.push(`EXISTS (
      SELECT 1 FROM task_dependencies td
      JOIN tasks blocker ON blocker.id = td.depends_on_id
      WHERE td.task_id = t.id AND blocker.status NOT IN ('done', 'cancelled')
    )`);
  }

  let sql: string;

  if (query.search) {
    usesFts = true;
    const ftsTokens = query.search
      .match(/[\p{L}\p{N}_]+/gu)
      ?.map((t) => `"${t.replaceAll('"', "")}"`)
      .join(" OR ");

    if (!ftsTokens) {
      return [];
    }

    conditions.push("tasks_fts MATCH ?");
    params.push(ftsTokens);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    sql = `
      SELECT t.*
      FROM tasks t
      JOIN tasks_fts ON tasks_fts.rowid = t.rowid
      ${where}
      ORDER BY rank, t.priority ASC, t.created_at DESC
    `;
  } else {
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    sql = `
      SELECT t.*
      FROM tasks t
      ${where}
      ORDER BY t.priority ASC, t.created_at DESC
    `;
  }

  const limit = query.limit ?? 20;
  const offset = query.offset ?? 0;
  sql += " LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string) ?? null,
    status: row.status as TaskStatus,
    priority: row.priority as number,
    createdBy: row.created_by as string,
    assignedTo: (row.assigned_to as string) ?? null,
    deadline: (row.deadline as string) ?? null,
    completedAt: (row.completed_at as string) ?? null,
    metadata: JSON.parse((row.metadata as string) || "{}"),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));
}

/**
 * Get open tasks assigned to a specific agent, ordered by priority.
 */
export function getAgentTasks(
  db: Database.Database,
  agentId: string,
): Task[] {
  return listTasks(db, {
    assignedTo: agentId,
    status: ["open", "in_progress", "blocked"],
    limit: 50,
  });
}
