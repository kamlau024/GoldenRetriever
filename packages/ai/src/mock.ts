import type { AiClient, RerankHit } from "./index.js";

/** Deterministic AiClient for tests: embeddings are a tiny bag-of-words hash. */
export function createMockAiClient(): AiClient {
  const embedOne = (text: string): number[] => {
    const v = new Array(1536).fill(0);
    for (const w of text.toLowerCase().split(/\s+/).filter(Boolean)) {
      let h = 0;
      for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) >>> 0;
      v[h % 1536] += 1;
    }
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  };
  return {
    async embed(texts) { return texts.map(embedOne); },
    async tag() { return ["test-tag"]; },
    async answer(question, contexts) {
      return { text: contexts.length ? `Answer [1]` : "I don't have anything saved about that.", tokens: 42 };
    },
    async rerank(_query, docs): Promise<RerankHit[]> {
      return docs.map((_, index) => ({ index, score: 1 - index * 1e-6 }));
    },
    async titleConversation(firstMessage) {
      return firstMessage.slice(0, 60);
    },
    async extractMemories() { return []; },
    async summarizeConversation() { return "conversation summary"; },
  };
}
