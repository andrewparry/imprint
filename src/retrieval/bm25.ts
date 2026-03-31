import type Database from "better-sqlite3";

export interface BM25Result {
  id: string;
  rowid: number;
  rank: number;
  score: number;
  snippet: string;
}

/**
 * Build an FTS5 query from natural language.
 * Tokenizes input and combines with AND for better precision.
 */
export function buildFtsQuery(raw: string): string | null {
  const tokens = raw
    .match(/[\p{L}\p{N}_]+/gu)
    ?.map((t) => t.trim())
    .filter(Boolean);
  if (!tokens || tokens.length === 0) return null;

  // Quote each token and combine with OR for broader recall
  const quoted = tokens.map((t) => `"${t.replaceAll('"', "")}"`);
  return quoted.join(" OR ");
}

/**
 * Convert FTS5 BM25 rank to a 0-1 similarity score.
 * FTS5 rank() returns negative values where more negative = more relevant.
 */
export function rankToScore(rank: number): number {
  if (!Number.isFinite(rank)) return 0;
  if (rank < 0) {
    const relevance = -rank;
    return relevance / (1 + relevance);
  }
  return 1 / (1 + rank);
}

export interface BM25SearchOptions {
  query: string;
  limit: number;
  layerFilter?: string[];
  agentFilter?: string;
  minImportance?: number;
  excludeArchived?: boolean;
  timeAfter?: string;
  timeBefore?: string;
}

/**
 * Search memories using FTS5 BM25 ranking.
 */
export function searchBM25(
  db: Database.Database,
  options: BM25SearchOptions,
): BM25Result[] {
  const ftsQuery = buildFtsQuery(options.query);
  if (!ftsQuery) return [];

  const conditions: string[] = ["memories_fts MATCH ?"];
  const params: (string | number)[] = [ftsQuery];

  if (options.layerFilter && options.layerFilter.length > 0) {
    const placeholders = options.layerFilter.map(() => "?").join(",");
    conditions.push(`m.layer IN (${placeholders})`);
    params.push(...options.layerFilter);
  }

  if (options.agentFilter) {
    conditions.push("m.agent_id = ?");
    params.push(options.agentFilter);
  }

  if (options.minImportance !== undefined) {
    conditions.push("m.importance >= ?");
    params.push(options.minImportance);
  }

  if (options.excludeArchived !== false) {
    conditions.push("m.is_archived = 0");
  }

  if (options.timeAfter) {
    conditions.push("m.created_at >= ?");
    params.push(options.timeAfter);
  }

  if (options.timeBefore) {
    conditions.push("m.created_at <= ?");
    params.push(options.timeBefore);
  }

  params.push(options.limit);

  const sql = `
    SELECT m.id, m.rowid, rank as rank_val,
           snippet(memories_fts, 0, '<b>', '</b>', '...', 32) as snippet
    FROM memories m
    JOIN memories_fts ON memories_fts.rowid = m.rowid
    WHERE ${conditions.join(" AND ")}
    ORDER BY rank
    LIMIT ?
  `;

  const rows = db.prepare(sql).all(...params) as Array<{
    id: string;
    rowid: number;
    rank_val: number;
    snippet: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    rowid: row.rowid,
    rank: row.rank_val,
    score: rankToScore(row.rank_val),
    snippet: row.snippet,
  }));
}
