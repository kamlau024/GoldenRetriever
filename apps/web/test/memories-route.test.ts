import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { createDb } from "@gr/db";
import { createUser, insertMemoryIfNovel, listMemories } from "@gr/db/queries";
import { createMockAiClient } from "@gr/ai/mock";
import { MockConverter } from "@gr/ingest";
import { __setSessionUser, __clearSessionUser } from "../lib/clerk-auth.js";
import { __setIngestDeps } from "../lib/ingest-service.js";
import { GET as memGet, DELETE as memClear } from "../app/api/memories/route.js";
import { PATCH as memPatch, DELETE as memDelete } from "../app/api/memories/[id]/route.js";
import { PATCH as settingsPatch } from "../app/api/settings/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
const req = (body?: unknown, method = "GET") =>
  new NextRequest("http://localhost/x", { method, ...(body ? { body: JSON.stringify(body) } : {}) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const vec = new Array(1536).fill(0).map((_, i) => (i === 9 ? 1 : 0));

beforeAll(async () => {
  await createUser(db, { id: "u_mem_ep", email: "mep@m.dev" });
  await createUser(db, { id: "u_mem_ep2", email: "mep2@m.dev" });
  __setIngestDeps({ ai: createMockAiClient(), converter: new MockConverter(), urlFetcher: async () => ({ kind: "text" as const, mimeType: "text/plain", text: "" }) });
});
afterAll(async () => { __clearSessionUser(); __setIngestDeps(null); await sql.end(); });

describe("memory endpoints", () => {
  it("401 without a session", async () => {
    __setSessionUser(null);
    expect((await memGet(req())).status).toBe(401);
  });

  it("lists, edits, and deletes only the caller's memories", async () => {
    __setSessionUser("u_mem_ep");
    await insertMemoryIfNovel(db, { userId: "u_mem_ep", content: "orig fact", kind: "fact", embedding: vec, sourceConversationId: null });
    const list = await (await memGet(req())).json();
    const id = list.memories[0].id as string;

    // a different user cannot edit it
    __setSessionUser("u_mem_ep2");
    expect((await memPatch(req({ content: "hacked" }, "PATCH"), ctx(id))).status).toBe(404);

    __setSessionUser("u_mem_ep");
    expect((await memPatch(req({ content: "edited fact" }, "PATCH"), ctx(id))).status).toBe(200);
    expect((await listMemories(db, "u_mem_ep"))[0].content).toBe("edited fact");
    expect((await memDelete(req(undefined, "DELETE"), ctx(id))).status).toBe(200);
  });

  it("clears all and toggles memory_enabled", async () => {
    __setSessionUser("u_mem_ep");
    await insertMemoryIfNovel(db, { userId: "u_mem_ep", content: "a", kind: "fact", embedding: vec, sourceConversationId: null });
    expect((await memClear(req(undefined, "DELETE"))).status).toBe(200);
    expect(await listMemories(db, "u_mem_ep")).toEqual([]);
    expect((await settingsPatch(req({ memoryEnabled: false }, "PATCH"))).status).toBe(200);
    const { getMemoryState } = await import("@gr/db/queries");
    expect((await getMemoryState(db, "u_mem_ep")).enabled).toBe(false);
  });
});
