import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SCHEMA_VERSION = 1;

export interface ImprintDatabase {
  db: Database.Database;
  close(): void;
}

export function openDatabase(dbPath: string): ImprintDatabase {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  // Performance-critical PRAGMAs
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -64000"); // 64MB cache
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.pragma("temp_store = MEMORY");
  db.pragma("mmap_size = 268435456"); // 256MB mmap

  return {
    db,
    close() {
      db.close();
    },
  };
}

export function openInMemoryDatabase(): ImprintDatabase {
  const db = new Database(":memory:");

  db.pragma("foreign_keys = ON");
  db.pragma("temp_store = MEMORY");

  return {
    db,
    close() {
      db.close();
    },
  };
}

export function initializeSchema(database: ImprintDatabase): void {
  const { db } = database;

  // Check current schema version
  const hasVersionTable = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
    )
    .get();

  if (hasVersionTable) {
    const row = db
      .prepare("SELECT MAX(version) as version FROM schema_version")
      .get() as { version: number } | undefined;
    if (row && row.version >= SCHEMA_VERSION) {
      return; // Already up to date
    }
  }

  // Read and execute schema
  const schemaPath = resolve(import.meta.dirname, "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");

  db.exec(schema);

  // Record version
  db.prepare(
    "INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)",
  ).run(SCHEMA_VERSION, new Date().toISOString());
}

export function loadSqliteVec(database: ImprintDatabase, dimensions: number): void {
  try {
    const sqliteVec = await_import_sqlite_vec();
    sqliteVec.load(database.db);

    // Create vector table if not exists
    database.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
        memory_id TEXT PRIMARY KEY,
        embedding float[${dimensions}]
      )
    `);
  } catch {
    // sqlite-vec not available; vector search will be disabled
  }
}

// Synchronous wrapper for sqlite-vec dynamic import
function await_import_sqlite_vec(): { load: (db: Database.Database) => void } {
  // sqlite-vec ships a load() function for better-sqlite3
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("sqlite-vec");
}

export function getDatabaseSize(db: Database.Database): number {
  const row = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get() as { size: number };
  return row?.size ?? 0;
}
