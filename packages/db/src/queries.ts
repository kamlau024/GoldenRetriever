import { randomUUID } from "node:crypto";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { users, knowledgeBases, kbMembers, documents, chunks, conversations, messages, tags, documentTags, memories } from "./schema.js";
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

/** Upsert auto-tags for a document (best-effort, called from the ingest pipeline). */
export async function setDocumentTags(db: Db, kbId: string, documentId: string, slugs: string[]) {
  for (const raw of slugs) {
    const slug = raw.trim();
    if (!slug) continue;
    const existing = await db.select({ id: tags.id }).from(tags)
      .where(and(eq(tags.kbId, kbId), eq(tags.slug, slug)));
    let tagId = existing[0]?.id;
    if (!tagId) {
      tagId = id("tag");
      await db.insert(tags).values({ id: tagId, kbId, name: slug, slug }).onConflictDoNothing();
    }
    await db.insert(documentTags).values({ documentId, tagId }).onConflictDoNothing();
  }
}

/** Ready documents in a KB that have no tags yet, with their content concatenated — used to
 *  backfill tags for documents ingested before auto-tagging stored its results. */
export async function untaggedDocsContent(db: Db, kbId: string): Promise<{ id: string; content: string }[]> {
  const rows = await db.execute<{ id: string; content: string }>(sql`
    SELECT d.id, string_agg(c.content, ' ' ORDER BY c.ordinal) AS content
    FROM documents d JOIN chunks c ON c.document_id = d.id
    WHERE d.kb_id = ${kbId} AND d.status = 'ready'
      AND NOT EXISTS (SELECT 1 FROM document_tags dt WHERE dt.document_id = d.id)
    GROUP BY d.id`);
  return [...rows] as { id: string; content: string }[];
}

export async function listDocuments(db: Db, kbId: string, limit = 100) {
  const docs = await db.select({
    id: documents.id, title: documents.title, sourceUrl: documents.sourceUrl,
    kind: documents.kind, captureMode: documents.captureMode,
    status: documents.status, capturedAt: documents.capturedAt,
  }).from(documents).where(eq(documents.kbId, kbId)).orderBy(desc(documents.createdAt)).limit(limit);
  if (docs.length === 0) return docs.map((d) => ({ ...d, tags: [] as string[] }));

  const tagRows = await db.select({ documentId: documentTags.documentId, slug: tags.slug })
    .from(documentTags).innerJoin(tags, eq(documentTags.tagId, tags.id))
    .where(inArray(documentTags.documentId, docs.map((d) => d.id)));
  const byDoc = new Map<string, string[]>();
  for (const r of tagRows) {
    const arr = byDoc.get(r.documentId) ?? [];
    arr.push(r.slug);
    byDoc.set(r.documentId, arr);
  }
  return docs.map((d) => ({ ...d, tags: byDoc.get(d.id) ?? [] }));
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  lastActivityAt: Date;
  messageCount: number;
}
export interface ConversationDetail {
  id: string;
  title: string | null;
  messages: { id: string; role: string; content: string; citations: unknown }[];
}

/** Conversations for (user, kb), newest-activity first, with message counts. Ordered by the latest
 *  message time (falling back to the conversation's own createdAt) so revisited threads bubble up —
 *  no `updated_at` column needed. */
export async function listConversations(db: Db, userId: string, kbId: string): Promise<ConversationSummary[]> {
  const rows = await db.execute<{ id: string; title: string | null; last_activity_at: Date; message_count: number }>(sql`
    SELECT c.id, c.title,
           COALESCE(MAX(m.created_at), c.created_at) AS last_activity_at,
           COUNT(m.id)::int AS message_count
    FROM conversations c
    LEFT JOIN messages m ON m.conversation_id = c.id
    WHERE c.user_id = ${userId} AND c.kb_id = ${kbId}
    GROUP BY c.id
    ORDER BY last_activity_at DESC`);
  return [...rows].map((r) => ({
    id: r.id,
    title: r.title,
    lastActivityAt: new Date(r.last_activity_at),
    messageCount: Number(r.message_count),
  }));
}

