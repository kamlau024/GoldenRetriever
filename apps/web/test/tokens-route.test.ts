import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser } from "@gr/db/queries";
import { hashToken } from "../lib/auth.js";
import { __setSessionUser, __clearSessionUser } from "../lib/clerk-auth.js";
import { POST, GET } from "../app/api/tokens/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let bearer: string;
beforeAll(async () => {
  await createUser(db, { id: "u_tr", email: "tr@tr.dev" });
  bearer = "grt_tr_capture";
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId: "u_tr", name: "cap", tokenHash: hashToken(bearer),
  });
});
afterEach(() => __clearSessionUser());
afterAll(async () => { __clearSessionUser(); await sql.end(); });

const jsonReq = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost/api/tokens", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });

describe("POST/GET /api/tokens", () => {
  it("401 without a session", async () => {
    __setSessionUser(null);
    expect((await POST(jsonReq({ name: "x" }))).status).toBe(401);
  });

  it("does NOT accept a bearer capture token (privilege-escalation guard)", async () => {
    __clearSessionUser(); // no session; only a bearer header present
    const res = await POST(jsonReq({ name: "evil" }, { authorization: `Bearer ${bearer}` }));
    expect(res.status).toBe(401);
  });

  it("400 on an empty name", async () => {
    __setSessionUser("u_tr");
    expect((await POST(jsonReq({ name: "  " }))).status).toBe(400);
  });

  it("creates a token (201) and lists it (200)", async () => {
    __setSessionUser("u_tr");
    const created = await POST(jsonReq({ name: "iPhone" }));
    expect(created.status).toBe(201);
    const body = await created.json() as { token: string; name: string };
    expect(body.token.startsWith("grt_")).toBe(true);
    expect(body.name).toBe("iPhone");

    const listed = await GET(new NextRequest("http://localhost/api/tokens"));
    expect(listed.status).toBe(200);
    const { tokens } = await listed.json() as { tokens: { name: string }[] };
    expect(tokens.some((t) => t.name === "iPhone")).toBe(true);
  });
});
