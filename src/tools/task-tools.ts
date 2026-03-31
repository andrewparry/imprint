import { Type } from "@sinclair/typebox";
import type { TaskManager } from "../tasks/manager.js";
import type { TaskStatus } from "../tasks/types.js";
import { TASK_STATUSES } from "../tasks/types.js";
import { listTasks } from "../tasks/queries.js";
import type Database from "better-sqlite3";

export function createTaskTools(manager: TaskManager, db: Database.Database) {
  return {
    imprint_task_create: {
      name: "imprint_task_create",
      label: "Imprint Task Create",
      description:
        "Create a task that can be assigned to agents. Tasks track work, decisions, and dependencies across agents. Priority: 0=critical, 1=high, 2=medium, 3=low.",
      parameters: Type.Object({
        title: Type.String({ description: "Task title" }),
        description: Type.Optional(Type.String({ description: "Detailed description" })),
        priority: Type.Optional(
          Type.Number({ description: "Priority: 0=critical, 1=high, 2=medium (default), 3=low", minimum: 0, maximum: 3 }),
        ),
        assignedTo: Type.Optional(Type.String({ description: "Agent ID to assign to" })),
        createdBy: Type.String({ description: "Agent ID creating the task" }),
        deadline: Type.Optional(Type.String({ description: "ISO 8601 deadline" })),
        dependsOn: Type.Optional(
          Type.Array(Type.String(), { description: "Task IDs this depends on" }),
        ),
      }),
      async execute(
        _toolCallId: string,
        params: {
          title: string;
          description?: string;
          priority?: number;
          assignedTo?: string;
          createdBy: string;
          deadline?: string;
          dependsOn?: string[];
        },
      ) {
        try {
          const task = manager.create(params);

          return {
            content: [
              {
                type: "text" as const,
                text: `Task created: "${task.title}" (id: ${task.id}, status: ${task.status}${task.assignedTo ? `, assigned to: ${task.assignedTo}` : ""})`,
              },
            ],
            details: { id: task.id, status: task.status },
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error creating task: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          };
        }
      },
    },

    imprint_task_update: {
      name: "imprint_task_update",
      label: "Imprint Task Update",
      description:
        "Update a task's status, assignee, or details. Valid status transitions: open→in_progress/cancelled, in_progress→done/blocked/cancelled, blocked→in_progress/done/cancelled.",
      parameters: Type.Object({
        id: Type.String({ description: "Task ID" }),
        status: Type.Optional(
          Type.Unsafe<TaskStatus>({
            type: "string",
            enum: [...TASK_STATUSES],
            description: "New status",
          }),
        ),
        title: Type.Optional(Type.String({ description: "New title" })),
        description: Type.Optional(Type.String({ description: "New description" })),
        assignedTo: Type.Optional(Type.String({ description: "New assignee agent ID" })),
        priority: Type.Optional(Type.Number({ description: "New priority 0-3" })),
      }),
      async execute(
        _toolCallId: string,
        params: {
          id: string;
          status?: TaskStatus;
          title?: string;
          description?: string;
          assignedTo?: string;
          priority?: number;
        },
      ) {
        try {
          const task = manager.update(params.id, params);
          if (!task) {
            return {
              content: [{ type: "text" as const, text: `Task ${params.id} not found.` }],
            };
          }

          return {
            content: [
              {
                type: "text" as const,
                text: `Task updated: "${task.title}" (status: ${task.status}${task.assignedTo ? `, assigned to: ${task.assignedTo}` : ""})`,
              },
            ],
            details: { id: task.id, status: task.status },
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error updating task: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          };
        }
      },
    },

    imprint_task_list: {
      name: "imprint_task_list",
      label: "Imprint Task List",
      description: "List and filter tasks by status, assignee, priority, or search text.",
      parameters: Type.Object({
        status: Type.Optional(
          Type.Union([
            Type.Unsafe<TaskStatus>({
              type: "string",
              enum: [...TASK_STATUSES],
            }),
            Type.Array(
              Type.Unsafe<TaskStatus>({
                type: "string",
                enum: [...TASK_STATUSES],
              }),
            ),
          ], { description: "Filter by status" }),
        ),
        assignedTo: Type.Optional(Type.String({ description: "Filter by assignee" })),
        createdBy: Type.Optional(Type.String({ description: "Filter by creator" })),
        search: Type.Optional(Type.String({ description: "Full-text search in title/description" })),
        limit: Type.Optional(Type.Number({ description: "Max results (default: 20)" })),
      }),
      async execute(
        _toolCallId: string,
        params: {
          status?: TaskStatus | TaskStatus[];
          assignedTo?: string;
          createdBy?: string;
          search?: string;
          limit?: number;
        },
      ) {
        const tasks = listTasks(db, params);

        if (tasks.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No tasks found matching criteria." }],
            details: { count: 0 },
          };
        }

        const text = tasks
          .map(
            (t) =>
              `- [${t.status}] ${t.title} (id: ${t.id}, priority: ${t.priority}${t.assignedTo ? `, assigned: ${t.assignedTo}` : ""})`,
          )
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: `${tasks.length} tasks:\n${text}`,
            },
          ],
          details: { count: tasks.length, tasks },
        };
      },
    },

    imprint_task_get: {
      name: "imprint_task_get",
      label: "Imprint Task Get",
      description: "Get full details of a task including decisions and dependencies.",
      parameters: Type.Object({
        id: Type.String({ description: "Task ID" }),
      }),
      async execute(_toolCallId: string, params: { id: string }) {
        const task = manager.getById(params.id);
        if (!task) {
          return {
            content: [{ type: "text" as const, text: `Task ${params.id} not found.` }],
          };
        }

        const dependencies = manager.getDependencies(params.id);
        const decisions = manager.getDecisions(params.id);
        const isBlocked = manager.isBlocked(params.id);

        let text = `**${task.title}** (${task.status})\n`;
        text += `ID: ${task.id}\n`;
        text += `Priority: ${task.priority}\n`;
        text += `Created by: ${task.createdBy}\n`;
        if (task.assignedTo) text += `Assigned to: ${task.assignedTo}\n`;
        if (task.deadline) text += `Deadline: ${task.deadline}\n`;
        if (task.description) text += `\nDescription: ${task.description}\n`;
        if (isBlocked) text += `\n⚠ BLOCKED by incomplete dependencies\n`;

        if (dependencies.length > 0) {
          text += `\nDependencies:\n`;
          for (const dep of dependencies) {
            text += `  - [${dep.status}] ${dep.title} (${dep.id})\n`;
          }
        }

        if (decisions.length > 0) {
          text += `\nDecisions:\n`;
          for (const dec of decisions) {
            text += `  - ${dec.title}: ${dec.reasoning}${dec.outcome ? ` → ${dec.outcome}` : ""}\n`;
          }
        }

        return {
          content: [{ type: "text" as const, text }],
          details: { task, dependencies, decisions, isBlocked },
        };
      },
    },

    imprint_decision_record: {
      name: "imprint_decision_record",
      label: "Imprint Decision Record",
      description:
        "Record a decision with reasoning. Optionally link to a task. Decisions are searchable and help explain why choices were made.",
      parameters: Type.Object({
        title: Type.String({ description: "Decision title" }),
        reasoning: Type.String({ description: "Why this decision was made" }),
        outcome: Type.Optional(Type.String({ description: "What was decided" })),
        taskId: Type.Optional(Type.String({ description: "Link to a task ID" })),
        agentId: Type.String({ description: "Agent making the decision" }),
      }),
      async execute(
        _toolCallId: string,
        params: {
          title: string;
          reasoning: string;
          outcome?: string;
          taskId?: string;
          agentId: string;
        },
      ) {
        const decision = manager.recordDecision(params);

        return {
          content: [
            {
              type: "text" as const,
              text: `Decision recorded: "${decision.title}" (id: ${decision.id}${decision.taskId ? `, linked to task: ${decision.taskId}` : ""})`,
            },
          ],
          details: { id: decision.id },
        };
      },
    },
  };
}
