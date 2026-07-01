import type { LanguageModel } from "ai";
import type { drizzle } from "drizzle-orm/postgres-js";
import { HybridRetriever, type Retriever } from "@gr/retrieval";
import { createAiClient } from "@gr/ai";
import { env } from "@gr/config";
import { rememberFromExchange } from "./memory.js";

type Db = ReturnType<typeof drizzle>;
export interface ChatDeps {
  retriever: Retriever;
  model: LanguageModel;
  titleConversation?: (firstMessage: string) => Promise<string>;
  remember?: (args: { userId: string; userMessage: string; reply: string; conversationId: string }) => Promise<void>;
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
    remember: (args) => rememberFromExchange(db, ai, args),
  };
}

/** First ~6 words of a message, capped — the fallback title when LLM titling fails. */
export function firstWords(text: string, max = 60): string {
  return text.trim().split(/\s+/).slice(0, 6).join(" ").slice(0, max);
}
