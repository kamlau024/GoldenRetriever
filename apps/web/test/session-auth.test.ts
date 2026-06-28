import { describe, it, expect, afterEach } from "vitest";
import { resolveSessionUser, __setSessionUser, __clearSessionUser } from "../lib/clerk-auth.js";

const db = {} as never; // not used on the override / no-session paths
afterEach(() => __clearSessionUser());

describe("resolveSessionUser", () => {
  it("returns the overridden session user", async () => {
    __setSessionUser("u_x");
    expect(await resolveSessionUser(db, new Request("http://x"))).toEqual({ userId: "u_x" });
  });
  it("returns null when overridden to no session", async () => {
    __setSessionUser(null);
    expect(await resolveSessionUser(db, new Request("http://x"))).toBeNull();
  });
  it("does NOT authenticate a bearer token (session-only)", async () => {
    __clearSessionUser(); // fall through to Clerk, which has no context in tests → null
    const req = new Request("http://x", { headers: { authorization: "Bearer grt_anything" } });
    expect(await resolveSessionUser(db, req)).toBeNull();
  });
});
