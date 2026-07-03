import type { drizzle } from "drizzle-orm/postgres-js";
import type { AiClient } from "@gr/ai";
import { insertMemoryIfNovel, getConversationSummary, setConversationSummary, recallConversations } from "@gr/db/queries";

type Db = ReturnType<typeof drizzle>;

/** Best-effort: distil durable facts from one exchange AND update the conversation's running summary. */
export async function rememberFromExchange(
  db: Db,
  ai: AiClient,
  args: { userId: string; userMessage: string; reply: string; conversationId: string },
): Promise<void> {
  const facts = await ai.extractMemories(args.userMessage, args.reply);
  if (facts.length > 0) {
    const embeddings = await ai.embed(facts);
    for (let i = 0; i < facts.length; i++) {
      await insertMemoryIfNovel(db, {
        userId: args.userId, content: facts[i], kind: "fact",
        embedding: embeddings[i], sourceConversationId: args.conversationId,
      });
    }
  }
  // Update the conversation's running summary + embedding for recall (Phase 3).
  const prior = await getConversationSummary(db, args.conversationId);
  const summary = await ai.summarizeConversation(prior, args.userMessage, args.reply);
  if (summary) {
    const [emb] = await ai.embed([summary]);
    await setConversationSummary(db, args.conversationId, summary, emb);
  }
}

/** Semantic recall: summaries of past conversations most relevant to the current question. */
export async function recallPastChats(
  db: Db,
  ai: AiClient,
  args: { userId: string; question: string; excludeConversationId: string },
): Promise<string[]> {
  const [emb] = await ai.embed([args.question]);
  return recallConversations(db, args.userId, emb, args.excludeConversationId, 3);
}
