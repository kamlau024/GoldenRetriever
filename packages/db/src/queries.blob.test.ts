import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb } from "./client.js";
import { createUser, createKnowledgeBase, insertDocument, getDocument } from "./queries.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, userId: string;
beforeAll(async () => {
  userId = await createUser(db, { id: "u_blob", email: "b@b.dev" });
  kbId = await createKnowledgeBase(db, { ownerId: userId, name: "Blob" });
});
afterAll(async () => { await sql.end(); });

it("persists a blobKey on the document", async () => {
  const docId = await insertDocument(db, {
    kbId, addedBy: userId, kind: "pdf", captureMode: "upload",
    sourceUrl: null, title: "report.pdf", mimeType: "application/pdf", blobKey: "mem://abc",
  });
  const doc = await getDocument(db, docId, kbId);
  expect(doc?.blobKey).toBe("mem://abc");
});
