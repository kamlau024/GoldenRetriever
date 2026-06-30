export interface RerankHit { index: number; score: number; }

/**
 * Parse a reranker model's "most-relevant-first" reply — 1-based passage numbers like
 * `"3, 1, 5"` — into ordered hits. Out-of-range and duplicate numbers are ignored; passages the
 * model omitted are appended at the end with ~0 score, so the caller always gets a full, stable
 * ordering even if the model drops or mangles some indices.
 */
export function rankFromList(reply: string, n: number): RerankHit[] {
  const seen = new Set<number>();
  const out: RerankHit[] = [];
  for (const m of reply.match(/\d+/g) ?? []) {
    const index = Number(m) - 1; // reply is 1-based
    if (index >= 0 && index < n && !seen.has(index)) {
      seen.add(index);
      out.push({ index, score: 1 - out.length * 1e-3 });
    }
  }
  for (let i = 0; i < n; i++) if (!seen.has(i)) out.push({ index: i, score: 1e-6 * (n - i) });
  return out;
}
