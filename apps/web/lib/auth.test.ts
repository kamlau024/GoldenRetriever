import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createDb, schema } from "@gr/db";
import { createUser } from "@gr/db/queries";
import { hashToken, verifyApiToken } from "./auth.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);

beforeAll(async () => {
  const userId = await createUser(db, { id: "u_auth", email: "a@a.dev" });
  const token = "grt_live_secret123";
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId, name: "cli", tokenHash: hashToken(token),
  });
});
afterAll(async () => { await sql.end(); });

describe("verifyApiToken", () => {
  it("resolves the user for a valid token", async () => {
    const user = await verifyApiToken(db, "grt_live_secret123");
    expect(user?.userId).toBe("u_auth");
  });
  it("returns null for an unknown token", async () => {
    expect(await verifyApiToken(db, "grt_live_nope")).toBeNull();
  });
});
