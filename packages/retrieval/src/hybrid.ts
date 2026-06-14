import { sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import type { AiClient } from "@gr/ai";
import type { RankedChunk } from "@gr/core";
import { fuseRrf } from "./rrf.js";

type Db = ReturnType<typeof drizzle>;

interface Row {
  [key: string]: unknown;
  chunk_id: string; document_id: string; content: string;
  title: string | null; source_url: string | null; added_by: string; captured_at: Date;
}

const CANDIDATES = 40;
const TOP_K = 8;

export class HybridRetriever {
  constructor(private db: Db, private ai: AiClient) {}

  async retrieve(kbId: string, query: string): Promise<RankedChunk[]> {
    const [queryEmbedding] = await this.ai.embed([query]);
    const vecLiteral = `[${queryEmbedding.join(",")}]`;

    // Dense: cosine distance via pgvector, scoped to kb.
    const dense = await this.db.execute<Row>(sql`
      SELECT c.id AS chunk_id, c.document_id, c.content,
             d.title, d.source_url, d.added_by, d.captured_at
      FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE c.kb_id = ${kbId} AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${vecLiteral}::vector
      LIMIT ${CANDIDATES}`);

    // Sparse: full-text search, scoped to kb.
    const sparse = await this.db.execute<Row>(sql`
      SELECT c.id AS chunk_id, c.document_id, c.content,
             d.title, d.source_url, d.added_by, d.captured_at
      FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE c.kb_id = ${kbId}
        AND c.fts @@ websearch_to_tsquery('english', ${query})
      ORDER BY ts_rank(c.fts, websearch_to_tsquery('english', ${query})) DESC
      LIMIT ${CANDIDATES}`);

    const denseRows = [...dense] as Row[];
    const sparseRows = [...sparse] as Row[];
    const byId = new Map<string, Row>();
    for (const r of [...denseRows, ...sparseRows]) byId.set(r.chunk_id, r);

    const fused = fuseRrf(
      [denseRows.map((r) => r.chunk_id), sparseRows.map((r) => r.chunk_id)],
      { k: 60 },
    ).slice(0, CANDIDATES);
    if (fused.length === 0) return [];

    const reranked = await this.ai.rerank(query, fused.map((id) => byId.get(id)!.content));
    return reranked.slice(0, TOP_K).map((hit) => {
      const row = byId.get(fused[hit.index])!;
      return {
        chunkId: row.chunk_id, documentId: row.document_id, content: row.content, score: hit.score,
        document: { title: row.title, sourceUrl: row.source_url, addedBy: row.added_by, capturedAt: row.captured_at },
      };
    });
  }
}
