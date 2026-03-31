import type Database from "better-sqlite3";

export interface VectorResult {
  memoryId: string;
  distance: number;
  score: number;
}

/**
 * Check if the memories_vec table exists (sqlite-vec loaded successfully).
 */
export function hasVectorTable(db: Database.Database): boolean {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_vec'",
    )
    .get();
  return !!row;
}

/**
 * Insert an embedding into the vector table.
 */
export function insertEmbedding(
  db: Database.Database,
  memoryId: string,
  embedding: Float32Array,
): void {
  if (!hasVectorTable(db)) return;

  db.prepare(
    "INSERT OR REPLACE INTO memories_vec (memory_id, embedding) VALUES (?, ?)",
  ).run(memoryId, Buffer.from(embedding.buffer));
}

/**
 * Delete an embedding from the vector table.
 */
export function deleteEmbedding(
  db: Database.Database,
  memoryId: string,
): void {
  if (!hasVectorTable(db)) return;

  db.prepare("DELETE FROM memories_vec WHERE memory_id = ?").run(memoryId);
}

export interface VectorSearchOptions {
  embedding: Float32Array;
  limit: number;
  layerFilter?: string[];
  agentFilter?: string;
  excludeArchived?: boolean;
}

/**
 * Search memories using vector similarity (sqlite-vec).
 * Falls back to empty results if sqlite-vec is not available.
 */
export function searchVector(
  db: Database.Database,
  options: VectorSearchOptions,
): VectorResult[] {
  if (!hasVectorTable(db)) return [];

  // sqlite-vec uses KNN query syntax
  // We need to join with the memories table for filtering
  const embeddingBuffer = Buffer.from(options.embedding.buffer);

  let sql: string;
  const params: (Buffer | string | number)[] = [embeddingBuffer, options.limit * 3]; // over-fetch for post-filter

  if (options.layerFilter || options.agentFilter || options.excludeArchived !== false) {
    // Fetch more results from vec and post-filter via JOIN
    sql = `
      SELECT v.memory_id, v.distance
      FROM memories_vec v
      JOIN memories m ON m.id = v.memory_id
      WHERE v.embedding MATCH ?
        AND k = ?
    `;

    const conditions: string[] = [];
    if (options.layerFilter && options.layerFilter.length > 0) {
      const placeholders = options.layerFilter.map(() => "?").join(",");
      conditions.push(`m.layer IN (${placeholders})`);
      params.push(...options.layerFilter);
    }
    if (options.agentFilter) {
      conditions.push("m.agent_id = ?");
      params.push(options.agentFilter);
    }
    if (options.excludeArchived !== false) {
      conditions.push("m.is_archived = 0");
    }

    if (conditions.length > 0) {
      sql += ` AND ${conditions.join(" AND ")}`;
    }

    sql += ` LIMIT ?`;
    params.push(options.limit);
  } else {
    sql = `
      SELECT memory_id, distance
      FROM memories_vec
      WHERE embedding MATCH ?
        AND k = ?
    `;
    params.push(options.limit);
    sql = `SELECT memory_id, distance FROM memories_vec WHERE embedding MATCH ? AND k = ? LIMIT ?`;
    params[1] = options.limit;
  }

  try {
    const rows = db.prepare(sql).all(...params) as Array<{
      memory_id: string;
      distance: number;
    }>;

    return rows.map((row) => ({
      memoryId: row.memory_id,
      distance: row.distance,
      score: 1 / (1 + row.distance), // Convert L2 distance to similarity
    }));
  } catch {
    return [];
  }
}
