import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createDb, schema } from "@gr/db";
import { createUser } from "@gr/db/queries";
import { hashToken } from "../lib/auth.js";
import { resolveAuth } from "../lib/clerk-auth.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
beforeAll(async () => {
  const uid = await createUser(db, { id: "u_resolve", email: "r@r.dev" });
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId: uid, name: "t", tokenHash: hashToken("grt_resolve"),
  });
});
afterAll(async () => { await sql.end(); });

const reqWith = (token?: string) => new Request("http://localhost/api/chat", {
  method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {},
});

describe("resolveAuth (API-token path)", () => {
  it("resolves a userId for a valid token", async () => {
    expect((await resolveAuth(db, reqWith("grt_resolve")))?.userId).toBe("u_resolve");
  });
  it("returns null for a bad token and no session", async () => {
    expect(await resolveAuth(db, reqWith("nope"))).toBeNull();
  });
});
