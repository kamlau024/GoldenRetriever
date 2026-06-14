import {
  pgTable, text, timestamp, integer, jsonb, real,
  vector, index, primaryKey, customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// tsvector is not a first-class Drizzle type; declare it minimally.
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const users = pgTable("users", {
  id: text("id").primaryKey(), // = Clerk user id
  email: text("email").notNull(),
  name: text("name"),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const apiTokens = pgTable("api_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("api_tokens_hash_idx").on(t.tokenHash)]);

export const knowledgeBases = pgTable("knowledge_bases", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("personal"), // 'personal' | 'shared'
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const kbMembers = pgTable("kb_members", {
  kbId: text("kb_id").notNull().references(() => knowledgeBases.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("owner"), // 'owner' | 'editor' | 'viewer'
}, (t) => [primaryKey({ columns: [t.kbId, t.userId] })]);

export const documents = pgTable("documents", {
  id: text("id").primaryKey(),
  kbId: text("kb_id").notNull().references(() => knowledgeBases.id, { onDelete: "cascade" }),
  addedBy: text("added_by").notNull().references(() => users.id),
  sourceUrl: text("source_url"),
  title: text("title"),
  kind: text("kind").notNull(),          // 'web' | 'pdf' | 'document' | 'image' | 'text'
  mimeType: text("mime_type"),           // detected source MIME; drives converter routing
  captureMode: text("capture_mode").notNull(),
  status: text("status").notNull().default("pending"),
  blobKey: text("blob_key"),
  lang: text("lang"),
  wordCount: integer("word_count"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // Reserved Stage-3 seam (document refresh). Null / 0 in the prototype.
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  updateCount: integer("update_count").notNull().default(0),
  metadata: jsonb("metadata"),
}, (t) => [
  index("documents_kb_status_idx").on(t.kbId, t.status),
  index("documents_kb_created_idx").on(t.kbId, t.createdAt),
]);

export const chunks = pgTable("chunks", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  kbId: text("kb_id").notNull().references(() => knowledgeBases.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  content: text("content").notNull(),
  tokenCount: integer("token_count").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  embeddingModel: text("embedding_model"),
  fts: tsvector("fts").generatedAlwaysAs(
    (): any => sql`to_tsvector('english', ${chunks.content})`
  ),
}, (t) => [
  index("chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  index("chunks_fts_idx").using("gin", t.fts),
  index("chunks_kb_idx").on(t.kbId),
]);

export const tags = pgTable("tags", {
  id: text("id").primaryKey(),
  kbId: text("kb_id").notNull().references(() => knowledgeBases.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
});

export const documentTags = pgTable("document_tags", {
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  confidence: real("confidence"),
}, (t) => [primaryKey({ columns: [t.documentId, t.tagId] })]);

export const ingestionJobs = pgTable("ingestion_jobs", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("ingest"), // 'ingest' (Stage 0)
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  enqueuedAt: timestamp("enqueued_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  kbId: text("kb_id").notNull().references(() => knowledgeBases.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // 'user' | 'assistant'
  content: text("content").notNull(),
  citations: jsonb("citations"),
  tokens: integer("tokens"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;
