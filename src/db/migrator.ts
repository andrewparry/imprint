import type Database from "better-sqlite3";

export interface MigrationRecord {
  filePath: string;
  contentHash: string;
  recordsCreated: number;
}

export function isMigrated(db: Database.Database, filePath: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM migration_log WHERE file_path = ?")
    .get(filePath);
  return !!row;
}

export function recordMigration(
  db: Database.Database,
  record: MigrationRecord,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO migration_log (file_path, content_hash, migrated_at, records_created)
     VALUES (?, ?, ?, ?)`,
  ).run(
    record.filePath,
    record.contentHash,
    new Date().toISOString(),
    record.recordsCreated,
  );
}

export function getMigrationLog(
  db: Database.Database,
): Array<MigrationRecord & { migratedAt: string }> {
  return db
    .prepare(
      "SELECT file_path as filePath, content_hash as contentHash, migrated_at as migratedAt, records_created as recordsCreated FROM migration_log ORDER BY migrated_at DESC",
    )
    .all() as Array<MigrationRecord & { migratedAt: string }>;
}
