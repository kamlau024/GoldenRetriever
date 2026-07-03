import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { createDb, schema } from "@gr/db";
import { createUser, createKnowledgeBase, createConversation, getConversationSummary } from "@gr/db/queries";
import { createMockAiClient } from "@gr/ai/mock";
import { rememberFromExchange, recallPastChats } from "../lib/memory.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
const ai = createMockAiClient();
let kbId: string, uid: string;

beforeAll(async () => {
  uid = await createUser(db, { id: "u_memlib", email: "ml@m.dev" });
  kbId = await createKnowledgeBase(db, { ownerId: uid, name: "ML" });
});
afterAll(async () => { await db.delete(schema.users).where(inArray(schema.users.id, ["u_memlib"])); await sql.end(); });

describe("memory lib", () => {
  it("rememberFromExchange stores a conversation summary", async () => {
    const conv = await createConversation(db, { kbId, userId: uid });
    await rememberFromExchange(db, ai, { userId: uid, userMessage: "hi", reply: "hello", conversationId: conv });
    expect(await getConversationSummary(db, conv)).toBe("conversation summary");
  });

  it("recallPastChats returns summaries, excluding the current thread", async () => {
    const past = await createConversation(db, { kbId, userId: uid });
    await rememberFromExchange(db, ai, { userId: uid, userMessage: "kyoto", reply: "ryokan", conversationId: past });
    const cur = await createConversation(db, { kbId, userId: uid });
    const got = await recallPastChats(db, ai, { userId: uid, question: "kyoto", excludeConversationId: cur });
    expect(got).toContain("conversation summary");
  });
});
