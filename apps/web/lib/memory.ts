import type { drizzle } from "drizzle-orm/postgres-js";
import type { AiClient } from "@gr/ai";
import { insertMemoryIfNovel } from "@gr/db/queries";

type Db = ReturnType<typeof drizzle>;

/** Best-effort: distil durable facts from one exchange and store the novel ones. */
export async function rememberFromExchange(
  db: Db,
  ai: AiClient,
  args: { userId: string; userMessage: string; reply: string; conversationId: string },
): Promise<void> {
  const facts = await ai.extractMemories(args.userMessage, args.reply);
  if (facts.length === 0) return;
  const embeddings = await ai.embed(facts);
  for (let i = 0; i < facts.length; i++) {
    await insertMemoryIfNovel(db, {
      userId: args.userId, content: facts[i], kind: "fact",
      embedding: embeddings[i], sourceConversationId: args.conversationId,
    });
  }
}
