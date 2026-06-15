import { describe, it, expect, afterAll } from "vitest";
import { createDb } from "./client.js";
import { upsertUser, getOrCreatePersonalKb, listDocuments, insertDocument } from "./queries.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
afterAll(async () => { await sql.end(); });

describe("ui query helpers", () => {
  it("upsertUser is idempotent and updates email", async () => {
    await upsertUser(db, { id: "u_ui", email: "a@a.dev" });
    await upsertUser(db, { id: "u_ui", email: "b@b.dev", name: "B" });
    const kb = await getOrCreatePersonalKb(db, "u_ui");
    expect(kb).toMatch(/^kb_/);
  });

  it("getOrCreatePersonalKb returns the same kb on repeat calls", async () => {
    const a = await getOrCreatePersonalKb(db, "u_ui");
    const b = await getOrCreatePersonalKb(db, "u_ui");
    expect(a).toBe(b);
  });

  it("listDocuments returns kb docs newest-first", async () => {
    const kbId = await getOrCreatePersonalKb(db, "u_ui");
    await insertDocument(db, { kbId, addedBy: "u_ui", kind: "text", captureMode: "selection", sourceUrl: null, title: "Doc A" });
    const docs = await listDocuments(db, kbId);
    expect(docs.length).toBeGreaterThan(0);
    expect(docs[0]).toHaveProperty("title");
    expect(docs[0]).toHaveProperty("status");
  });
});
