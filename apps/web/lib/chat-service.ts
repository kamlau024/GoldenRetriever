import type { LanguageModel } from "ai";
import type { drizzle } from "drizzle-orm/postgres-js";
import { HybridRetriever, type Retriever } from "@gr/retrieval";
import { createAiClient } from "@gr/ai";
import { env } from "@gr/config";

type Db = ReturnType<typeof drizzle>;
export interface ChatDeps { retriever: Retriever; model: LanguageModel; }
let override: ChatDeps | null = null;
export function __setChatDeps(d: ChatDeps | null) { override = d; }
export function resolveChatDeps(db: Db): ChatDeps {
  return override ?? { retriever: new HybridRetriever(db, createAiClient()), model: env.GR_GENERATION_MODEL };
}

export const REFUSAL = "I don't have anything saved about that.";
export function groundedPrompt(question: string, contexts: string[]): string {
  const numbered = contexts.map((c, i) => `[${i + 1}] ${c}`).join("\n\n");
  return `Answer the question using ONLY the numbered sources. Cite sources inline like [1].\n` +
    `If the sources do not contain the answer, say "${REFUSAL}"\n\nSources:\n${numbered}\n\nQuestion: ${question}`;
}
