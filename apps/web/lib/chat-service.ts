import type { LanguageModel } from "ai";
import type { drizzle } from "drizzle-orm/postgres-js";
import { HybridRetriever, type Retriever } from "@gr/retrieval";
import { createAiClient } from "@gr/ai";
import { env } from "@gr/config";

type Db = ReturnType<typeof drizzle>;
export interface ChatDeps {
  retriever: Retriever;
  model: LanguageModel;
  titleConversation?: (firstMessage: string) => Promise<string>;
}
let override: ChatDeps | null = null;
export function __setChatDeps(d: ChatDeps | null) { override = d; }
export function resolveChatDeps(db: Db): ChatDeps {
  if (override) return override;
  const ai = createAiClient();
  return {
    retriever: new HybridRetriever(db, ai),
    model: env.GR_GENERATION_MODEL,
    titleConversation: (m) => ai.titleConversation(m),
  };
}

/** First ~6 words of a message, capped — the fallback title when LLM titling fails. */
export function firstWords(text: string, max = 60): string {
  return text.trim().split(/\s+/).slice(0, 6).join(" ").slice(0, max);
}

export const REFUSAL = "I don't have anything saved about that.";
export function groundedPrompt(question: string, contexts: string[]): string {
  const numbered = contexts.map((c, i) => `[${i + 1}] ${c}`).join("\n\n");
  return `Answer the question using ONLY the numbered sources. Cite sources inline like [1].\n` +
    `If the sources do not contain the answer, say "${REFUSAL}"\n\nSources:\n${numbered}\n\nQuestion: ${question}`;
}
