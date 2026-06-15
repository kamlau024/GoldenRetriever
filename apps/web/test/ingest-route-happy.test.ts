import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser, createKnowledgeBase, getDocument } from "@gr/db/queries";
import { createMockAiClient } from "@gr/ai/mock";
import { MockConverter } from "@gr/ingest";
import { HybridRetriever } from "@gr/retrieval";
import { hashToken } from "../lib/auth.js";
import { __setIngestDeps } from "../lib/ingest-service.js";
import { POST } from "../app/api/ingest/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
const ai = createMockAiClient();
let kbId: string, token: string;

const post = (body: unknown, auth: string) =>
  POST(new NextRequest("http://localhost/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${auth}` },
    body: JSON.stringify(body),
  }));

beforeAll(async () => {
  const owner = await createUser(db, { id: "u_happy", email: "h@h.dev" });
  kbId = await createKnowledgeBase(db, { ownerId: owner, name: "Happy" });
  token = "grt_happy_tok";
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId: owner, name: "h", tokenHash: hashToken(token),
  });
  // Inject deterministic deps so the in-process path makes no live model calls.
  __setIngestDeps({ ai, converter: new MockConverter(), urlFetcher: async () => ({ kind: "text" as const, mimeType: "text/plain", text: "" }) });
});
afterAll(async () => { __setIngestDeps(null); await sql.end(); });

describe("POST /api/ingest happy path (in-process, mocked deps)", () => {
  it("returns 202 and ingests text that becomes retrievable", async () => {
    delete process.env.APP_URL; // force the in-process branch
    const res = await post({ kbId, text: "Tawaraya is a historic ryokan in central Kyoto." }, token);
    expect(res.status).toBe(202);

    const { documentId } = await res.json() as { documentId: string };
    const doc = await getDocument(db, documentId, kbId);
    expect(doc?.status).toBe("ready");

    const hits = await new HybridRetriever(db, ai).retrieve(kbId, "ryokan in Kyoto");
    expect(hits[0]?.content).toContain("Tawaraya");
  });
});
