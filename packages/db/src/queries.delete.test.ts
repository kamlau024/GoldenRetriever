import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb } from "./client.js";
import { createUser, createKnowledgeBase, insertDocument, insertChunks, deleteDocument, getDocument } from "./queries.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, userId: string;
beforeAll(async () => {
  userId = await createUser(db, { id: "u_del", email: "d@d.dev" });
  kbId = await createKnowledgeBase(db, { ownerId: userId, name: "Del" });
});
afterAll(async () => { await sql.end(); });

describe("deleteDocument", () => {
  it("deletes a kb-scoped document and cascades its chunks", async () => {
    const docId = await insertDocument(db, { kbId, addedBy: userId, kind: "text", captureMode: "selection", sourceUrl: null, title: "Doomed" });
    await insertChunks(db, [{ documentId: docId, kbId, ordinal: 0, content: "x", tokenCount: 1, embedding: Array(1536).fill(0.01), embeddingModel: "test" }]);
    const deleted = await deleteDocument(db, docId, kbId);
    expect(deleted).toBe(true);
    expect(await getDocument(db, docId, kbId)).toBeUndefined();
    const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM chunks WHERE document_id = ${docId}`;
    expect(rows[0].n).toBe(0);
  });
  it("returns false when the document is not in the kb", async () => {
    expect(await deleteDocument(db, "doc_missing", kbId)).toBe(false);
  });
});
