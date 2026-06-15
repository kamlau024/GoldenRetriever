import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { streamText } from "ai";
import { createDb, schema } from "@gr/db";
import { createConversation, appendMessage } from "@gr/db/queries";
import { resolveAuth } from "../../../lib/clerk-auth.js";
import { resolveChatDeps, groundedPrompt, REFUSAL } from "../../../lib/chat-service.js";
import { encodeCitations } from "../../../lib/citations.js";

export async function POST(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { kbId, conversationId, message } = await req.json() as
    { kbId: string; conversationId?: string; message: string };
  if (!kbId || !message) return NextResponse.json({ error: "kbId and message required" }, { status: 400 });

  const membership = await db.select().from(schema.kbMembers)
    .where(and(eq(schema.kbMembers.kbId, kbId), eq(schema.kbMembers.userId, principal.userId)));
  if (!membership[0]) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const convId = conversationId ?? await createConversation(db, { kbId, userId: principal.userId });
  await appendMessage(db, { conversationId: convId, role: "user", content: message });

  const { retriever, model } = resolveChatDeps(db);
  const hits = await retriever.retrieve(kbId, message);

  if (hits.length === 0) {
    await appendMessage(db, { conversationId: convId, role: "assistant", content: REFUSAL, citations: [] });
    return new Response(REFUSAL, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", "x-conversation-id": convId, "x-citations": encodeCitations([]) },
    });
  }

  const citations = hits.map((h) => ({
    chunkId: h.chunkId, documentId: h.documentId, title: h.document.title, sourceUrl: h.document.sourceUrl,
  }));
  const result = streamText({
    model,
    prompt: groundedPrompt(message, hits.map((h) => h.content)),
    onFinish: async ({ text, totalUsage }) => {
      await appendMessage(db, {
        conversationId: convId, role: "assistant", content: text, citations,
        tokens: totalUsage?.totalTokens ?? totalUsage?.outputTokens,
      });
    },
  });
  return result.toTextStreamResponse({ headers: { "x-conversation-id": convId, "x-citations": encodeCitations(citations) } });
}
