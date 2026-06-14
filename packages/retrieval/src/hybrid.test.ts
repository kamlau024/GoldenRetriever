import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb } from "@gr/db";
import { createUser, createKnowledgeBase, insertDocument, insertChunks, setDocumentReady } from "@gr/db/queries";
import { createMockAiClient } from "@gr/ai/mock";
import { HybridRetriever } from "./hybrid.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
const ai = createMockAiClient();
let kbId: string;

beforeAll(async () => {
  const userId = await createUser(db, { id: "u_ret", email: "r@r.dev" });
  kbId = await createKnowledgeBase(db, { ownerId: userId, name: "Ret" });
  const docId = await insertDocument(db, {
    kbId, addedBy: userId, kind: "text", captureMode: "selection",
    sourceUrl: "https://example.com/kyoto", title: "Kyoto ryokans",
  });
  const contents = ["Tawaraya is a historic ryokan in central Kyoto.",
                    "The Shinkansen connects Tokyo and Osaka."];
  const embeddings = await ai.embed(contents);
  await insertChunks(db, contents.map((content, i) => ({
    documentId: docId, kbId, ordinal: i, content, tokenCount: 8,
    embedding: embeddings[i], embeddingModel: "test",
  })));
  await setDocumentReady(db, docId, { wordCount: 16, lang: "en" });
});

afterAll(async () => { await sql.end(); });

describe("HybridRetriever", () => {
  it("returns the most relevant chunk first, scoped to the kb", async () => {
    const retriever = new HybridRetriever(db, ai);
    const hits = await retriever.retrieve(kbId, "where should I stay in Kyoto, a ryokan?");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].content).toContain("Tawaraya");
    expect(hits[0].document.title).toBe("Kyoto ryokans");
  });

  it("returns nothing for a different kb", async () => {
    const retriever = new HybridRetriever(db, ai);
    const hits = await retriever.retrieve("kb_nope", "ryokan");
    expect(hits).toHaveLength(0);
  });
});
