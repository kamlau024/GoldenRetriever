import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb } from "./client.js";
import { createUser, createKnowledgeBase, createConversation, appendMessage, getMessages } from "./queries.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, userId: string;
beforeAll(async () => {
  userId = await createUser(db, { id: "u_chat", email: "c@c.dev" });
  kbId = await createKnowledgeBase(db, { ownerId: userId, name: "Chat" });
});
afterAll(async () => { await sql.end(); });

describe("conversation helpers", () => {
  it("persists user + assistant messages in order with citations", async () => {
    const convId = await createConversation(db, { kbId, userId });
    await appendMessage(db, { conversationId: convId, role: "user", content: "where to stay?" });
    await appendMessage(db, {
      conversationId: convId, role: "assistant", content: "Tawaraya [1].",
      citations: [{ chunkId: "c1", documentId: "d1", title: "Kyoto" }], tokens: 12,
    });
    const msgs = await getMessages(db, convId);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect((msgs[1].citations as unknown[]).length).toBe(1);
  });
});
