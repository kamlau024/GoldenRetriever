import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray, eq } from "drizzle-orm";
import { createDb } from "./client.js";
import { createUser, createKnowledgeBase, createConversation, setConversationSummary, getConversationSummary, recallConversations, clearMemories } from "./queries.js";
import { conversations, users } from "./schema.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
const USERS = ["u_sum_schema", "u_sum_q", "u_sum_recall", "u_sum_clear"];
let kbId: string;

beforeAll(async () => {
  await createUser(db, { id: "u_sum_schema", email: "ss@s.dev" });
  kbId = await createKnowledgeBase(db, { ownerId: "u_sum_schema", name: "Sum" });
});
afterAll(async () => { await db.delete(users).where(inArray(users.id, USERS)); await sql.end(); });

describe("conversation summary schema", () => {
  it("stores a summary + embedding on a conversation", async () => {
    const c = await createConversation(db, { kbId, userId: "u_sum_schema" });
    await db.update(conversations).set({ summary: "s", summaryEmbedding: new Array(1536).fill(0) }).where(eq(conversations.id, c));
    const rows = await db.select({ summary: conversations.summary }).from(conversations).where(eq(conversations.id, c));
    expect(rows[0].summary).toBe("s");
  });
});

const axis = (i: number) => { const v = new Array(1536).fill(0); v[i] = 1; return v as number[]; };

describe("summary queries", () => {
  it("sets and gets a conversation summary", async () => {
    const uid = await createUser(db, { id: "u_sum_q", email: "sq@s.dev" });
    const kb = await createKnowledgeBase(db, { ownerId: uid, name: "Q" });
    const c = await createConversation(db, { kbId: kb, userId: uid });
    await setConversationSummary(db, c, "about Kyoto", axis(1));
    expect(await getConversationSummary(db, c)).toBe("about Kyoto");
  });

  it("recalls nearest summaries, excluding the current thread and null-summary conversations", async () => {
    const uid = await createUser(db, { id: "u_sum_recall", email: "sr@s.dev" });
    const kb = await createKnowledgeBase(db, { ownerId: uid, name: "R" });
    const a = await createConversation(db, { kbId: kb, userId: uid });
    const b = await createConversation(db, { kbId: kb, userId: uid });
    const cur = await createConversation(db, { kbId: kb, userId: uid }); // no summary → excluded
    await setConversationSummary(db, a, "Kyoto ryokan trip", axis(2));
    await setConversationSummary(db, b, "bread baking", axis(3));
    const near = await recallConversations(db, uid, axis(2), cur, 3);
    expect(near[0]).toBe("Kyoto ryokan trip");        // closest to axis(2)
    // excluding a itself removes it
    expect(await recallConversations(db, uid, axis(2), a, 3)).not.toContain("Kyoto ryokan trip");
  });

  it("clearMemories nulls the user's conversation summaries", async () => {
    const uid = await createUser(db, { id: "u_sum_clear", email: "sc@s.dev" });
    const kb = await createKnowledgeBase(db, { ownerId: uid, name: "C" });
    const c = await createConversation(db, { kbId: kb, userId: uid });
    await setConversationSummary(db, c, "temp", axis(4));
    await clearMemories(db, uid);
    expect(await getConversationSummary(db, c)).toBeNull();
  });
});
