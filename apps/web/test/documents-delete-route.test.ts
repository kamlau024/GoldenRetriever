import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser, getOrCreatePersonalKb, insertDocument } from "@gr/db/queries";
import { hashToken } from "../lib/auth.js";
import { DELETE } from "../app/api/documents/[id]/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, token: string, userId: string;
beforeAll(async () => {
  userId = await createUser(db, { id: "u_delr", email: "dr@dr.dev" });
  kbId = await getOrCreatePersonalKb(db, userId);
  token = "grt_delr";
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId, name: "t", tokenHash: hashToken(token),
  });
});
afterAll(async () => { await sql.end(); });

const del = (id: string, auth = true) => DELETE(
  new NextRequest(`http://localhost/api/documents/${id}`, {
    method: "DELETE", headers: auth ? { authorization: `Bearer ${token}` } : {},
  }),
  { params: Promise.resolve({ id }) },
);

describe("DELETE /api/documents/[id]", () => {
  it("deletes a document the caller owns", async () => {
    const docId = await insertDocument(db, { kbId, addedBy: userId, kind: "text", captureMode: "selection", sourceUrl: null, title: "X" });
    expect((await del(docId)).status).toBe(200);
  });
  it("401 without auth", async () => {
    expect((await del("doc_x", false)).status).toBe(401);
  });
  it("404 for a document not in the caller's kbs", async () => {
    expect((await del("doc_missing")).status).toBe(404);
  });
});
