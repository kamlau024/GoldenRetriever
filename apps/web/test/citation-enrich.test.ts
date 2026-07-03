import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { createDb, schema } from "@gr/db";
import { createUser, getOrCreatePersonalKb, createConversation, appendMessage, getConversationForUser } from "@gr/db/queries";
import { enrichStoredCitations } from "../lib/citation-enrich.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, uid: string;
const DOC = "doc_ce1", CHUNK = "chk_ce1";

beforeAll(async () => {
  // idempotent: clear leftovers from any interrupted prior run (doc first — added_by has no cascade).
  await db.delete(schema.documents).where(inArray(schema.documents.id, [DOC]));
  await db.delete(schema.users).where(inArray(schema.users.id, ["u_citeenrich"]));
  uid = await createUser(db, { id: "u_citeenrich", email: "ce@ce.dev" });
  kbId = await getOrCreatePersonalKb(db, uid);
  await db.insert(schema.documents).values({
    id: DOC, kbId, addedBy: uid, kind: "web", captureMode: "url_fetch",
    title: "Crusty no-knead bread", sourceUrl: "https://bluebowl.example/bread",
  });
  await db.insert(schema.chunks).values({
    id: CHUNK, documentId: DOC, kbId, ordinal: 0, tokenCount: 14,
    content: "Bake in a preheated dutch oven at 425°F for 30 minutes covered.",
  });
});
afterAll(async () => {
  // documents.added_by has no cascade on user delete — remove the doc (cascades its chunks) first.
  await db.delete(schema.documents).where(inArray(schema.documents.id, [DOC]));
  await db.delete(schema.users).where(inArray(schema.users.id, ["u_citeenrich"]));
  await sql.end();
});

const assistantCite = async (citations: unknown) => {
  const conv = await createConversation(db, { kbId, userId: uid });
  await appendMessage(db, { conversationId: conv, role: "assistant", content: "answer [1].", citations });
  const detail = await getConversationForUser(db, conv, uid);
  const enriched = await enrichStoredCitations(db, detail!.messages);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (enriched.find((m) => m.role === "assistant")!.citations as any[])[0];
};

describe("enrichStoredCitations", () => {
  it("backfills kind + content on pre-feature citations from documentId + chunkId", async () => {
    // Pre-feature stored shape: no kind, no content — only chunkId/documentId/title/sourceUrl.
    const cite = await assistantCite([{ chunkId: CHUNK, documentId: DOC, title: "Crusty no-knead bread", sourceUrl: "https://bluebowl.example/bread" }]);
    expect(cite.kind).toBe("web");                 // from documents.kind
    expect(cite.content).toContain("dutch oven");  // from chunks.content
  });

  it("leaves already-complete citations untouched (does not override the stored snapshot)", async () => {
    const cite = await assistantCite([{ chunkId: CHUNK, documentId: DOC, title: "t", sourceUrl: null, kind: "text", content: "ORIGINAL SNAPSHOT" }]);
    expect(cite.kind).toBe("text");                // not overridden to the doc's "web"
    expect(cite.content).toBe("ORIGINAL SNAPSHOT");
  });

  it("falls back gracefully when the source chunk/doc no longer exists", async () => {
    const cite = await assistantCite([{ chunkId: "chk_gone", documentId: "doc_gone", title: "t", sourceUrl: null }]);
    expect(cite.kind).toBe("text");  // default when documentId not found
    expect(cite.content).toBe("");   // empty when chunk not found
  });
});
