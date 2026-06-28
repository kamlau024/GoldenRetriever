import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser, getOrCreatePersonalKb, listDocuments } from "@gr/db/queries";
import { createMockAiClient } from "@gr/ai/mock";
import { MockConverter } from "@gr/ingest";
import { hashToken } from "../lib/auth.js";
import { __setIngestDeps } from "../lib/ingest-service.js";
import { InMemoryBlobStore, __setBlobStore } from "../lib/blob.js";
import { POST } from "../app/api/capture/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let token: string;

const capture = (content: string | File | null, auth = true) => {
  const fd = new FormData();
  if (content !== null) fd.set("content", content);
  return POST(new NextRequest("http://localhost/api/capture", {
    method: "POST", headers: auth ? { authorization: `Bearer ${token}` } : {}, body: fd,
  }));
};

beforeAll(async () => {
  delete process.env.VERCEL; // run ingestion inline (not deferred) so assertions see results
  await createUser(db, { id: "u_cap", email: "c@c.dev" });
  token = "grt_cap";
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId: "u_cap", name: "t", tokenHash: hashToken(token),
  });
  __setBlobStore(new InMemoryBlobStore());
  __setIngestDeps({
    ai: createMockAiClient(),
    converter: new MockConverter("# Doc\n\nKyoto ryokan report."),
    urlFetcher: async () => ({ kind: "text" as const, mimeType: "text/html",
      text: "<html><head><title>Page</title></head><body><article><p>Kyoto ryokan guide.</p></article></body></html>" }),
  });
});
afterAll(async () => { __setBlobStore(null); __setIngestDeps(null); await sql.end(); });

describe("POST /api/capture (single endpoint, type auto-detected)", () => {
  it("401 without auth", async () => {
    expect((await capture("hi", false)).status).toBe(401);
  });

  it("400 with no content", async () => {
    expect((await capture(null)).status).toBe(400);
  });

  it("routes a bare URL string → fetched + ingested as a web page", async () => {
    delete process.env.APP_URL;
    const res = await capture("https://ok.dev/post");
    expect(res.status).toBe(202);
    const kbId = await getOrCreatePersonalKb(db, "u_cap");
    const doc = (await listDocuments(db, kbId)).find((d) => d.sourceUrl === "https://ok.dev/post");
    expect(doc?.kind).toBe("web");
    expect(doc?.status).toBe("ready");
  });

  it("routes plain text → ingested as a text note", async () => {
    delete process.env.APP_URL;
    const res = await capture("A quick thought about a Kyoto ryokan.");
    expect(res.status).toBe(202);
    const kbId = await getOrCreatePersonalKb(db, "u_cap");
    expect((await listDocuments(db, kbId)).some((d) => d.kind === "text" && d.status === "ready")).toBe(true);
  });

  it("accepts a JSON body { content } (no multipart) and routes it", async () => {
    delete process.env.APP_URL;
    const res = await POST(new NextRequest("http://localhost/api/capture", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ content: "https://ok.dev/json-post" }),
    }));
    expect(res.status).toBe(202);
    const kbId = await getOrCreatePersonalKb(db, "u_cap");
    const doc = (await listDocuments(db, kbId)).find((d) => d.sourceUrl === "https://ok.dev/json-post");
    expect(doc?.kind).toBe("web");
    expect(doc?.status).toBe("ready");
  });

  it("routes a text File whose content is a bare URL → fetched as a web page", async () => {
    delete process.env.APP_URL;
    const f = new File(["https://ok.dev/from-file"], "shared.txt", { type: "text/plain" });
    const res = await capture(f);
    expect(res.status).toBe(202);
    const kbId = await getOrCreatePersonalKb(db, "u_cap");
    const doc = (await listDocuments(db, kbId)).find((d) => d.sourceUrl === "https://ok.dev/from-file");
    expect(doc?.kind).toBe("web");
    expect(doc?.status).toBe("ready");
  });

  it("routes a binary File → stored in blob + converted", async () => {
    delete process.env.APP_URL;
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "report.pdf", { type: "application/pdf" });
    const res = await capture(pdf);
    expect(res.status).toBe(202);
    const kbId = await getOrCreatePersonalKb(db, "u_cap");
    const doc = (await listDocuments(db, kbId)).find((d) => d.title === "report.pdf");
    expect(doc?.kind).toBe("pdf");
    expect(doc?.status).toBe("ready");
  });
});
