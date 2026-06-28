import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser, createKnowledgeBase } from "@gr/db/queries";
import { hashToken } from "../lib/auth.js";
import { POST } from "../app/api/ingest/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, otherKbId: string, token: string;

const post = (body: unknown, auth?: string) =>
  POST(new NextRequest("http://localhost/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
  }));

beforeAll(async () => {
  const owner = await createUser(db, { id: "u_route_owner", email: "o@o.dev" });
  const outsider = await createUser(db, { id: "u_route_outsider", email: "x@x.dev" });
  kbId = await createKnowledgeBase(db, { ownerId: owner, name: "Owned" });
  otherKbId = await createKnowledgeBase(db, { ownerId: outsider, name: "NotMine" });
  token = "grt_route_tok";
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId: owner, name: "r", tokenHash: hashToken(token),
  });
});
afterAll(async () => { await sql.end(); });

describe("POST /api/ingest auth & authz", () => {
  it("401 without a token", async () => {
    expect((await post({ kbId, text: "hi" })).status).toBe(401);
  });
  it("400 when content is missing", async () => {
    expect((await post({}, token)).status).toBe(400);
  });
  it("403 when caller is not a member of the target kb (IDOR)", async () => {
    expect((await post({ kbId: otherKbId, text: "hi" }, token)).status).toBe(403);
  });
});
