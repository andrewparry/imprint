export const TASK_STATUSES = [
  "open",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  open: ["in_progress", "cancelled"],
  in_progress: ["done", "blocked", "cancelled"],
  blocked: ["in_progress", "done", "cancelled"],
  done: [],
  cancelled: [],
};

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: number;
  createdBy: string;
  assignedTo: string | null;
  deadline: string | null;
  completedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: number;
  createdBy: string;
  assignedTo?: string;
  deadline?: string;
  dependsOn?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: number;
  assignedTo?: string | null;
  deadline?: string | null;
  metadata?: Record<string, unknown>;
}

export interface TaskListQuery {
  status?: TaskStatus | TaskStatus[];
  assignedTo?: string;
  createdBy?: string;
  priority?: number;
  search?: string;
  hasBlockers?: boolean;
  deadlineBefore?: string;
  limit?: number;
  offset?: number;
}

export interface Decision {
  id: string;
  taskId: string | null;
  title: string;
  reasoning: string;
  outcome: string | null;
  agentId: string;
  context: Record<string, unknown> | null;
  createdAt: string;
}

export interface CreateDecisionInput {
  title: string;
  reasoning: string;
  outcome?: string;
  taskId?: string;
  agentId: string;
  context?: Record<string, unknown>;
}

export interface TaskStats {
  total: number;
  byStatus: Record<TaskStatus, number>;
  byAgent: Record<string, number>;
}
