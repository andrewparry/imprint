import { describe, it, expect, beforeEach } from "vitest";
import { LRUCache } from "../../src/memory/cache.js";
import type { MemoryRecord } from "../../src/memory/types.js";

function makeRecord(id: string, layer: string = "semantic"): MemoryRecord {
  return {
    id,
    layer: layer as MemoryRecord["layer"],
    agentId: "default",
    sessionId: null,
    content: `test content ${id}`,
    summary: null,
    metadata: {},
    importance: 0.5,
    accessCount: 0,
    contentHash: `hash-${id}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastAccessed: new Date().toISOString(),
    expiresAt: null,
    isArchived: false,
    sourceType: null,
    parentId: null,
  };
}

describe("LRUCache", () => {
  let cache: LRUCache;

  beforeEach(() => {
    cache = new LRUCache(5);
  });

  it("stores and retrieves records", () => {
    const record = makeRecord("1");
    cache.set(record);
    expect(cache.get("1")).toEqual(record);
  });

  it("returns null for missing records", () => {
    expect(cache.get("nonexistent")).toBeNull();
  });

  it("evicts oldest entry when at capacity", () => {
    for (let i = 1; i <= 6; i++) {
      cache.set(makeRecord(String(i)));
    }
    expect(cache.get("1")).toBeNull(); // evicted
    expect(cache.get("6")).not.toBeNull(); // still there
    expect(cache.size()).toBe(5);
  });

  it("moves accessed entries to end (LRU)", () => {
    for (let i = 1; i <= 5; i++) {
      cache.set(makeRecord(String(i)));
    }

    // Access "1" to make it recently used
    cache.get("1");

    // Add new entry, should evict "2" (least recently used)
    cache.set(makeRecord("6"));
    expect(cache.get("1")).not.toBeNull();
    expect(cache.get("2")).toBeNull();
  });

  it("respects TTL", async () => {
    const record = makeRecord("1");
    cache.set(record, 1); // 1ms TTL
    // Wait for expiry
    await new Promise((r) => setTimeout(r, 5));
    expect(cache.get("1")).toBeNull();
  });

  it("returns records by layer", () => {
    cache.set(makeRecord("1", "soul"));
    cache.set(makeRecord("2", "project"));
    cache.set(makeRecord("3", "soul"));

    const souls = cache.getByLayer("soul");
    expect(souls).toHaveLength(2);
    expect(souls.map((r) => r.id).sort()).toEqual(["1", "3"]);
  });

  it("clears by layer", () => {
    cache.set(makeRecord("1", "soul"));
    cache.set(makeRecord("2", "project"));
    cache.set(makeRecord("3", "soul"));

    const cleared = cache.clearLayer("soul");
    expect(cleared).toBe(2);
    expect(cache.size()).toBe(1);
    expect(cache.get("2")).not.toBeNull();
  });

  it("tracks hit rate", () => {
    cache.set(makeRecord("1"));
    cache.get("1"); // hit
    cache.get("2"); // miss

    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe(0.5);
  });

  it("deletes specific entries", () => {
    cache.set(makeRecord("1"));
    expect(cache.delete("1")).toBe(true);
    expect(cache.get("1")).toBeNull();
    expect(cache.delete("nonexistent")).toBe(false);
  });

  it("clears all entries", () => {
    cache.set(makeRecord("1"));
    cache.set(makeRecord("2"));
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});
