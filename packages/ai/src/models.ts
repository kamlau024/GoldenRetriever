export interface ResolvedModels {
  generation: string;
  tagging: string;
  embedding: string;
  rerank: string;
}

// Embedding models known to emit 1536-dim vectors (the pinned column width).
const EMBEDDING_1536 = new Set([
  "openai/text-embedding-3-small",
  "openai/text-embedding-ada-002",
]);

export function resolveModels(env: {
  GR_GENERATION_MODEL: string; GR_TAGGING_MODEL: string;
  GR_EMBEDDING_MODEL: string; GR_RERANK_MODEL: string;
}): ResolvedModels {
  if (!EMBEDDING_1536.has(env.GR_EMBEDDING_MODEL)) {
    throw new Error(
      `GR_EMBEDDING_MODEL '${env.GR_EMBEDDING_MODEL}' is not a known 1536-dim model. ` +
      `The chunks.embedding column is pinned to 1536; changing dimensions requires a re-embed migration.`,
    );
  }
  return {
    generation: env.GR_GENERATION_MODEL,
    tagging: env.GR_TAGGING_MODEL,
    embedding: env.GR_EMBEDDING_MODEL,
    rerank: env.GR_RERANK_MODEL,
  };
}
