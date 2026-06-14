import { embedMany, generateText } from "ai";
import { env } from "@gr/config";
import { resolveModels } from "./models.js";

export interface RerankHit { index: number; score: number; }

export interface AiClient {
  embed(texts: string[]): Promise<number[][]>;
  /** Returns tag slugs for a piece of content. */
  tag(content: string): Promise<string[]>;
  /** Grounded answer over numbered context blocks. */
  answer(question: string, contexts: string[]): Promise<{ text: string; tokens: number }>;
  rerank(query: string, docs: string[]): Promise<RerankHit[]>;
}

export function createAiClient(): AiClient {
  const models = resolveModels(env);
  return {
    async embed(texts) {
      const { embeddings } = await embedMany({ model: models.embedding, values: texts });
      return embeddings;
    },
    async tag(content) {
      const { text } = await generateText({
        model: models.tagging,
        prompt:
          `Return 3-6 short lowercase topic tags (comma-separated, no #) for this content:\n\n` +
          content.slice(0, 4000),
      });
      return text.split(",").map((t) => t.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean);
    },
    async answer(question, contexts) {
      const numbered = contexts.map((c, i) => `[${i + 1}] ${c}`).join("\n\n");
      const { text, usage } = await generateText({
        model: models.generation,
        prompt:
          `Answer the question using ONLY the numbered sources. Cite sources inline like [1].\n` +
          `If the sources do not contain the answer, say "I don't have anything saved about that."\n\n` +
          `Sources:\n${numbered}\n\nQuestion: ${question}`,
      });
      return { text, tokens: usage?.totalTokens ?? 0 };
    },
    async rerank(query, docs) {
      // Cohere rerank via Gateway is added during infra setup; until then,
      // fall back to identity ordering so the pipeline is exercisable.
      return docs.map((_, index) => ({ index, score: 1 - index * 1e-6 }));
    },
  };
}
