export interface RrfOptions { k: number; }

/** Reciprocal Rank Fusion: score(id) = Σ 1/(k + rank). Returns ids best-first. */
export function fuseRrf(rankedLists: string[][], opts: RrfOptions): string[] {
  const scores = new Map<string, number>();
  for (const list of rankedLists) {
    list.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (opts.k + rank + 1));
    });
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
