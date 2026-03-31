import type Database from "better-sqlite3";
import type { ScoringConfig } from "../config.js";
import type { EmbeddingService } from "../memory/embeddings.js";
import type { MemoryRecord, RankedMemory, RecallQuery } from "../memory/types.js";
import { computeScore } from "../memory/scoring.js";
import { searchBM25 } from "./bm25.js";
import { searchVector } from "./vector.js";
import { reciprocalRankFusion } from "./ranker.js";

export interface RetrievalPipelineConfig {
  db: Database.Database;
  embeddings: EmbeddingService;
  scoring: ScoringConfig;
  defaultLimit: number;
}

/**
 * Full hybrid retrieval pipeline:
 * 1. Generate query embedding
 * 2. Parallel: sqlite-vec top-K + FTS5 BM25 top-K
 * 3. Reciprocal Rank Fusion
 * 4. Apply composite scoring (similarity + recency + importance)
 * 5. Return top-N ranked results
 */
export async function retrieve(
  config: RetrievalPipelineConfig,
  query: RecallQuery,
): Promise<RankedMemory[]> {
  const limit = query.limit ?? config.defaultLimit;
  const fetchLimit = limit * 3; // Over-fetch for scoring/re-ranking

  // 1. Generate query embedding
  const queryEmbedding = await config.embeddings.embed(query.query);

  // 2. Run vector search and BM25 search (sequential since SQLite is single-writer)
  const vectorResults = searchVector(config.db, {
    embedding: queryEmbedding,
    limit: fetchLimit,
    layerFilter: query.layers,
    agentFilter: query.agentId,
    excludeArchived: !query.includeArchived,
  });

  const bm25Results = searchBM25(config.db, {
    query: query.query,
    limit: fetchLimit,
    layerFilter: query.layers,
    agentFilter: query.agentId,
    minImportance: query.minImportance,
    excludeArchived: !query.includeArchived,
    timeAfter: query.timeRange?.after,
    timeBefore: query.timeRange?.before,
  });

  // 3. Reciprocal Rank Fusion
  const fused = reciprocalRankFusion(
    vectorResults.map((r) => ({ id: r.memoryId, score: r.score })),
    bm25Results.map((r) => ({ id: r.id, score: r.score })),
  );

  if (fused.length === 0) return [];

  // 4. Fetch full memory records for fused results
  const ids = fused.slice(0, fetchLimit).map((r) => r.id);
  const recordMap = fetchMemoryRecords(config.db, ids);

  // 5. Apply composite scoring
  const ranked: RankedMemory[] = [];

  for (const item of fused) {
    const record = recordMap.get(item.id);
    if (!record) continue;

    // Apply time range filter (if vector search didn't filter)
    if (query.timeRange?.after && record.createdAt < query.timeRange.after) continue;
    if (query.timeRange?.before && record.createdAt > query.timeRange.before) continue;
    if (query.minImportance && record.importance < query.minImportance) continue;

    const score = computeScore({
      similarityScore: item.fusedScore,
      lastAccessedAt: record.lastAccessed,
      importance: record.importance,
      config: config.scoring,
    });

    ranked.push({
      record,
      score,
      vectorScore: item.vectorScore,
      bm25Score: item.bm25Score,
      recencyScore: score - item.fusedScore * config.scoring.similarity - record.importance * config.scoring.importance,
    });
  }

  // Sort by composite score
  ranked.sort((a, b) => b.score - a.score);

  // Update access counts for returned results
  const returnedIds = ranked.slice(0, limit).map((r) => r.record.id);
  if (returnedIds.length > 0) {
    updateAccessCounts(config.db, returnedIds);
  }

  return ranked.slice(0, limit);
}

function fetchMemoryRecords(
  db: Database.Database,
  ids: string[],
): Map<string, MemoryRecord> {
  if (ids.length === 0) return new Map();

  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT * FROM memories WHERE id IN (${placeholders})`,
    )
    .all(...ids) as Array<Record<string, unknown>>;

  const map = new Map<string, MemoryRecord>();
  for (const row of rows) {
    const record = rowToMemoryRecord(row);
    map.set(record.id, record);
  }
  return map;
}

function updateAccessCounts(db: Database.Database, ids: string[]): void {
  const now = new Date().toISOString();
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(
    `UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id IN (${placeholders})`,
  ).run(now, ...ids);
}

export function rowToMemoryRecord(row: Record<string, unknown>): MemoryRecord {
  return {
    id: row.id as string,
    layer: row.layer as MemoryRecord["layer"],
    agentId: row.agent_id as string,
    sessionId: (row.session_id as string) ?? null,
    content: row.content as string,
    summary: (row.summary as string) ?? null,
    metadata: JSON.parse((row.metadata as string) || "{}"),
    importance: row.importance as number,
    accessCount: row.access_count as number,
    contentHash: row.content_hash as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    lastAccessed: row.last_accessed as string,
    expiresAt: (row.expires_at as string) ?? null,
    isArchived: !!(row.is_archived as number),
    sourceType: (row.source_type as MemoryRecord["sourceType"]) ?? null,
    parentId: (row.parent_id as string) ?? null,
  };
}
