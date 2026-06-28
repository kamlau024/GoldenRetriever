import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb, schema } from "@gr/db";
import { eq } from "drizzle-orm";
import { createUser } from "@gr/db/queries";
import { hashToken, verifyApiToken } from "../lib/auth.js";
import { createApiToken, listApiTokens, revokeApiToken } from "../lib/tokens.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let uid: string;
beforeAll(async () => { uid = await createUser(db, { id: "u_tok", email: "t@t.dev" }); });
afterAll(async () => { await sql.end(); });

describe("token query layer", () => {
  it("createApiToken stores only the hash and returns the raw secret once", async () => {
    const { id, token } = await createApiToken(db, uid, "phone");
    expect(token.startsWith("grt_")).toBe(true);
    const row = (await db.select().from(schema.apiTokens).where(eq(schema.apiTokens.id, id)))[0];
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.tokenHash).not.toContain(token);
    // the raw token authenticates
    expect((await verifyApiToken(db, token))?.userId).toBe(uid);
  });

  it("listApiTokens returns summaries without the secret/hash and reflects revocation", async () => {
    const { id, token } = await createApiToken(db, uid, "laptop");
    let list = await listApiTokens(db, uid);
    const found = list.find((t) => t.id === id)!;
    expect(found.name).toBe("laptop");
    expect(found.revoked).toBe(false);
    expect((found as unknown as Record<string, unknown>).tokenHash).toBeUndefined();
    expect(await revokeApiToken(db, uid, id)).toBe(true);
    list = await listApiTokens(db, uid);
    expect(list.find((t) => t.id === id)!.revoked).toBe(true);
    // a revoked token no longer authenticates
    expect(await verifyApiToken(db, token)).toBeNull();
  });

  it("revokeApiToken returns false for a token the user does not own (IDOR-safe)", async () => {
    const other = await createUser(db, { id: "u_tok_other", email: "o@t.dev" });
    const { id } = await createApiToken(db, other, "theirs");
    expect(await revokeApiToken(db, uid, id)).toBe(false);
  });
});
