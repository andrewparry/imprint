import type { MemoryEngine } from "../memory/engine.js";
import type { TaskManager } from "../tasks/manager.js";
import { getAgentTasks } from "../tasks/queries.js";
import type Database from "better-sqlite3";

/**
 * Build context to inject at session start.
 * Loads soul + project memories and open tasks for the agent.
 */
export function buildSessionStartContext(
  engine: MemoryEngine,
  tasks: TaskManager,
  db: Database.Database,
  agentId: string,
): string {
  const parts: string[] = [];

  // Load soul memories
  const soulMemories = engine.getByLayer("soul", agentId);
  if (soulMemories.length > 0) {
    parts.push("<imprint-soul>");
    for (const m of soulMemories) {
      parts.push(m.content);
    }
    parts.push("</imprint-soul>");
  }

  // Load project memories
  const projectMemories = engine.getByLayer("project", agentId);
  if (projectMemories.length > 0) {
    parts.push("<imprint-project>");
    for (const m of projectMemories.slice(0, 20)) {
      parts.push(`- ${m.content}`);
    }
    parts.push("</imprint-project>");
  }

  // Load open tasks assigned to this agent
  const openTasks = getAgentTasks(db, agentId);
  if (openTasks.length > 0) {
    parts.push("<imprint-tasks>");
    parts.push(`You have ${openTasks.length} assigned task(s):`);
    for (const t of openTasks) {
      const priority = ["CRITICAL", "HIGH", "MEDIUM", "LOW"][t.priority] ?? "MEDIUM";
      parts.push(
        `- [${t.status}] [${priority}] ${t.title} (id: ${t.id})${t.deadline ? ` deadline: ${t.deadline}` : ""}`,
      );
    }
    parts.push("</imprint-tasks>");
  }

  return parts.join("\n");
}

/**
 * Create session start hook handler.
 */
export function createSessionStartHook(
  engine: MemoryEngine,
  tasks: TaskManager,
  db: Database.Database,
) {
  return async (event: { prompt?: string; agentId?: string }) => {
    const agentId = event.agentId ?? "default";
    const context = buildSessionStartContext(engine, tasks, db, agentId);

    if (!context) return;

    return {
      prependContext: context,
    };
  };
}

/**
 * Create session end hook handler.
 * Flushes volatile session state.
 */
export function createSessionEndHook(engine: MemoryEngine) {
  return async (event: { agentId?: string; sessionId?: string }) => {
    if (event.sessionId) {
      engine.getCache().clearSession(event.sessionId);
    }
  };
}
