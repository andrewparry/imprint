/**
 * Reciprocal Rank Fusion (RRF) to merge results from multiple search backends.
 *
 * RRF score = sum(1 / (k + rank_i)) for each result list containing the item.
 * This is a robust, parameter-light fusion method.
 */

export interface RankedItem {
  id: string;
  vectorScore: number;
  bm25Score: number;
  fusedScore: number;
}

const RRF_K = 60; // Standard RRF constant

export function reciprocalRankFusion(
  vectorResults: Array<{ id: string; score: number }>,
  bm25Results: Array<{ id: string; score: number }>,
): RankedItem[] {
  const scores = new Map<
    string,
    { vectorScore: number; bm25Score: number; rrfScore: number }
  >();

  // Process vector results
  for (let rank = 0; rank < vectorResults.length; rank++) {
    const item = vectorResults[rank];
    const existing = scores.get(item.id) ?? {
      vectorScore: 0,
      bm25Score: 0,
      rrfScore: 0,
    };
    existing.vectorScore = item.score;
    existing.rrfScore += 1 / (RRF_K + rank + 1);
    scores.set(item.id, existing);
  }

  // Process BM25 results
  for (let rank = 0; rank < bm25Results.length; rank++) {
    const item = bm25Results[rank];
    const existing = scores.get(item.id) ?? {
      vectorScore: 0,
      bm25Score: 0,
      rrfScore: 0,
    };
    existing.bm25Score = item.score;
    existing.rrfScore += 1 / (RRF_K + rank + 1);
    scores.set(item.id, existing);
  }

  // Convert to array and normalize RRF scores
  const items: RankedItem[] = [];
  let maxRrf = 0;

  for (const [id, data] of scores) {
    if (data.rrfScore > maxRrf) maxRrf = data.rrfScore;
    items.push({
      id,
      vectorScore: data.vectorScore,
      bm25Score: data.bm25Score,
      fusedScore: data.rrfScore,
    });
  }

  // Normalize to [0, 1]
  if (maxRrf > 0) {
    for (const item of items) {
      item.fusedScore /= maxRrf;
    }
  }

  // Sort by fused score descending
  items.sort((a, b) => b.fusedScore - a.fusedScore);

  return items;
}
