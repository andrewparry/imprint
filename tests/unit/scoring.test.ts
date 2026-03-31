import { describe, it, expect } from "vitest";
import {
  recencyDecay,
  compositeScore,
  computeScore,
} from "../../src/memory/scoring.js";

describe("recencyDecay", () => {
  it("returns 1.0 for 0 days", () => {
    expect(recencyDecay(0, 30)).toBe(1.0);
  });

  it("returns ~0.5 at half-life", () => {
    const result = recencyDecay(30, 30);
    expect(result).toBeCloseTo(0.5, 5);
  });

  it("returns ~0.25 at 2x half-life", () => {
    const result = recencyDecay(60, 30);
    expect(result).toBeCloseTo(0.25, 5);
  });

  it("returns 1.0 for non-positive half-life", () => {
    expect(recencyDecay(10, 0)).toBe(1);
    expect(recencyDecay(10, -5)).toBe(1);
  });

  it("returns 1.0 for negative days (clamped to 0)", () => {
    expect(recencyDecay(-5, 30)).toBe(1.0);
  });

  it("handles very large days gracefully", () => {
    const result = recencyDecay(10000, 30);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(0.001);
  });
});

describe("compositeScore", () => {
  it("computes weighted sum correctly", () => {
    const result = compositeScore(0.8, 0.6, 0.9, {
      similarity: 0.5,
      recency: 0.3,
      importance: 0.2,
    });
    // 0.8*0.5 + 0.6*0.3 + 0.9*0.2 = 0.4 + 0.18 + 0.18 = 0.76
    expect(result).toBeCloseTo(0.76, 5);
  });

  it("returns 0 when all inputs are 0", () => {
    expect(
      compositeScore(0, 0, 0, { similarity: 0.5, recency: 0.3, importance: 0.2 }),
    ).toBe(0);
  });

  it("returns max when all inputs are 1", () => {
    expect(
      compositeScore(1, 1, 1, { similarity: 0.5, recency: 0.3, importance: 0.2 }),
    ).toBeCloseTo(1.0, 5);
  });
});

describe("computeScore", () => {
  it("computes full score with real timestamps", () => {
    const now = Date.now();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const score = computeScore({
      similarityScore: 0.9,
      lastAccessedAt: oneDayAgo,
      importance: 0.7,
      config: {
        similarity: 0.5,
        recency: 0.3,
        importance: 0.2,
        halfLifeDays: 30,
      },
      nowMs: now,
    });

    // Similarity contribution: 0.9 * 0.5 = 0.45
    // Recency (1 day, 30 day half-life): ~0.977 * 0.3 ≈ 0.293
    // Importance: 0.7 * 0.2 = 0.14
    expect(score).toBeGreaterThan(0.8);
    expect(score).toBeLessThan(1.0);
  });

  it("penalizes old memories", () => {
    const now = Date.now();
    const recent = new Date(now - 1000).toISOString();
    const old = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();

    const config = {
      similarity: 0.5,
      recency: 0.3,
      importance: 0.2,
      halfLifeDays: 30,
    };

    const recentScore = computeScore({
      similarityScore: 0.8,
      lastAccessedAt: recent,
      importance: 0.5,
      config,
      nowMs: now,
    });

    const oldScore = computeScore({
      similarityScore: 0.8,
      lastAccessedAt: old,
      importance: 0.5,
      config,
      nowMs: now,
    });

    expect(recentScore).toBeGreaterThan(oldScore);
  });
});
