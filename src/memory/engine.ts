import type Database from "better-sqlite3";
import type { ImprintConfig } from "../config.js";
import type { EmbeddingService } from "./embeddings.js";
import { LRUCache } from "./cache.js";
import type {
  MemoryRecord,
  EncodeInput,
  RecallQuery,
  RankedMemory,
  ConsolidateOptions,
  ConsolidateResult,
  ForgetCriteria,
  MemoryStats,
  MemoryLayer,
} from "./types.js";
import { MEMORY_LAYERS } from "./types.js";
import {
  validateEncodeInput,
  applyLayerDefaults,
  computeExpiresAt,
} from "./layers.js";
import { contentHash } from "../utils/hashing.js";
import { generateId, now } from "../utils/time.js";
import { retrieve, rowToMemoryRecord } from "../retrieval/pipeline.js";
import { insertEmbedding, deleteEmbedding, searchVector } from "../retrieval/vector.js";
import { getDatabaseSize } from "../db/connection.js";

export class MemoryEngine {
  private db: Database.Database;
  private embeddings: EmbeddingService;
  private cache: LRUCache;
  private config: ImprintConfig;
  private vecAvailable: boolean;

  constructor(
    db: Database.Database,
    embeddings: EmbeddingService,
    config: ImprintConfig,
  ) {
    this.db = db;
    this.embeddings = embeddings;
    this.config = config;
    this.cache = new LRUCache(config.cache.maxEntries);

    // Check if vector table exists
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_vec'",
      )
      .get();
    this.vecAvailable = !!row;
  }

  /**
   * Encode: Store a new memory.
   * 1. Validate input and apply layer defaults
   * 2. Check for exact duplicates (content hash)
   * 3. Generate embedding and check for near-duplicates
   * 4. Insert into memories + FTS + vec + L1 cache
   */
  async encode(input: EncodeInput): Promise<MemoryRecord> {
    const validationError = validateEncodeInput(input);
    if (validationError) throw new Error(validationError);

    const enriched = applyLayerDefaults(input);
    const hash = contentHash(enriched.content);

    // Check exact duplicate
    const existing = this.db
      .prepare(
        "SELECT * FROM memories WHERE content_hash = ? AND layer = ? AND agent_id = ? AND is_archived = 0",
      )
      .get(hash, enriched.layer, enriched.agentId ?? "default") as
      | Record<string, unknown>
      | undefined;

    if (existing) {
      // Update access count and return existing
      const record = rowToMemoryRecord(existing);
      this.db
        .prepare(
          "UPDATE memories SET access_count = access_count + 1, last_accessed = ?, updated_at = ? WHERE id = ?",
        )
        .run(now(), now(), record.id);
      record.accessCount++;
      record.lastAccessed = now();
      this.cache.set(record);
      return record;
    }

    // Generate embedding for near-duplicate check and storage
    let embedding: Float32Array | null = null;
    if (this.embeddings.isReady() || this.vecAvailable) {
      try {
        embedding = await this.embeddings.embed(enriched.content);

        // Check near-duplicates via vector search
        if (this.vecAvailable) {
          const similar = searchVector(this.db, {
            embedding,
            limit: 1,
            layerFilter: [enriched.layer],
            agentFilter: enriched.agentId,
          });

          if (similar.length > 0 && similar[0].score > 0.85) {
            // Near-duplicate found: update existing instead
            const existingRecord = this.db
              .prepare("SELECT * FROM memories WHERE id = ?")
              .get(similar[0].memoryId) as Record<string, unknown> | undefined;

            if (existingRecord) {
              const record = rowToMemoryRecord(existingRecord);
              const mergedImportance = Math.max(
                record.importance,
                enriched.importance ?? 0.5,
              );
              this.db
                .prepare(
                  "UPDATE memories SET importance = ?, access_count = access_count + 1, last_accessed = ?, updated_at = ? WHERE id = ?",
                )
                .run(mergedImportance, now(), now(), record.id);
              record.importance = mergedImportance;
              record.lastAccessed = now();
              this.cache.set(record);
              return record;
            }
          }
        }
      } catch {
        // Embedding not ready yet; proceed without vector search
      }
    }

    // Insert new memory
    const id = generateId();
    const timestamp = now();
    const expiresAt = computeExpiresAt(enriched.layer);
    const metadata = JSON.stringify(enriched.metadata ?? {});

    this.db
      .prepare(
        `INSERT INTO memories (
          id, layer, agent_id, session_id, content, summary, metadata,
          importance, access_count, content_hash, created_at, updated_at,
          last_accessed, expires_at, is_archived, source_type, parent_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        id,
        enriched.layer,
        enriched.agentId ?? "default",
        enriched.sessionId ?? null,
        enriched.content,
        enriched.summary ?? null,
        metadata,
        enriched.importance ?? 0.5,
        hash,
        timestamp,
        timestamp,
        timestamp,
        expiresAt,
        enriched.sourceType ?? null,
        enriched.parentId ?? null,
      );

    // Insert embedding if available
    if (embedding && this.vecAvailable) {
      insertEmbedding(this.db, id, embedding);
    }

    const record: MemoryRecord = {
      id,
      layer: enriched.layer,
      agentId: enriched.agentId ?? "default",
      sessionId: enriched.sessionId ?? null,
      content: enriched.content,
      summary: enriched.summary ?? null,
      metadata: enriched.metadata ?? {},
      importance: enriched.importance ?? 0.5,
      accessCount: 0,
      contentHash: hash,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastAccessed: timestamp,
      expiresAt,
      isArchived: false,
      sourceType: enriched.sourceType ?? null,
      parentId: enriched.parentId ?? null,
    };

    this.cache.set(record);
    return record;
  }

  /**
   * Recall: Retrieve memories by composite query.
   */
  async recall(query: RecallQuery): Promise<RankedMemory[]> {
    return retrieve(
      {
        db: this.db,
        embeddings: this.embeddings,
        scoring: this.config.scoring,
        defaultLimit: 10,
      },
      query,
    );
  }

  /**
   * Get a single memory by ID.
   */
  getById(id: string): MemoryRecord | null {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const row = this.db
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;

    if (!row) return null;

    const record = rowToMemoryRecord(row);
    this.cache.set(record);
    return record;
  }

  /**
   * Get all memories for a specific layer and agent.
   */
  getByLayer(layer: MemoryLayer, agentId: string = "default"): MemoryRecord[] {
    // Try cache first
    const cached = this.cache.getByLayer(layer, agentId);
    if (cached.length > 0) return cached;

    const rows = this.db
      .prepare(
        "SELECT * FROM memories WHERE layer = ? AND agent_id = ? AND is_archived = 0 ORDER BY importance DESC, created_at DESC",
      )
      .all(layer, agentId) as Array<Record<string, unknown>>;

    const records = rows.map(rowToMemoryRecord);
    for (const r of records) this.cache.set(r);
    return records;
  }

  /**
   * Update an existing memory.
   */
  async update(
    id: string,
    updates: {
      content?: string;
      importance?: number;
      metadata?: Record<string, unknown>;
      summary?: string;
    },
  ): Promise<MemoryRecord | null> {
    const existing = this.getById(id);
    if (!existing) return null;

    const sets: string[] = ["updated_at = ?"];
    const params: (string | number)[] = [now()];

    if (updates.content !== undefined) {
      sets.push("content = ?", "content_hash = ?");
      params.push(updates.content, contentHash(updates.content));

      // Update embedding
      if (this.vecAvailable) {
        try {
          const embedding = await this.embeddings.embed(updates.content);
          insertEmbedding(this.db, id, embedding);
        } catch {
          // Embedding update failed; continue
        }
      }
    }

    if (updates.importance !== undefined) {
      sets.push("importance = ?");
      params.push(updates.importance);
    }

    if (updates.metadata !== undefined) {
      sets.push("metadata = ?");
      params.push(JSON.stringify(updates.metadata));
    }

    if (updates.summary !== undefined) {
      sets.push("summary = ?");
      params.push(updates.summary);
    }

    params.push(id);
    this.db
      .prepare(`UPDATE memories SET ${sets.join(", ")} WHERE id = ?`)
      .run(...params);

    this.cache.delete(id);
    return this.getById(id);
  }

  /**
   * Consolidate: Merge near-duplicates, archive old memories.
   */
  async consolidate(
    options?: ConsolidateOptions,
  ): Promise<ConsolidateResult> {
    const result: ConsolidateResult = { merged: 0, archived: 0, deleted: 0 };

    // Archive old, low-access memories
    const archiveDays = this.config.consolidation.archiveAfterDays;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - archiveDays);
    const cutoffStr = cutoff.toISOString();

    let archiveQuery =
      "UPDATE memories SET is_archived = 1 WHERE is_archived = 0 AND last_accessed < ? AND access_count < 3 AND layer NOT IN ('soul', 'project')";
    const archiveParams: (string | number)[] = [cutoffStr];

    if (options?.layers) {
      const placeholders = options.layers.map(() => "?").join(",");
      archiveQuery += ` AND layer IN (${placeholders})`;
      archiveParams.push(...options.layers);
    }

    if (options?.agentId) {
      archiveQuery += " AND agent_id = ?";
      archiveParams.push(options.agentId);
    }

    if (!options?.dryRun) {
      const archiveResult = this.db
        .prepare(archiveQuery)
        .run(...archiveParams);
      result.archived = archiveResult.changes;
    }

    // Delete expired memories
    if (!options?.dryRun) {
      const deleteResult = this.db
        .prepare(
          "DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?",
        )
        .run(now());
      result.deleted = deleteResult.changes;
    }

    return result;
  }

  /**
   * Forget: Remove or archive memories matching criteria.
   */
  forget(criteria: ForgetCriteria): number {
    if (criteria.ids && criteria.ids.length > 0) {
      if (criteria.archive) {
        const placeholders = criteria.ids.map(() => "?").join(",");
        const result = this.db
          .prepare(
            `UPDATE memories SET is_archived = 1 WHERE id IN (${placeholders})`,
          )
          .run(...criteria.ids);
        for (const id of criteria.ids) {
          this.cache.delete(id);
          deleteEmbedding(this.db, id);
        }
        return result.changes;
      } else {
        const placeholders = criteria.ids.map(() => "?").join(",");
        // Delete embeddings first
        for (const id of criteria.ids) {
          deleteEmbedding(this.db, id);
          this.cache.delete(id);
        }
        const result = this.db
          .prepare(`DELETE FROM memories WHERE id IN (${placeholders})`)
          .run(...criteria.ids);
        return result.changes;
      }
    }

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (criteria.layer) {
      conditions.push("layer = ?");
      params.push(criteria.layer);
    }
    if (criteria.agentId) {
      conditions.push("agent_id = ?");
      params.push(criteria.agentId);
    }
    if (criteria.olderThan) {
      conditions.push("created_at < ?");
      params.push(criteria.olderThan);
    }
    if (criteria.maxImportance !== undefined) {
      conditions.push("importance <= ?");
      params.push(criteria.maxImportance);
    }

    if (conditions.length === 0) return 0;

    const where = conditions.join(" AND ");

    if (criteria.archive) {
      const result = this.db
        .prepare(`UPDATE memories SET is_archived = 1 WHERE ${where}`)
        .run(...params);
      return result.changes;
    } else {
      // Get IDs to delete embeddings
      const ids = this.db
        .prepare(`SELECT id FROM memories WHERE ${where}`)
        .all(...params) as Array<{ id: string }>;
      for (const { id } of ids) {
        deleteEmbedding(this.db, id);
        this.cache.delete(id);
      }
      const result = this.db
        .prepare(`DELETE FROM memories WHERE ${where}`)
        .run(...params);
      return result.changes;
    }
  }

  /**
   * Get memory statistics.
   */
  stats(): MemoryStats {
    const total = (
      this.db.prepare("SELECT COUNT(*) as count FROM memories").get() as {
        count: number;
      }
    ).count;

    const byLayer: Record<string, number> = {};
    for (const layer of MEMORY_LAYERS) {
      byLayer[layer] = (
        this.db
          .prepare(
            "SELECT COUNT(*) as count FROM memories WHERE layer = ? AND is_archived = 0",
          )
          .get(layer) as { count: number }
      ).count;
    }

    const agentRows = this.db
      .prepare(
        "SELECT agent_id, COUNT(*) as count FROM memories GROUP BY agent_id",
      )
      .all() as Array<{ agent_id: string; count: number }>;
    const byAgent: Record<string, number> = {};
    for (const row of agentRows) {
      byAgent[row.agent_id] = row.count;
    }

    const archived = (
      this.db
        .prepare(
          "SELECT COUNT(*) as count FROM memories WHERE is_archived = 1",
        )
        .get() as { count: number }
    ).count;

    return {
      total,
      byLayer: byLayer as Record<MemoryLayer, number>,
      byAgent,
      archived,
      dbSizeBytes: getDatabaseSize(this.db),
    };
  }

  getCache(): LRUCache {
    return this.cache;
  }

  getDatabase(): Database.Database {
    return this.db;
  }
}
