import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser, getOrCreatePersonalKb, createConversation, appendMessage, renameConversation } from "@gr/db/queries";
import { hashToken } from "../lib/auth.js";
import { GET as listGet } from "../app/api/conversations/route.js";
import { GET as detailGet, DELETE as detailDelete, PATCH as detailPatch } from "../app/api/conversations/[id]/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, uid: string, token: string, otherToken: string;

async function mkUserToken(id: string, email: string, tok: string) {
  const u = await createUser(db, { id, email });
  await db.insert(schema.apiTokens).values({ id: `tok_${randomUUID().slice(0, 8)}`, userId: u, name: "t", tokenHash: hashToken(tok) });
  return u;
}
const req = (url: string, tok?: string, method = "GET") =>
  new NextRequest(url, { method, headers: tok ? { authorization: `Bearer ${tok}` } : {} });
const reqJson = (url: string, tok: string, method: string, body: unknown) =>
  new NextRequest(url, { method, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  token = "grt_conv_owner"; otherToken = "grt_conv_other";
  uid = await mkUserToken("u_conv_route", "cvr@c.dev", token);
  await mkUserToken("u_conv_route_other", "cvro@c.dev", otherToken);
  kbId = await getOrCreatePersonalKb(db, uid);
});
afterAll(async () => { await sql.end(); });

describe("conversations endpoints", () => {
  it("lists only the caller's conversations", async () => {
    const c = await createConversation(db, { kbId, userId: uid, title: "Mine" });
    await appendMessage(db, { conversationId: c, role: "user", content: "hi" });
    const res = await listGet(req("http://localhost/api/conversations", token));
    expect(res.status).toBe(200);
    expect((await res.json()).conversations.some((x: { id: string }) => x.id === c)).toBe(true);
  });

  it("401 without auth", async () => {
    expect((await listGet(req("http://localhost/api/conversations"))).status).toBe(401);
  });

  it("returns a conversation's messages to its owner, 404 to others", async () => {
    const c = await createConversation(db, { kbId, userId: uid, title: "Detail" });
    await appendMessage(db, { conversationId: c, role: "user", content: "hello" });
    const ok = await detailGet(req(`http://localhost/api/conversations/${c}`, token), ctx(c));
    expect(ok.status).toBe(200);
    expect((await ok.json()).messages).toHaveLength(1);
    const denied = await detailGet(req(`http://localhost/api/conversations/${c}`, otherToken), ctx(c));
    expect(denied.status).toBe(404);
  });

  it("renameConversation only renames the owner's conversation", async () => {
    const c = await createConversation(db, { kbId, userId: uid, title: "Q" });
    expect(await renameConversation(db, c, "u_conv_route_other", "nope")).toBe(false);
    expect(await renameConversation(db, c, uid, "yep")).toBe(true);
  });

  it("PATCH renames only the caller's conversation and validates input", async () => {
    const c = await createConversation(db, { kbId, userId: uid, title: "Old" });
    expect((await detailPatch(req(`http://localhost/api/conversations/${c}`, undefined, "PATCH"), ctx(c))).status).toBe(401);
    expect((await detailPatch(reqJson(`http://localhost/api/conversations/${c}`, token, "PATCH", { title: "   " }), ctx(c))).status).toBe(400);
    expect((await detailPatch(reqJson(`http://localhost/api/conversations/${c}`, otherToken, "PATCH", { title: "Hacked" }), ctx(c))).status).toBe(404);
    const ok = await detailPatch(reqJson(`http://localhost/api/conversations/${c}`, token, "PATCH", { title: "  New name  " }), ctx(c));
    expect(ok.status).toBe(200);
    expect((await ok.json()).title).toBe("New name");
    const detail = await detailGet(req(`http://localhost/api/conversations/${c}`, token), ctx(c));
    expect((await detail.json()).title).toBe("New name");
  });

  it("deletes only the caller's conversation", async () => {
    const c = await createConversation(db, { kbId, userId: uid });
    const denied = await detailDelete(req(`http://localhost/api/conversations/${c}`, otherToken, "DELETE"), ctx(c));
    expect(denied.status).toBe(404);
    const ok = await detailDelete(req(`http://localhost/api/conversations/${c}`, token, "DELETE"), ctx(c));
    expect(ok.status).toBe(200);
  });
});
