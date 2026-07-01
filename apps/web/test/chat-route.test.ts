import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { createDb, schema } from "@gr/db";
import { createUser, getOrCreatePersonalKb, getMessages } from "@gr/db/queries";
import type { RankedChunk } from "@gr/core";
import type { Retriever } from "@gr/retrieval";
import { hashToken } from "../lib/auth.js";
import { __setChatDeps } from "../lib/chat-service.js";
import { POST } from "../app/api/chat/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, token: string;

// ai@6.x uses MockLanguageModelV3; stream parts use V3 shape:
//   text-start / text-delta (with id) / text-end / finish (with nested usage).
// We cast doStream to any to avoid fighting TypeScript's structural-union narrowing
// on the chunk array — the runtime shape is correct and tests verify the behavior.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const modelSaying = (text: string) => new MockLanguageModelV3({
  doStream: (async () => ({
    stream: simulateReadableStream({
      chunks: [
        { type: "text-start" as const, id: "t1" },
        { type: "text-delta" as const, id: "t1", delta: text },
        { type: "text-end" as const, id: "t1" },
        {
          type: "finish" as const,
          finishReason: "stop" as const,
          usage: {
            inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 5, text: 5, reasoning: undefined },
          },
        },
      ],
    }),
  })) as any,
});
const retrieverReturning = (chunks: RankedChunk[]): Retriever => ({ retrieve: async () => chunks });
const chunk = (content: string): RankedChunk => ({
  chunkId: "c1", documentId: "d1", content, score: 1,
  document: { title: "Kyoto", sourceUrl: null, addedBy: "u_chat_r", capturedAt: new Date() },
});
const post = (body: unknown) => POST(new NextRequest("http://localhost/api/chat", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
}));

beforeAll(async () => {
  const uid = await createUser(db, { id: "u_chat_r", email: "cr@cr.dev" });
  kbId = await getOrCreatePersonalKb(db, uid);
  token = "grt_chat";
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId: uid, name: "t", tokenHash: hashToken(token),
  });
});
afterAll(async () => { __setChatDeps(null); await sql.end(); });

describe("POST /api/chat", () => {
  it("streams a grounded answer and persists the exchange", async () => {
    __setChatDeps({ retriever: retrieverReturning([chunk("Tawaraya is a ryokan in Kyoto.")]), model: modelSaying("Stay at Tawaraya [1].") });
    const res = await post({ kbId, message: "where to stay in Kyoto?" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Tawaraya");
    const { parseCitations } = await import("../lib/citations.js");
    const cites = parseCitations(res.headers.get("x-citations"));
    expect(cites[0]?.documentId).toBe("d1");
    const convId = res.headers.get("x-conversation-id");
    expect(convId).toBeTruthy();
    const msgs = await getMessages(db, convId!);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("refuses honestly when nothing relevant is retrieved", async () => {
    __setChatDeps({ retriever: retrieverReturning([]), model: modelSaying("(should not be used)") });
    const res = await post({ kbId, message: "unrelated question" });
    expect(await res.text()).toContain("don't have anything saved");
  });

  it("401 without auth", async () => {
    const res = await POST(new NextRequest("http://localhost/api/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kbId, message: "hi" }),
    }));
    expect(res.status).toBe(401);
  });

  it("titles a new conversation from the model and persists it", async () => {
    __setChatDeps({
      retriever: retrieverReturning([chunk("Tawaraya is a ryokan in Kyoto.")]),
      model: modelSaying("Stay at Tawaraya [1]."),
      titleConversation: async () => "Kyoto stay",
    });
    const res = await post({ kbId, message: "where to stay in Kyoto?" });
    const convId = res.headers.get("x-conversation-id")!;
    await res.text(); // drain the stream so onFinish (and titling) runs
    const { getConversationForUser } = await import("@gr/db/queries");
    expect((await getConversationForUser(db, convId, "u_chat_r"))!.title).toBe("Kyoto stay");
  });

  it("falls back to a snippet title when titling throws", async () => {
    __setChatDeps({
      retriever: retrieverReturning([chunk("Bread needs flour, water, salt, yeast.")]),
      model: modelSaying("Mix and bake [1]."),
      titleConversation: async () => { throw new Error("model down"); },
    });
    const res = await post({ kbId, message: "how do I bake no knead bread at home" });
    const convId = res.headers.get("x-conversation-id")!;
    await res.text();
    const { getConversationForUser } = await import("@gr/db/queries");
    expect((await getConversationForUser(db, convId, "u_chat_r"))!.title).toBe("how do I bake no knead");
  });

  it("404s when continuing a conversation the caller does not own", async () => {
    const { createUser, createConversation, getOrCreatePersonalKb } = await import("@gr/db/queries");
    const otherUid = await createUser(db, { id: "u_chat_other", email: "co@cr.dev" });
    const otherKb = await getOrCreatePersonalKb(db, otherUid);
    const foreignConv = await createConversation(db, { kbId: otherKb, userId: otherUid });
    __setChatDeps({ retriever: retrieverReturning([chunk("x")]), model: modelSaying("nope") });
    const res = await post({ kbId, conversationId: foreignConv, message: "sneaky" });
    expect(res.status).toBe(404);
  });
});
