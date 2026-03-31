import type { MemoryRecord, MemoryLayer } from "./types.js";

interface CacheEntry {
  record: MemoryRecord;
  insertedAt: number;
  ttlMs: number | null; // null = infinite
}

const DEFAULT_TTL: Record<MemoryLayer, number | null> = {
  soul: null, // infinite
  project: 3600_000, // 1 hour
  session: null, // managed by session lifecycle
  episodic: 1800_000, // 30 min
  semantic: 3600_000, // 1 hour
  procedural: 3600_000, // 1 hour
};

export class LRUCache {
  private map = new Map<string, CacheEntry>();
  private maxEntries: number;
  private hits = 0;
  private misses = 0;

  constructor(maxEntries: number = 1000) {
    this.maxEntries = maxEntries;
  }

  get(id: string): MemoryRecord | null {
    const entry = this.map.get(id);
    if (!entry) {
      this.misses++;
      return null;
    }

    // Check TTL
    if (entry.ttlMs !== null && Date.now() - entry.insertedAt > entry.ttlMs) {
      this.map.delete(id);
      this.misses++;
      return null;
    }

    // Move to end (most recently used)
    this.map.delete(id);
    this.map.set(id, entry);
    this.hits++;
    return entry.record;
  }

  set(record: MemoryRecord, ttlMs?: number | null): void {
    // Remove existing entry if present
    this.map.delete(record.id);

    // Evict oldest if at capacity
    if (this.map.size >= this.maxEntries) {
      const firstKey = this.map.keys().next().value!;
      this.map.delete(firstKey);
    }

    this.map.set(record.id, {
      record,
      insertedAt: Date.now(),
      ttlMs: ttlMs !== undefined ? ttlMs : DEFAULT_TTL[record.layer],
    });
  }

  delete(id: string): boolean {
    return this.map.delete(id);
  }

  getByLayer(layer: MemoryLayer, agentId?: string): MemoryRecord[] {
    const results: MemoryRecord[] = [];
    const now = Date.now();

    for (const [, entry] of this.map) {
      if (entry.record.layer !== layer) continue;
      if (agentId && entry.record.agentId !== agentId) continue;
      if (entry.ttlMs !== null && now - entry.insertedAt > entry.ttlMs) continue;
      results.push(entry.record);
    }

    return results;
  }

  clearLayer(layer: MemoryLayer, agentId?: string): number {
    let count = 0;
    for (const [id, entry] of this.map) {
      if (entry.record.layer !== layer) continue;
      if (agentId && entry.record.agentId !== agentId) continue;
      this.map.delete(id);
      count++;
    }
    return count;
  }

  clearSession(sessionId: string): number {
    let count = 0;
    for (const [id, entry] of this.map) {
      if (entry.record.sessionId === sessionId) {
        this.map.delete(id);
        count++;
      }
    }
    return count;
  }

  clear(): void {
    this.map.clear();
    this.hits = 0;
    this.misses = 0;
  }

  size(): number {
    return this.map.size;
  }

  hitRate(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }

  stats() {
    return {
      entries: this.map.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hitRate(),
    };
  }
}
