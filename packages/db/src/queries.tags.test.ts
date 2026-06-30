import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb } from "./client.js";
import { createUser, createKnowledgeBase, insertDocument, setDocumentTags, listDocuments } from "./queries.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, uid: string;
beforeAll(async () => {
  uid = await createUser(db, { id: "u_tags", email: "t@t.dev" });
  kbId = await createKnowledgeBase(db, { ownerId: uid, name: "Tags" });
});
afterAll(async () => { await sql.end(); });

describe("document tags", () => {
  it("stores deduped, idempotent tags and returns them on listDocuments", async () => {
    const docId = await insertDocument(db, {
      kbId, addedBy: uid, kind: "text", captureMode: "selection",
      sourceUrl: null, title: "T", mimeType: "text/plain",
    });
    await setDocumentTags(db, kbId, docId, ["kyoto", "travel", "kyoto", "  "]); // dup + blank ignored
    await setDocumentTags(db, kbId, docId, ["travel"]); // re-tagging is idempotent
    const doc = (await listDocuments(db, kbId)).find((d) => d.id === docId)!;
    expect([...doc.tags].sort()).toEqual(["kyoto", "travel"]);
  });

  it("returns an empty tags array for an untagged document", async () => {
    const docId = await insertDocument(db, {
      kbId, addedBy: uid, kind: "text", captureMode: "selection",
      sourceUrl: null, title: "U", mimeType: "text/plain",
    });
    const doc = (await listDocuments(db, kbId)).find((d) => d.id === docId)!;
    expect(doc.tags).toEqual([]);
  });
});
