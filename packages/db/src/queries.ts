import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { users, knowledgeBases, kbMembers, documents, chunks } from "./schema.js";
import type { NewChunk } from "./schema.js";

type Db = ReturnType<typeof drizzle>;
const id = (p: string) => `${p}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

export async function createUser(db: Db, u: { id: string; email: string; name?: string }) {
  await db.insert(users).values({ id: u.id, email: u.email, name: u.name })
    .onConflictDoNothing();
  return u.id;
}

export async function createKnowledgeBase(db: Db, kb: { ownerId: string; name: string }) {
  const kbId = id("kb");
  await db.insert(knowledgeBases).values({ id: kbId, ownerId: kb.ownerId, name: kb.name });
  await db.insert(kbMembers).values({ kbId, userId: kb.ownerId, role: "owner" });
  return kbId;
}

export async function insertDocument(db: Db, d: {
  kbId: string; addedBy: string; kind: string; captureMode: string;
  sourceUrl: string | null; title: string | null;
  mimeType?: string | null; metadata?: Record<string, unknown> | null;
}) {
  const docId = id("doc");
  await db.insert(documents).values({
    id: docId, kbId: d.kbId, addedBy: d.addedBy, kind: d.kind,
    captureMode: d.captureMode, sourceUrl: d.sourceUrl, title: d.title,
    mimeType: d.mimeType ?? null, metadata: d.metadata ?? null, status: "pending",
  });
  return docId;
}

export async function insertChunks(db: Db, rows: Omit<NewChunk, "id">[]) {
  if (rows.length === 0) return;
  await db.insert(chunks).values(rows.map((r) => ({ ...r, id: id("chk") })));
}

export async function setDocumentReady(db: Db, docId: string, meta: { wordCount: number; lang: string }) {
  await db.update(documents)
    .set({ status: "ready", wordCount: meta.wordCount, lang: meta.lang })
    .where(eq(documents.id, docId));
}

export async function setDocumentFailed(db: Db, docId: string) {
  await db.update(documents).set({ status: "failed" }).where(eq(documents.id, docId));
}

export async function getDocument(db: Db, docId: string, kbId: string) {
  const rows = await db.select().from(documents)
    .where(and(eq(documents.id, docId), eq(documents.kbId, kbId)));
  return rows[0];
}
