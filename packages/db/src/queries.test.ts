import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb } from "./client.js";
import { createUser, createKnowledgeBase, insertDocument, insertChunks, setDocumentReady, getDocument } from "./queries.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);

let userId: string;
let kbId: string;

beforeAll(async () => {
  userId = await createUser(db, { id: "u_test", email: "t@t.dev", name: "T" });
  kbId = await createKnowledgeBase(db, { ownerId: userId, name: "Personal" });
});

afterAll(async () => { await sql.end(); });

describe("document queries", () => {
  it("inserts a pending document scoped to the kb", async () => {
    const docId = await insertDocument(db, {
      kbId, addedBy: userId, kind: "text", captureMode: "selection",
      sourceUrl: null, title: "Note",
    });
    const doc = await getDocument(db, docId, kbId);
    expect(doc?.status).toBe("pending");
    expect(doc?.kbId).toBe(kbId);
  });

  it("stores chunks with embeddings and marks the doc ready", async () => {
    const docId = await insertDocument(db, {
      kbId, addedBy: userId, kind: "text", captureMode: "selection",
      sourceUrl: null, title: "Note2",
    });
    await insertChunks(db, [
      { documentId: docId, kbId, ordinal: 0, content: "hello world", tokenCount: 2,
        embedding: Array(1536).fill(0.01), embeddingModel: "test" },
    ]);
    await setDocumentReady(db, docId, { wordCount: 2, lang: "en" });
    const doc = await getDocument(db, docId, kbId);
    expect(doc?.status).toBe("ready");
    expect(doc?.wordCount).toBe(2);
  });

  it("does not return a document from a different kb", async () => {
    const docId = await insertDocument(db, {
      kbId, addedBy: userId, kind: "text", captureMode: "selection",
      sourceUrl: null, title: "Scoped",
    });
    const doc = await getDocument(db, docId, "kb_other");
    expect(doc).toBeUndefined();
  });
});
