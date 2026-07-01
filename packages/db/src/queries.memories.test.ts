import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb } from "./client.js";
import { createUser } from "./queries.js";
import {
  getMemoryState, listMemories, insertMemoryIfNovel, updateMemory,
  deleteMemory, clearMemories, setMemoryEnabled,
} from "./queries.js";
import { memories, users } from "./schema.js";
import { eq, inArray } from "drizzle-orm";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);

beforeAll(async () => { await createUser(db, { id: "u_mem_schema", email: "ms@m.dev" }); });
afterAll(async () => {
  await db.delete(users).where(inArray(users.id, ["u_mem_schema", "u_mem_q", "u_mem_state", "u_mem_own", "u_mem_own2"]));
  await sql.end();
});

// helper: a unit vector pointing at one axis, so two facts can be made near/far
const axis = (i: number) => { const v = new Array(1536).fill(0); v[i] = 1; return v as number[]; };

describe("memories schema", () => {
  it("stores a memory row and defaults users.memory_enabled to true", async () => {
    await db.insert(memories).values({ id: "mem_schema_1", userId: "u_mem_schema", content: "likes tea", kind: "fact" });
    const rows = await db.select().from(memories).where(eq(memories.id, "mem_schema_1"));
    expect(rows[0]?.content).toBe("likes tea");
    const u = await db.select().from(users).where(eq(users.id, "u_mem_schema"));
    expect(u[0]?.memoryEnabled).toBe(true);
  });
});

describe("memory queries", () => {
  it("inserts novel facts and dedups near-duplicates by embedding", async () => {
    const uid = await createUser(db, { id: "u_mem_q", email: "mq@m.dev" });
    expect(await insertMemoryIfNovel(db, { userId: uid, content: "PM at a fintech", kind: "fact", embedding: axis(1), sourceConversationId: null })).toBe(true);
    // identical embedding → treated as duplicate → not inserted
    expect(await insertMemoryIfNovel(db, { userId: uid, content: "product manager, fintech", kind: "fact", embedding: axis(1), sourceConversationId: null })).toBe(false);
    // a far-apart embedding → novel → inserted
    expect(await insertMemoryIfNovel(db, { userId: uid, content: "likes Kyoto", kind: "fact", embedding: axis(2), sourceConversationId: null })).toBe(true);
    const facts = (await listMemories(db, uid)).map((m) => m.content);
    expect(facts).toContain("PM at a fintech");
    expect(facts).toContain("likes Kyoto");
    expect(facts).not.toContain("product manager, fintech");
  });

  it("getMemoryState returns the toggle and fact contents; setMemoryEnabled flips it", async () => {
    const uid = await createUser(db, { id: "u_mem_state", email: "mst@m.dev" });
    await insertMemoryIfNovel(db, { userId: uid, content: "drinks tea", kind: "fact", embedding: axis(3), sourceConversationId: null });
    let state = await getMemoryState(db, uid);
    expect(state.enabled).toBe(true);
    expect(state.facts).toContain("drinks tea");
    await setMemoryEnabled(db, uid, false);
    state = await getMemoryState(db, uid);
    expect(state.enabled).toBe(false);
  });

  it("updates and deletes only the owner's memory; clear removes all", async () => {
    const uid = await createUser(db, { id: "u_mem_own", email: "mo@m.dev" });
    const other = await createUser(db, { id: "u_mem_own2", email: "mo2@m.dev" });
    await insertMemoryIfNovel(db, { userId: uid, content: "orig", kind: "fact", embedding: axis(4), sourceConversationId: null });
    const id = (await listMemories(db, uid))[0].id;
    expect(await updateMemory(db, id, other, "hacked", axis(5))).toBe(false); // not owner
    expect(await updateMemory(db, id, uid, "edited", axis(5))).toBe(true);
    expect((await listMemories(db, uid))[0].content).toBe("edited");
    expect(await deleteMemory(db, id, other)).toBe(false); // not owner
    expect(await deleteMemory(db, id, uid)).toBe(true);
    await insertMemoryIfNovel(db, { userId: uid, content: "again", kind: "fact", embedding: axis(6), sourceConversationId: null });
    await clearMemories(db, uid);
    expect(await listMemories(db, uid)).toEqual([]);
  });
});
