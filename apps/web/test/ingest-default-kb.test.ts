import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser, getOrCreatePersonalKb, listDocuments } from "@gr/db/queries";
import { createMockAiClient } from "@gr/ai/mock";
import { MockConverter } from "@gr/ingest";
import { hashToken } from "../lib/auth.js";
import { __setIngestDeps } from "../lib/ingest-service.js";
import { POST } from "../app/api/ingest/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let token: string;
beforeAll(async () => {
  await createUser(db, { id: "u_defkb", email: "d@d.dev" });
  token = "grt_defkb";
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId: "u_defkb", name: "t", tokenHash: hashToken(token),
  });
  __setIngestDeps({ ai: createMockAiClient(), converter: new MockConverter(),
    urlFetcher: async () => ({ kind: "text" as const, mimeType: "text/plain", text: "" }) });
});
afterAll(async () => { __setIngestDeps(null); await sql.end(); });

it("ingests into the caller's personal KB when kbId is omitted", async () => {
  delete process.env.APP_URL;
  const res = await POST(new NextRequest("http://localhost/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ text: "A Kyoto ryokan note captured from my phone." }),
  }));
  expect(res.status).toBe(202);
  const kbId = await getOrCreatePersonalKb(db, "u_defkb");
  const docs = await listDocuments(db, kbId);
  expect(docs.length).toBeGreaterThan(0);
});
