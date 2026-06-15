import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser, getOrCreatePersonalKb } from "@gr/db/queries";
import { createMockAiClient } from "@gr/ai/mock";
import { MockConverter } from "@gr/ingest";
import { hashToken } from "../lib/auth.js";
import { __setIngestDeps } from "../lib/ingest-service.js";
import { POST } from "../app/api/ingest/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, token: string;
beforeAll(async () => {
  const uid = await createUser(db, { id: "u_sess", email: "s@s.dev" });
  kbId = await getOrCreatePersonalKb(db, uid);  // creates kb + owner membership
  token = "grt_sess";
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId: uid, name: "t", tokenHash: hashToken(token),
  });
  __setIngestDeps({ ai: createMockAiClient(), converter: new MockConverter() });
});
afterAll(async () => { __setIngestDeps(null); await sql.end(); });

it("ingests for a token-authenticated member of their personal kb", async () => {
  delete process.env.APP_URL;
  const res = await POST(new NextRequest("http://localhost/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ kbId, text: "Hiiragiya is a classic Kyoto ryokan." }),
  }));
  expect(res.status).toBe(202);
});
