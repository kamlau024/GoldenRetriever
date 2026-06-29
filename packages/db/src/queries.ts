import { randomUUID } from "node:crypto";
import { and, eq, desc } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { users, knowledgeBases, kbMembers, documents, chunks, conversations, messages } from "./schema.js";
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
  blobKey?: string | null;
}) {
  const docId = id("doc");
  await db.insert(documents).values({
    id: docId, kbId: d.kbId, addedBy: d.addedBy, kind: d.kind,
    captureMode: d.captureMode, sourceUrl: d.sourceUrl, title: d.title,
    mimeType: d.mimeType ?? null, metadata: d.metadata ?? null,
    blobKey: d.blobKey ?? null, status: "pending",
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

export async function upsertUser(db: Db, u: { id: string; email: string; name?: string; imageUrl?: string }) {
  await db.insert(users).values({ id: u.id, email: u.email, name: u.name, imageUrl: u.imageUrl })
    .onConflictDoUpdate({ target: users.id, set: { email: u.email, name: u.name, imageUrl: u.imageUrl } });
  return u.id;
}

export async function getOrCreatePersonalKb(db: Db, userId: string) {
  const existing = await db.select().from(knowledgeBases)
    .where(and(eq(knowledgeBases.ownerId, userId), eq(knowledgeBases.kind, "personal")));
  if (existing[0]) return existing[0].id;
  return createKnowledgeBase(db, { ownerId: userId, name: "My Library" });
}

export async function listDocuments(db: Db, kbId: string, limit = 100) {
  return db.select({
    id: documents.id, title: documents.title, sourceUrl: documents.sourceUrl,
    kind: documents.kind, captureMode: documents.captureMode,
    status: documents.status, capturedAt: documents.capturedAt,
  }).from(documents).where(eq(documents.kbId, kbId)).orderBy(desc(documents.createdAt)).limit(limit);
}

export async function createConversation(db: Db, c: { kbId: string; userId: string; title?: string }) {
  const convId = id("conv");
  await db.insert(conversations).values({ id: convId, kbId: c.kbId, userId: c.userId, title: c.title });
  return convId;
}

export async function appendMessage(db: Db, m: {
  conversationId: string; role: "user" | "assistant"; content: string;
  citations?: unknown; tokens?: number;
}) {
  const msgId = id("msg");
  await db.insert(messages).values({
    id: msgId, conversationId: m.conversationId, role: m.role, content: m.content,
    citations: m.citations ?? null, tokens: m.tokens ?? null,
  });
  return msgId;
}

export async function getMessages(db: Db, conversationId: string) {
  return db.select().from(messages)
    .where(eq(messages.conversationId, conversationId)).orderBy(messages.createdAt);
}

export async function deleteDocument(db: Db, docId: string, kbId: string): Promise<boolean> {
  const rows = await db.delete(documents)
    .where(and(eq(documents.id, docId), eq(documents.kbId, kbId)))
    .returning({ id: documents.id });
  return rows.length > 0;
}
