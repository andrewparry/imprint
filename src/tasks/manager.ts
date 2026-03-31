import type Database from "better-sqlite3";
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  Decision,
  CreateDecisionInput,
  TaskStatus,
  TaskStats,
} from "./types.js";
import { TASK_STATUSES, VALID_TRANSITIONS } from "./types.js";
import { generateId, now } from "../utils/time.js";

export class TaskManager {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(input: CreateTaskInput): Task {
    const id = generateId();
    const timestamp = now();
    const metadata = JSON.stringify(input.metadata ?? {});

    this.db
      .prepare(
        `INSERT INTO tasks (
          id, title, description, status, priority, created_by,
          assigned_to, deadline, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.title,
        input.description ?? null,
        input.priority ?? 2,
        input.createdBy,
        input.assignedTo ?? null,
        input.deadline ?? null,
        metadata,
        timestamp,
        timestamp,
      );

    // Add dependencies
    if (input.dependsOn && input.dependsOn.length > 0) {
      const stmt = this.db.prepare(
        "INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)",
      );
      for (const depId of input.dependsOn) {
        stmt.run(id, depId);
      }
    }

    return this.getById(id)!;
  }

  getById(id: string): Task | null {
    const row = this.db
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;

    return row ? rowToTask(row) : null;
  }

  update(id: string, input: UpdateTaskInput): Task | null {
    const existing = this.getById(id);
    if (!existing) return null;

    // Validate status transition
    if (input.status) {
      const validNext = VALID_TRANSITIONS[existing.status];
      if (!validNext.includes(input.status)) {
        throw new Error(
          `Invalid status transition: ${existing.status} → ${input.status}. Valid: ${validNext.join(", ")}`,
        );
      }
    }

    const sets: string[] = ["updated_at = ?"];
    const params: (string | number | null)[] = [now()];

    if (input.title !== undefined) {
      sets.push("title = ?");
      params.push(input.title);
    }
    if (input.description !== undefined) {
      sets.push("description = ?");
      params.push(input.description);
    }
    if (input.status !== undefined) {
      sets.push("status = ?");
      params.push(input.status);
      if (input.status === "done") {
        sets.push("completed_at = ?");
        params.push(now());
      }
    }
    if (input.priority !== undefined) {
      sets.push("priority = ?");
      params.push(input.priority);
    }
    if (input.assignedTo !== undefined) {
      sets.push("assigned_to = ?");
      params.push(input.assignedTo);
    }
    if (input.deadline !== undefined) {
      sets.push("deadline = ?");
      params.push(input.deadline);
    }
    if (input.metadata !== undefined) {
      sets.push("metadata = ?");
      params.push(JSON.stringify(input.metadata));
    }

    params.push(id);
    this.db
      .prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`)
      .run(...params);

    return this.getById(id);
  }

  /**
   * Get dependencies for a task.
   */
  getDependencies(taskId: string): Task[] {
    const rows = this.db
      .prepare(
        `SELECT t.* FROM tasks t
         JOIN task_dependencies td ON t.id = td.depends_on_id
         WHERE td.task_id = ?`,
      )
      .all(taskId) as Array<Record<string, unknown>>;

    return rows.map(rowToTask);
  }

  /**
   * Get tasks that depend on this task.
   */
  getDependents(taskId: string): Task[] {
    const rows = this.db
      .prepare(
        `SELECT t.* FROM tasks t
         JOIN task_dependencies td ON t.id = td.task_id
         WHERE td.depends_on_id = ?`,
      )
      .all(taskId) as Array<Record<string, unknown>>;

    return rows.map(rowToTask);
  }

  /**
   * Check if a task has unresolved blocking dependencies.
   */
  isBlocked(taskId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM task_dependencies td
         JOIN tasks t ON t.id = td.depends_on_id
         WHERE td.task_id = ? AND t.status NOT IN ('done', 'cancelled')`,
      )
      .get(taskId) as { count: number };

    return row.count > 0;
  }

  /**
   * Add a dependency between tasks.
   */
  addDependency(taskId: string, dependsOnId: string): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)",
      )
      .run(taskId, dependsOnId);
  }

  /**
   * Remove a dependency.
   */
  removeDependency(taskId: string, dependsOnId: string): void {
    this.db
      .prepare(
        "DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?",
      )
      .run(taskId, dependsOnId);
  }

  /**
   * Record a decision.
   */
  recordDecision(input: CreateDecisionInput): Decision {
    const id = generateId();
    const timestamp = now();

    this.db
      .prepare(
        `INSERT INTO decisions (id, task_id, title, reasoning, outcome, agent_id, context, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.taskId ?? null,
        input.title,
        input.reasoning,
        input.outcome ?? null,
        input.agentId,
        input.context ? JSON.stringify(input.context) : null,
        timestamp,
      );

    return {
      id,
      taskId: input.taskId ?? null,
      title: input.title,
      reasoning: input.reasoning,
      outcome: input.outcome ?? null,
      agentId: input.agentId,
      context: input.context ?? null,
      createdAt: timestamp,
    };
  }

  /**
   * Get decisions for a task.
   */
  getDecisions(taskId: string): Decision[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM decisions WHERE task_id = ? ORDER BY created_at DESC",
      )
      .all(taskId) as Array<Record<string, unknown>>;

    return rows.map(rowToDecision);
  }

  /**
   * Get task statistics.
   */
  stats(): TaskStats {
    const total = (
      this.db.prepare("SELECT COUNT(*) as count FROM tasks").get() as {
        count: number;
      }
    ).count;

    const byStatus: Record<string, number> = {};
    for (const status of TASK_STATUSES) {
      byStatus[status] = (
        this.db
          .prepare("SELECT COUNT(*) as count FROM tasks WHERE status = ?")
          .get(status) as { count: number }
      ).count;
    }

    const agentRows = this.db
      .prepare(
        "SELECT assigned_to, COUNT(*) as count FROM tasks WHERE assigned_to IS NOT NULL GROUP BY assigned_to",
      )
      .all() as Array<{ assigned_to: string; count: number }>;
    const byAgent: Record<string, number> = {};
    for (const row of agentRows) {
      byAgent[row.assigned_to] = row.count;
    }

    return {
      total,
      byStatus: byStatus as Record<TaskStatus, number>,
      byAgent,
    };
  }
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
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
  };
}

function rowToDecision(row: Record<string, unknown>): Decision {
  return {
    id: row.id as string,
    taskId: (row.task_id as string) ?? null,
    title: row.title as string,
    reasoning: row.reasoning as string,
    outcome: (row.outcome as string) ?? null,
    agentId: row.agent_id as string,
    context: row.context ? JSON.parse(row.context as string) : null,
    createdAt: row.created_at as string,
  };
}
