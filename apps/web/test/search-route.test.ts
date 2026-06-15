import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser, getOrCreatePersonalKb } from "@gr/db/queries";
import type { RankedChunk } from "@gr/core";
import type { Retriever } from "@gr/retrieval";
import { hashToken } from "../lib/auth.js";
import { __setSearchRetriever } from "../lib/search-service.js";
import { POST } from "../app/api/search/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, token: string;
const chunk = (content: string): RankedChunk => ({
  chunkId: "c1", documentId: "d1", content, score: 1,
  document: { title: "Kyoto", sourceUrl: "https://x", addedBy: "u_search", capturedAt: new Date() },
});
beforeAll(async () => {
  const uid = await createUser(db, { id: "u_search", email: "se@se.dev" });
  kbId = await getOrCreatePersonalKb(db, uid);
  token = "grt_search";
  await db.insert(schema.apiTokens).values({ id: `tok_${randomUUID().slice(0, 8)}`, userId: uid, name: "t", tokenHash: hashToken(token) });
});
afterAll(async () => { __setSearchRetriever(null); await sql.end(); });

const post = (body: unknown, auth = true) => POST(new NextRequest("http://localhost/api/search", {
  method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
}));

describe("POST /api/search", () => {
  it("returns ranked results for a member", async () => {
    const fake: Retriever = { retrieve: async () => [chunk("Tawaraya is a ryokan.")] };
    __setSearchRetriever(fake);
    const res = await post({ kbId, query: "ryokan" });
    expect(res.status).toBe(200);
    const json = await res.json() as { results: { content: string; title: string | null }[] };
    expect(json.results[0].content).toContain("Tawaraya");
    expect(json.results[0].title).toBe("Kyoto");
  });
  it("401 without auth", async () => {
    expect((await post({ kbId, query: "x" }, false)).status).toBe(401);
  });
  it("403 when not a member of the kb", async () => {
    __setSearchRetriever({ retrieve: async () => [] });
    expect((await post({ kbId: "kb_other", query: "x" })).status).toBe(403);
  });
});
