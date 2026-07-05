import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser, createKnowledgeBase, getOrCreatePersonalKb } from "@gr/db/queries";
import { createMockAiClient } from "@gr/ai/mock";
import { MockConverter } from "@gr/ingest";
import { hashToken } from "../lib/auth.js";
import { __setIngestDeps } from "../lib/ingest-service.js";
import { POST } from "../app/api/import/bookmarks/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, otherKbId: string, token: string;
let savedAppUrl: string | undefined;

const post = (body: unknown, auth?: string) =>
  POST(new NextRequest("http://localhost/api/import/bookmarks", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
  }));

// Public IP-literal URLs skip DNS in isSafeHttpUrl (no network); private literals are rejected.
const safe = () => `http://93.184.216.34/${randomUUID()}`;
const UNSAFE = "http://127.0.0.1/x";

const okDeps = () => ({ ai: createMockAiClient(), converter: new MockConverter(), urlFetcher: async () => ({ kind: "text" as const, mimeType: "text/plain", text: "hi" }) });

beforeAll(async () => {
  const uid = await createUser(db, { id: "u_bmimp", email: "bm@bm.dev" });
  const outsider = await createUser(db, { id: "u_bmimp_out", email: "bmo@bm.dev" });
  kbId = await getOrCreatePersonalKb(db, uid);
  otherKbId = await createKnowledgeBase(db, { ownerId: outsider, name: "NotMine" });
  token = "grt_bmimp";
  await db.insert(schema.apiTokens).values({ id: `tok_${randomUUID().slice(0, 8)}`, userId: uid, name: "t", tokenHash: hashToken(token) });
  __setIngestDeps(okDeps());
  savedAppUrl = process.env.APP_URL;
  delete process.env.APP_URL; // force in-process processing
});
afterAll(async () => {
  __setIngestDeps(null);
  if (savedAppUrl !== undefined) process.env.APP_URL = savedAppUrl;
  await sql.end();
});

describe("POST /api/import/bookmarks", () => {
  it("401 without auth", async () => {
    expect((await post({ kbId, items: [{ url: safe() }] })).status).toBe(401);
  });
  it("400 on malformed JSON body", async () => {
    const res = await POST(new NextRequest("http://localhost/api/import/bookmarks", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: "{ not valid json",
    }));
    expect(res.status).toBe(400);
  });
  it("400 when items is empty", async () => {
    expect((await post({ kbId, items: [] }, token)).status).toBe(400);
  });
  it("400 when items exceeds the cap", async () => {
    const items = Array.from({ length: 51 }, () => ({ url: safe() }));
    expect((await post({ kbId, items }, token)).status).toBe(400);
  });
  it("403 when the caller is not a member of the target kb", async () => {
    expect((await post({ kbId: otherKbId, items: [{ url: safe() }] }, token)).status).toBe(403);
  });
  it("enqueues safe URLs, skips unsafe ones, and creates documents", async () => {
    const good = safe();
    const res = await post({ kbId, items: [{ url: good, title: "Good Page" }, { url: safe() }, { url: UNSAFE }] }, token);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ queued: 2, skipped: 1, failed: 0 });
    const docs = await db.select().from(schema.documents).where(eq(schema.documents.sourceUrl, good));
    expect(docs).toHaveLength(1);
    expect(docs[0].kind).toBe("web");
    expect(docs[0].title).toBe("Good Page");
  });
  it("counts a URL whose processing throws as failed, without failing the whole import", async () => {
    __setIngestDeps({
      ai: createMockAiClient(), converter: new MockConverter(),
      urlFetcher: async (u: string) => { if (u.includes("bad")) throw new Error("fetch blocked"); return { kind: "text" as const, mimeType: "text/plain", text: "hi" }; },
    });
    const good = `http://93.184.216.34/good-${randomUUID()}`;
    const bad = `http://93.184.216.34/bad-${randomUUID()}`;
    const res = await post({ kbId, items: [{ url: good }, { url: bad }] }, token);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ queued: 1, skipped: 0, failed: 1 });
    __setIngestDeps(okDeps()); // restore for any later tests
  });
});
