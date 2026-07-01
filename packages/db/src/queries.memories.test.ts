import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb } from "./client.js";
import { createUser } from "./queries.js";
import { memories, users } from "./schema.js";
import { eq } from "drizzle-orm";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);

beforeAll(async () => { await createUser(db, { id: "u_mem_schema", email: "ms@m.dev" }); });
afterAll(async () => { await db.delete(users).where(eq(users.id, "u_mem_schema")); await sql.end(); });

describe("memories schema", () => {
  it("stores a memory row and defaults users.memory_enabled to true", async () => {
    await db.insert(memories).values({ id: "mem_schema_1", userId: "u_mem_schema", content: "likes tea", kind: "fact" });
    const rows = await db.select().from(memories).where(eq(memories.id, "mem_schema_1"));
    expect(rows[0]?.content).toBe("likes tea");
    const u = await db.select().from(users).where(eq(users.id, "u_mem_schema"));
    expect(u[0]?.memoryEnabled).toBe(true);
  });
});
