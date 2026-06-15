import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser, getOrCreatePersonalKb } from "@gr/db/queries";
import { hashToken } from "../lib/auth.js";
import { POST } from "../app/api/ingest/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, token: string;
beforeAll(async () => {
  const uid = await createUser(db, { id: "u_urlval", email: "uv@uv.dev" });
  kbId = await getOrCreatePersonalKb(db, uid);
  token = "grt_urlval";
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId: uid, name: "t", tokenHash: hashToken(token),
  });
});
afterAll(async () => { await sql.end(); });

const post = (body: unknown) => POST(new NextRequest("http://localhost/api/ingest", {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
}));

describe("POST /api/ingest url validation", () => {
  it("400 for a non-http(s) url scheme", async () => {
    expect((await post({ kbId, url: "javascript:alert(1)" })).status).toBe(400);
  });
  it("400 for a private/SSRF url host", async () => {
    expect((await post({ kbId, url: "http://169.254.169.254/meta" })).status).toBe(400);
  });
});
