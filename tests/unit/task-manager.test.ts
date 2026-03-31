import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TaskManager } from "../../src/tasks/manager.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  const schemaPath = resolve(import.meta.dirname, "../../src/db/schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  db.exec(schema);

  return db;
}

describe("TaskManager", () => {
  let db: Database.Database;
  let manager: TaskManager;

  beforeEach(() => {
    db = createTestDb();
    manager = new TaskManager(db);
  });

  describe("create", () => {
    it("creates a task with defaults", () => {
      const task = manager.create({
        title: "Test task",
        createdBy: "agent-a",
      });

      expect(task.id).toBeTruthy();
      expect(task.title).toBe("Test task");
      expect(task.status).toBe("open");
      expect(task.priority).toBe(2);
      expect(task.createdBy).toBe("agent-a");
      expect(task.assignedTo).toBeNull();
    });

    it("creates a task with all fields", () => {
      const task = manager.create({
        title: "Full task",
        description: "Detailed description",
        priority: 0,
        createdBy: "agent-a",
        assignedTo: "agent-b",
        deadline: "2026-04-15T00:00:00Z",
      });

      expect(task.description).toBe("Detailed description");
      expect(task.priority).toBe(0);
      expect(task.assignedTo).toBe("agent-b");
      expect(task.deadline).toBe("2026-04-15T00:00:00Z");
    });

    it("creates task with dependencies", () => {
      const dep = manager.create({ title: "Dependency", createdBy: "a" });
      const task = manager.create({
        title: "Main task",
        createdBy: "a",
        dependsOn: [dep.id],
      });

      const deps = manager.getDependencies(task.id);
      expect(deps).toHaveLength(1);
      expect(deps[0].id).toBe(dep.id);
    });
  });

  describe("update", () => {
    it("updates status with valid transition", () => {
      const task = manager.create({ title: "Task", createdBy: "a" });
      const updated = manager.update(task.id, { status: "in_progress" });
      expect(updated?.status).toBe("in_progress");
    });

    it("rejects invalid status transition", () => {
      const task = manager.create({ title: "Task", createdBy: "a" });
      expect(() =>
        manager.update(task.id, { status: "done" }),
      ).toThrow("Invalid status transition");
    });

    it("sets completedAt when marking done", () => {
      const task = manager.create({ title: "Task", createdBy: "a" });
      manager.update(task.id, { status: "in_progress" });
      const done = manager.update(task.id, { status: "done" });
      expect(done?.completedAt).toBeTruthy();
    });

    it("returns null for nonexistent task", () => {
      expect(manager.update("nonexistent", { status: "done" })).toBeNull();
    });
  });

  describe("dependencies", () => {
    it("detects blocked tasks", () => {
      const dep = manager.create({ title: "Blocker", createdBy: "a" });
      const task = manager.create({
        title: "Blocked",
        createdBy: "a",
        dependsOn: [dep.id],
      });

      expect(manager.isBlocked(task.id)).toBe(true);

      manager.update(dep.id, { status: "in_progress" });
      manager.update(dep.id, { status: "done" });
      expect(manager.isBlocked(task.id)).toBe(false);
    });

    it("gets dependents", () => {
      const dep = manager.create({ title: "Dep", createdBy: "a" });
      const task1 = manager.create({
        title: "T1",
        createdBy: "a",
        dependsOn: [dep.id],
      });
      const task2 = manager.create({
        title: "T2",
        createdBy: "a",
        dependsOn: [dep.id],
      });

      const dependents = manager.getDependents(dep.id);
      expect(dependents).toHaveLength(2);
    });
  });

  describe("decisions", () => {
    it("records a decision linked to a task", () => {
      const task = manager.create({ title: "Task", createdBy: "a" });
      const decision = manager.recordDecision({
        title: "Use SQLite",
        reasoning: "Local-first, zero setup",
        outcome: "Adopted SQLite as primary store",
        taskId: task.id,
        agentId: "agent-a",
      });

      expect(decision.id).toBeTruthy();
      expect(decision.taskId).toBe(task.id);

      const decisions = manager.getDecisions(task.id);
      expect(decisions).toHaveLength(1);
      expect(decisions[0].title).toBe("Use SQLite");
    });

    it("records a standalone decision", () => {
      const decision = manager.recordDecision({
        title: "Architecture decision",
        reasoning: "Performance requirements",
        agentId: "agent-a",
      });

      expect(decision.taskId).toBeNull();
    });
  });

  describe("stats", () => {
    it("returns correct counts", () => {
      manager.create({ title: "T1", createdBy: "a", assignedTo: "b" });
      manager.create({ title: "T2", createdBy: "a", assignedTo: "b" });
      const t3 = manager.create({ title: "T3", createdBy: "a" });
      manager.update(t3.id, { status: "in_progress" });

      const stats = manager.stats();
      expect(stats.total).toBe(3);
      expect(stats.byStatus.open).toBe(2);
      expect(stats.byStatus.in_progress).toBe(1);
      expect(stats.byAgent.b).toBe(2);
    });
  });
});
