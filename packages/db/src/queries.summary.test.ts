import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray, eq } from "drizzle-orm";
import { createDb } from "./client.js";
import { createUser, createKnowledgeBase, createConversation } from "./queries.js";
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
