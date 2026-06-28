import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createDb } from "@gr/db";
import { createUser } from "@gr/db/queries";
import { createApiToken } from "../lib/tokens.js";
import { __setSessionUser, __clearSessionUser } from "../lib/clerk-auth.js";
import { DELETE } from "../app/api/tokens/[id]/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
beforeAll(async () => {
  await createUser(db, { id: "u_rv", email: "rv@rv.dev" });
  await createUser(db, { id: "u_rv2", email: "rv2@rv.dev" });
});
afterEach(() => __clearSessionUser());
afterAll(async () => { __clearSessionUser(); await sql.end(); });

const del = (id: string) =>
  DELETE(new NextRequest(`http://localhost/api/tokens/${id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id }) });

describe("DELETE /api/tokens/:id", () => {
  it("revokes the caller's own token (200)", async () => {
    __setSessionUser("u_rv");
    const { id } = await createApiToken(db, "u_rv", "mine");
    expect((await del(id)).status).toBe(200);
  });
  it("404 when revoking another user's token (IDOR)", async () => {
    const { id } = await createApiToken(db, "u_rv2", "theirs");
    __setSessionUser("u_rv");
    expect((await del(id)).status).toBe(404);
  });
  it("401 without a session", async () => {
    __setSessionUser(null);
    expect((await del("tok_whatever")).status).toBe(401);
  });
});
