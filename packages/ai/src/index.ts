import { embedMany, generateText } from "ai";
import { env } from "@gr/config";
import { resolveModels } from "./models.js";
import { rankFromList, type RerankHit } from "./rerank.js";
import { cleanTitle } from "./title.js";
import { parseMemories } from "./memory.js";

export type { RerankHit };

export interface AiClient {
  embed(texts: string[]): Promise<number[][]>;
  /** Returns tag slugs for a piece of content. */
  tag(content: string): Promise<string[]>;
  /** Grounded answer over numbered context blocks. */
  answer(question: string, contexts: string[]): Promise<{ text: string; tokens: number }>;
  rerank(query: string, docs: string[]): Promise<RerankHit[]>;
  /** A short (≤6-word) title for a conversation, from its opening question. */
  titleConversation(firstMessage: string): Promise<string>;
  /** 0-3 durable facts/preferences about the user, distilled from one exchange. */
  extractMemories(userMessage: string, reply: string): Promise<string[]>;
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
      // LLM cross-encoder-style reranker: a fast model orders the fused candidates by relevance.
      // Improves precision over RRF alone; falls back to the input order if the call fails.
      if (docs.length <= 1) return docs.map((_, index) => ({ index, score: 1 }));
      const cand = docs.slice(0, 16);
      const passages = cand
        .map((d, i) => `[${i + 1}] ${d.replace(/\s+/g, " ").slice(0, 400)}`)
        .join("\n");
      try {
        const { text } = await generateText({
          model: models.rerank,
          prompt:
            `Rank the passages by how well each helps answer the question, most relevant first.\n` +
            `Reply with ONLY the passage numbers separated by commas (e.g. "3, 1, 5"); omit ` +
            `passages that are not relevant.\n\nQuestion: ${query}\n\nPassages:\n${passages}`,
        });
        return rankFromList(text, cand.length);
      } catch {
        return docs.map((_, index) => ({ index, score: 1 - index * 1e-6 }));
      }
    },
    async titleConversation(firstMessage) {
      const { text } = await generateText({
        model: models.tagging,
        prompt:
          `Write a concise title (at most 6 words, no quotes, no trailing punctuation) for a ` +
          `conversation that begins with this question:\n\n${firstMessage.slice(0, 500)}`,
      });
      return cleanTitle(text);
    },
    async extractMemories(userMessage, reply) {
      const { text } = await generateText({
        model: models.tagging,
        prompt:
          `From this exchange, extract 0-3 durable facts or preferences ABOUT THE USER worth ` +
          `remembering long-term (their role, projects, stable preferences). Ignore transient or ` +
          `topical details. One per line, no numbering. If nothing durable, reply exactly NONE.\n\n` +
          `User: ${userMessage.slice(0, 1000)}\nAssistant: ${reply.slice(0, 1000)}`,
      });
      return parseMemories(text);
    },
  };
}