/** A conversation and its messages — but only if `userId` owns it; otherwise null (no info leak). */
export async function getConversationForUser(db: Db, conversationId: string, userId: string): Promise<ConversationDetail | null> {
  const conv = await db.select({ id: conversations.id, title: conversations.title })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
  if (!conv[0]) return null;
  const msgs = await db.select({
    id: messages.id, role: messages.role, content: messages.content, citations: messages.citations,
  }).from(messages).where(eq(messages.conversationId, conversationId)).orderBy(messages.createdAt);
  return { id: conv[0].id, title: conv[0].title, messages: msgs };
}

/** Delete a conversation (messages cascade via FK) — only if `userId` owns it. Returns whether a row
 *  was removed. */
export async function deleteConversation(db: Db, conversationId: string, userId: string): Promise<boolean> {
  const rows = await db.delete(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .returning({ id: conversations.id });
  return rows.length > 0;
}

export async function setConversationTitle(db: Db, conversationId: string, title: string): Promise<void> {
  await db.update(conversations).set({ title }).where(eq(conversations.id, conversationId));
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

export interface MemoryRow {
  id: string; content: string; kind: string;
  sourceConversationId: string | null; createdAt: Date; updatedAt: Date;
}

/** The user's memory toggle + the plain fact contents for prompt injection. */
export async function getMemoryState(db: Db, userId: string): Promise<{ enabled: boolean; facts: string[] }> {
  const u = await db.select({ enabled: users.memoryEnabled }).from(users).where(eq(users.id, userId));
  const rows = await db.select({ content: memories.content }).from(memories)
    .where(eq(memories.userId, userId)).orderBy(memories.createdAt);
  return { enabled: u[0]?.enabled ?? true, facts: rows.map((r) => r.content) };
}

/** Full memory rows for the settings UI, newest first. */
export async function listMemories(db: Db, userId: string): Promise<MemoryRow[]> {
  return db.select({
    id: memories.id, content: memories.content, kind: memories.kind,
    sourceConversationId: memories.sourceConversationId,
    createdAt: memories.createdAt, updatedAt: memories.updatedAt,
  }).from(memories).where(eq(memories.userId, userId)).orderBy(desc(memories.createdAt));
}

/** Insert a fact unless a near-duplicate (cosine distance < maxDistance) already exists for the user.
 *  Returns whether a row was inserted. */
export async function insertMemoryIfNovel(
  db: Db,
  m: { userId: string; content: string; kind: string; embedding: number[]; sourceConversationId: string | null },
  maxDistance = 0.15,
): Promise<boolean> {
  const vec = `[${m.embedding.join(",")}]`;
  const dup = await db.execute<{ one: number }>(sql`
    SELECT 1 AS one FROM memories
    WHERE user_id = ${m.userId} AND embedding IS NOT NULL
      AND embedding <=> ${vec}::vector < ${maxDistance}
    LIMIT 1`);
  if ([...dup].length > 0) return false;
  await db.insert(memories).values({
    id: id("mem"), userId: m.userId, content: m.content, kind: m.kind,
    sourceConversationId: m.sourceConversationId, embedding: m.embedding,
  });
  return true;
}

/** Edit a memory's content (and re-embed) — owner only. */
export async function updateMemory(db: Db, id: string, userId: string, content: string, embedding: number[]): Promise<boolean> {
  const rows = await db.update(memories)
    .set({ content, embedding, updatedAt: new Date() })
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
    .returning({ id: memories.id });
  return rows.length > 0;
}

/** Delete a memory — owner only. */
export async function deleteMemory(db: Db, id: string, userId: string): Promise<boolean> {
  const rows = await db.delete(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
    .returning({ id: memories.id });
  return rows.length > 0;
}

export async function clearMemories(db: Db, userId: string): Promise<void> {
  await db.delete(memories).where(eq(memories.userId, userId));
}

/** Map the given document ids to their `kind` (for the citation source icon). */
export async function getDocumentKinds(db: Db, documentIds: string[]): Promise<Map<string, string>> {
  if (documentIds.length === 0) return new Map();
  const rows = await db.select({ id: documents.id, kind: documents.kind })
    .from(documents).where(inArray(documents.id, documentIds));
  return new Map(rows.map((r) => [r.id, r.kind]));
}

export async function setMemoryEnabled(db: Db, userId: string, enabled: boolean): Promise<void> {
  await db.update(users).set({ memoryEnabled: enabled }).where(eq(users.id, userId));
}
