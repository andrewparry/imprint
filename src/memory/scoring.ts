import type { ScoringConfig } from "../config.js";

export interface ScoringWeights {
  similarity: number;
  recency: number;
  importance: number;
}

/**
 * Compute exponential decay multiplier for recency scoring.
 * recency = exp(-ln(2) / halfLifeDays * daysSinceAccess)
 *
 * At halfLifeDays, the multiplier is 0.5.
 * At 0 days, the multiplier is 1.0.
 */
export function recencyDecay(daysSinceAccess: number, halfLifeDays: number): number {
  if (halfLifeDays <= 0 || !Number.isFinite(daysSinceAccess)) return 1;
  const lambda = Math.LN2 / halfLifeDays;
  return Math.exp(-lambda * Math.max(0, daysSinceAccess));
}

/**
 * Compute composite score from similarity, recency, and importance.
 * All inputs should be in [0, 1].
 */
export function compositeScore(
  similarity: number,
  recency: number,
  importance: number,
  weights: ScoringWeights,
): number {
  return (
    similarity * weights.similarity +
    recency * weights.recency +
    importance * weights.importance
  );
}

/**
 * Compute full composite score given raw inputs.
 */
export function computeScore(params: {
  similarityScore: number;
  lastAccessedAt: string;
  importance: number;
  config: ScoringConfig;
  nowMs?: number;
}): number {
  const nowMs = params.nowMs ?? Date.now();
  const accessedMs = new Date(params.lastAccessedAt).getTime();
  const daysSinceAccess = (nowMs - accessedMs) / (1000 * 60 * 60 * 24);

  const recency = recencyDecay(daysSinceAccess, params.config.halfLifeDays);

  return compositeScore(params.similarityScore, recency, params.importance, {
    similarity: params.config.similarity,
    recency: params.config.recency,
    importance: params.config.importance,
  });
}
