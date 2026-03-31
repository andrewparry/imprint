-- Imprint: Multi-Layered Memory & Task System for OpenClaw
-- Schema version: 1

-- ============================================================================
-- Memory System
-- ============================================================================

CREATE TABLE IF NOT EXISTS memories (
  id            TEXT PRIMARY KEY,
  layer         TEXT NOT NULL CHECK(layer IN ('soul','project','session','episodic','semantic','procedural')),
  agent_id      TEXT NOT NULL DEFAULT 'default',
  session_id    TEXT,
  content       TEXT NOT NULL,
  summary       TEXT,
  metadata      TEXT NOT NULL DEFAULT '{}',
  importance    REAL NOT NULL DEFAULT 0.5 CHECK(importance >= 0.0 AND importance <= 1.0),
  access_count  INTEGER NOT NULL DEFAULT 0,
  content_hash  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_accessed TEXT NOT NULL,
  expires_at    TEXT,
  is_archived   INTEGER NOT NULL DEFAULT 0,
  source_type   TEXT CHECK(source_type IN ('user','agent','system','migration') OR source_type IS NULL),
  parent_id     TEXT REFERENCES memories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_mem_layer_agent ON memories(layer, agent_id);
CREATE INDEX IF NOT EXISTS idx_mem_session ON memories(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mem_importance ON memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_mem_created ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mem_hash ON memories(content_hash);
CREATE INDEX IF NOT EXISTS idx_mem_active ON memories(is_archived, layer, agent_id) WHERE is_archived = 0;

-- FTS5 full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  summary,
  metadata,
  content=memories,
  content_rowid=rowid,
  tokenize='porter unicode61'
);

-- Triggers to keep FTS in sync with memories table
CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, summary, metadata)
  VALUES (new.rowid, new.content, new.summary, new.metadata);
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, summary, metadata)
  VALUES ('delete', old.rowid, old.content, old.summary, old.metadata);
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, summary, metadata)
  VALUES ('delete', old.rowid, old.content, old.summary, old.metadata);
  INSERT INTO memories_fts(rowid, content, summary, metadata)
  VALUES (new.rowid, new.content, new.summary, new.metadata);
END;

-- ============================================================================
-- Task System
-- ============================================================================

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','blocked','done','cancelled')),
  priority      INTEGER NOT NULL DEFAULT 2 CHECK(priority >= 0 AND priority <= 3),
  created_by    TEXT NOT NULL,
  assigned_to   TEXT,
  deadline      TEXT,
  completed_at  TEXT,
  metadata      TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_task_assigned ON tasks(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_priority ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_task_created_by ON tasks(created_by);

-- FTS5 for task search
CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
  title,
  description,
  content=tasks,
  content_rowid=rowid,
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS tasks_fts_insert AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(rowid, title, description)
  VALUES (new.rowid, new.title, new.description);
END;

CREATE TRIGGER IF NOT EXISTS tasks_fts_delete AFTER DELETE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description)
  VALUES ('delete', old.rowid, old.title, old.description);
END;

CREATE TRIGGER IF NOT EXISTS tasks_fts_update AFTER UPDATE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description)
  VALUES ('delete', old.rowid, old.title, old.description);
  INSERT INTO tasks_fts(rowid, title, description)
  VALUES (new.rowid, new.title, new.description);
END;

-- Task dependencies
CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_id)
);

-- Decisions
CREATE TABLE IF NOT EXISTS decisions (
  id          TEXT PRIMARY KEY,
  task_id     TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  reasoning   TEXT NOT NULL,
  outcome     TEXT,
  agent_id    TEXT NOT NULL,
  context     TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dec_task ON decisions(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dec_agent ON decisions(agent_id);

-- ============================================================================
-- Migration tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS migration_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path   TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  migrated_at TEXT NOT NULL,
  records_created INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_migration_path ON migration_log(file_path);

-- ============================================================================
-- Schema versioning
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL
);
