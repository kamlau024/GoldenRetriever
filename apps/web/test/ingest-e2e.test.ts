import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createDb, schema } from "@gr/db";
import { createUser, createKnowledgeBase, getDocument } from "@gr/db/queries";
import { createMockAiClient } from "@gr/ai/mock";
import { MockConverter } from "@gr/ingest";
import { hashToken } from "../lib/auth.js";
import { ingestAndProcess } from "../lib/ingest-service.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
const ai = createMockAiClient();
const conv = new MockConverter();
let userId: string, kbId: string, token: string;

beforeAll(async () => {
  userId = await createUser(db, { id: "u_e2e", email: "e@e.dev" });
  kbId = await createKnowledgeBase(db, { ownerId: userId, name: "E2E" });
  token = "grt_live_e2e";
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId, name: "e2e", tokenHash: hashToken(token),
  });
});
afterAll(async () => { await sql.end(); });

describe("ingest → process → retrievable", () => {
  it("ingests selection text and makes it answerable", async () => {
    const { documentId } = await ingestAndProcess(db, ai, conv, {
      kbId, addedBy: userId, captureMode: "selection", kind: "text",
      mimeType: "text/plain", sourceUrl: null, title: "Kyoto note",
      rawContent: "Tawaraya is a historic ryokan in central Kyoto.",
    });
    const doc = await getDocument(db, documentId, kbId);
    expect(doc?.status).toBe("ready");

    const { HybridRetriever } = await import("@gr/retrieval");
    const hits = await new HybridRetriever(db, ai).retrieve(kbId, "ryokan in Kyoto");
    expect(hits[0]?.content).toContain("Tawaraya");
  });
});
