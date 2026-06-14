# GoldenRetriever Stage 0 — Backend Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tested backend that turns submitted page content into a searchable, citable personal knowledge base — ingest (parse → chunk → embed → tag → store) and hybrid grounded retrieval — exposed through one client-agnostic ingest API.

**Architecture:** A pnpm + Turborepo monorepo. Pure-logic packages (`config`, `core`, `ingest`, `retrieval` fusion, `ai` config) are unit-tested with no I/O. Stateful pieces (`db`, `ai` calls, `retrieval` queries, the ingest API + worker) are integration-tested against a real Postgres+pgvector container, with model calls mocked at the `ai` package boundary. Everything is scoped to a `knowledge_base` (multi-tenant from day one).

**Tech Stack:** TypeScript, pnpm workspaces, Turborepo, Vitest, Next.js (App Router), Drizzle ORM + drizzle-kit, Postgres 17 + pgvector, Vercel AI SDK v6 + AI Gateway, `@mozilla/readability` + `jsdom` + `turndown`.

**Scope of this plan (Plan 1 of 3):** Backend core only. No browser extension, no rich web UI, no Clerk UI (API-token auth only for the ingest endpoint). Those are Plans 2 and 3. Document refresh/RSS is deferred to Stage 3 per the spec.

---

## File Structure

```
goldenretriever/
├─ package.json                       pnpm workspace root, scripts
├─ pnpm-workspace.yaml
├─ turbo.json
├─ tsconfig.base.json
├─ vitest.config.ts                   root vitest project config
├─ docker-compose.test.yml            Postgres+pgvector for integration tests
├─ .env.example
├─ packages/
│  ├─ config/                         env schema (zod)
│  │  ├─ package.json
│  │  ├─ src/env.ts
│  │  └─ src/env.test.ts
│  ├─ core/                           cross-cutting domain types
│  │  ├─ package.json
│  │  └─ src/index.ts
│  ├─ db/                             Drizzle schema, client, queries
│  │  ├─ package.json
│  │  ├─ drizzle.config.ts
│  │  ├─ src/schema.ts
│  │  ├─ src/client.ts
│  │  ├─ src/queries.ts
│  │  └─ src/queries.test.ts
│  ├─ ingest/                         parse + chunk (pure)
│  │  ├─ package.json
│  │  ├─ src/extract.ts
│  │  ├─ src/extract.test.ts
│  │  ├─ src/chunk.ts
│  │  └─ src/chunk.test.ts
│  ├─ ai/                             model config + embed/generate/rerank
│  │  ├─ package.json
│  │  ├─ src/models.ts
│  │  ├─ src/models.test.ts
│  │  ├─ src/index.ts                 AiClient interface + real impl
│  │  └─ src/mock.ts                  MockAiClient for tests
│  └─ retrieval/                      Retriever interface + hybrid
│     ├─ package.json
│     ├─ src/rrf.ts
│     ├─ src/rrf.test.ts
│     ├─ src/hybrid.ts
│     └─ src/hybrid.test.ts
└─ apps/
   └─ web/                            Next.js (API only in Plan 1)
      ├─ package.json
      ├─ next.config.ts
      ├─ app/api/ingest/route.ts
      ├─ app/api/worker/route.ts
      ├─ lib/auth.ts                  API-token verification
      ├─ lib/auth.test.ts
      └─ test/ingest-e2e.test.ts
```

**Dependency direction (one-way):** `config`, `core` → `db`, `ingest`, `ai` → `retrieval` → `apps/web`. No package imports from `apps/`.

---

## Task 1: Monorepo scaffold + tooling

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `vitest.config.ts`, `.env.example`, `.gitignore` (already exists — extend)

- [ ] **Step 1: Create the workspace manifest**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

Create root `package.json`:

```json
{
  "name": "goldenretriever",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "turbo run build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "turbo run typecheck",
    "db:up": "docker compose -f docker-compose.test.yml up -d",
    "db:down": "docker compose -f docker-compose.test.yml down -v"
  },
  "devDependencies": {
    "turbo": "^2.3.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  },
  "packageManager": "pnpm@9.12.0"
}
```

- [ ] **Step 2: Create the base TypeScript + Turbo + Vitest config**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true
  }
}
```

Create `turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] }
  }
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    testTimeout: 30000,
  },
});
```

Create `.env.example`:

```bash
DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test
AI_GATEWAY_API_KEY=replace-me
GR_GENERATION_MODEL=anthropic/claude-sonnet-4-6
GR_TAGGING_MODEL=anthropic/claude-haiku-4-5
GR_EMBEDDING_MODEL=openai/text-embedding-3-small
GR_RERANK_MODEL=cohere/rerank-3.5
```

- [ ] **Step 3: Create the test database container**

Create `docker-compose.test.yml`:

```yaml
services:
  db:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_USER: gr
      POSTGRES_PASSWORD: gr
      POSTGRES_DB: gr_test
    ports:
      - "5433:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U gr"]
      interval: 2s
      timeout: 5s
      retries: 15
```

- [ ] **Step 4: Install and verify the toolchain**

Run: `pnpm install`
Then run: `pnpm test`
Expected: Vitest runs and reports "No test files found" (exit 0) — toolchain works, no tests yet.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm+turborepo monorepo with vitest and test db"
```

---

## Task 2: `packages/config` — environment schema

**Files:**
- Create: `packages/config/package.json`, `packages/config/src/env.ts`, `packages/config/src/env.test.ts`

- [ ] **Step 1: Create the package manifest**

Create `packages/config/package.json`:

```json
{
  "name": "@gr/config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/env.ts",
  "scripts": { "typecheck": "tsc --noEmit -p tsconfig.json" },
  "dependencies": { "zod": "^3.23.0" }
}
```

Create `packages/config/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 2: Write the failing test**

Create `packages/config/src/env.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseEnv } from "./env.js";

describe("parseEnv", () => {
  it("applies model defaults when not provided", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://x",
      AI_GATEWAY_API_KEY: "k",
    });
    expect(env.GR_GENERATION_MODEL).toBe("anthropic/claude-sonnet-4-6");
    expect(env.GR_EMBEDDING_MODEL).toBe("openai/text-embedding-3-small");
  });

  it("throws when a required var is missing", () => {
    expect(() => parseEnv({ AI_GATEWAY_API_KEY: "k" })).toThrow();
  });

  it("respects model overrides", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://x",
      AI_GATEWAY_API_KEY: "k",
      GR_GENERATION_MODEL: "openai/gpt-5",
    });
    expect(env.GR_GENERATION_MODEL).toBe("openai/gpt-5");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/config`
Expected: FAIL — cannot find module `./env.js`.

- [ ] **Step 4: Write the implementation**

Create `packages/config/src/env.ts`:

```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  AI_GATEWAY_API_KEY: z.string().min(1),
  GR_GENERATION_MODEL: z.string().default("anthropic/claude-sonnet-4-6"),
  GR_TAGGING_MODEL: z.string().default("anthropic/claude-haiku-4-5"),
  GR_EMBEDDING_MODEL: z.string().default("openai/text-embedding-3-small"),
  GR_RERANK_MODEL: z.string().default("cohere/rerank-3.5"),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  return schema.parse(source);
}

export const env: Env = parseEnv();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/config`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/config
git commit -m "feat(config): zod env schema with model defaults"
```

---

## Task 3: `packages/core` — shared domain types

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`

- [ ] **Step 1: Create the package**

Create `packages/core/package.json`:

```json
{
  "name": "@gr/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit -p tsconfig.json" }
}
```

Create `packages/core/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 2: Write the shared types**

Create `packages/core/src/index.ts`:

```ts
export type CaptureMode = "full_dom" | "selection" | "url_fetch" | "upload";
export type DocumentKind = "web" | "pdf" | "text";
export type DocumentStatus = "pending" | "processing" | "ready" | "failed";

/** Input accepted by the ingest API, normalized for the pipeline. */
export interface IngestInput {
  kbId: string;
  addedBy: string;
  captureMode: CaptureMode;
  kind: DocumentKind;
  sourceUrl: string | null;
  title: string | null;
  /** Raw HTML (full_dom/url_fetch), plain text (selection/text), or unused (pdf upload). */
  rawContent: string;
}

/** A chunk returned by a Retriever, with enough document context to render a citation. */
export interface RankedChunk {
  chunkId: string;
  documentId: string;
  content: string;
  score: number;
  document: {
    title: string | null;
    sourceUrl: string | null;
    addedBy: string;
    capturedAt: Date;
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @gr/core typecheck`
Expected: PASS (no output, exit 0).

- [ ] **Step 4: Commit**

```bash
git add packages/core
git commit -m "feat(core): shared domain types (IngestInput, RankedChunk)"
```

---

## Task 4: `packages/db` — schema + client

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/drizzle.config.ts`, `packages/db/src/schema.ts`, `packages/db/src/client.ts`

- [ ] **Step 1: Create the package manifest**

Create `packages/db/package.json`:

```json
{
  "name": "@gr/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/client.ts",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "db:generate": "drizzle-kit generate",
    "db:push": "drizzle-kit push"
  },
  "dependencies": {
    "@gr/config": "workspace:*",
    "drizzle-orm": "^0.36.0",
    "postgres": "^3.4.5"
  },
  "devDependencies": { "drizzle-kit": "^0.28.0" }
}
```

Create `packages/db/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "drizzle.config.ts"] }
```

- [ ] **Step 2: Write the schema**

Create `packages/db/src/schema.ts`:

```ts
import {
  pgTable, text, timestamp, integer, jsonb, real, boolean,
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
  kind: text("kind").notNull(),          // 'web' | 'pdf' | 'text'
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
```

- [ ] **Step 3: Write the client and drizzle config**

Create `packages/db/src/client.ts`:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@gr/config";
import * as schema from "./schema.js";

export function createDb(url: string = env.DATABASE_URL) {
  const sql = postgres(url, { max: 5 });
  return { db: drizzle(sql, { schema }), sql };
}

export * as schema from "./schema.js";
export type { Document, NewDocument, Chunk, NewChunk } from "./schema.js";
```

Create `packages/db/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 4: Generate the migration and verify it includes the vector extension**

Run: `pnpm --filter @gr/db db:generate`
Expected: a SQL file appears in `packages/db/drizzle/`. Open it and **manually prepend** the extension line as the first statement (drizzle-kit does not add it):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

- [ ] **Step 5: Push the schema to the test DB and verify**

Run: `pnpm db:up` (starts Postgres+pgvector on port 5433)
Then: `DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test pnpm --filter @gr/db db:push`
Expected: drizzle-kit reports tables created. (If it errors on the `vector` type, run `psql` once: `CREATE EXTENSION IF NOT EXISTS vector;` then re-run push.)

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): drizzle schema (multi-tenant) + pgvector client and migration"
```

---

## Task 5: `packages/db` — scoped query helpers (TDD against real DB)

**Files:**
- Create: `packages/db/src/queries.ts`, `packages/db/src/queries.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/queries.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm db:up && DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test pnpm vitest run packages/db`
Expected: FAIL — cannot find module `./queries.js`.

- [ ] **Step 3: Write the query helpers**

Create `packages/db/src/queries.ts`:

```ts
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
}) {
  const docId = id("doc");
  await db.insert(documents).values({
    id: docId, kbId: d.kbId, addedBy: d.addedBy, kind: d.kind,
    captureMode: d.captureMode, sourceUrl: d.sourceUrl, title: d.title, status: "pending",
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test pnpm vitest run packages/db`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(db): kb-scoped query helpers with integration tests"
```

---

## Task 6: `packages/ingest` — HTML extraction

**Files:**
- Create: `packages/ingest/package.json`, `packages/ingest/tsconfig.json`, `packages/ingest/src/extract.ts`, `packages/ingest/src/extract.test.ts`

- [ ] **Step 1: Create the package manifest**

Create `packages/ingest/package.json`:

```json
{
  "name": "@gr/ingest",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit -p tsconfig.json" },
  "dependencies": {
    "@gr/core": "workspace:*",
    "@mozilla/readability": "^0.5.0",
    "jsdom": "^25.0.0",
    "turndown": "^7.2.0"
  },
  "devDependencies": { "@types/jsdom": "^21.1.7", "@types/turndown": "^5.0.5" }
}
```

Create `packages/ingest/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 2: Write the failing test**

Create `packages/ingest/src/extract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractContent } from "./extract.js";

const html = `<!doctype html><html><head><title>Kyoto Ryokans</title></head>
<body><nav>menu junk</nav><article><h1>Best Ryokans</h1>
<p>Tawaraya is a historic ryokan in central Kyoto.</p>
<p>Hiiragiya is another classic choice.</p></article>
<footer>copyright junk</footer></body></html>`;

describe("extractContent", () => {
  it("pulls the main article as markdown and a title", () => {
    const r = extractContent(html, "https://example.com/kyoto");
    expect(r.title).toBe("Kyoto Ryokans");
    expect(r.markdown).toContain("Tawaraya");
    expect(r.markdown).toContain("Hiiragiya");
    expect(r.markdown).not.toContain("menu junk");
    expect(r.wordCount).toBeGreaterThan(5);
  });

  it("falls back to body text when Readability finds no article", () => {
    const r = extractContent("<html><body>Just a sentence here.</body></html>", null);
    expect(r.markdown).toContain("Just a sentence");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/ingest`
Expected: FAIL — cannot find module `./extract.js`.

- [ ] **Step 4: Write the implementation**

Create `packages/ingest/src/extract.ts`:

```ts
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

const turndown = new TurndownService({ headingStyle: "atx" });

export interface ExtractResult {
  title: string | null;
  markdown: string;
  wordCount: number;
}

export function extractContent(html: string, url: string | null): ExtractResult {
  const dom = new JSDOM(html, { url: url ?? undefined });
  const doc = dom.window.document;
  const title = doc.title?.trim() || null;

  let contentHtml: string;
  try {
    const article = new Readability(doc).parse();
    contentHtml = article?.content ?? doc.body?.innerHTML ?? "";
  } catch {
    contentHtml = doc.body?.innerHTML ?? "";
  }

  const markdown = turndown.turndown(contentHtml).trim();
  const wordCount = markdown.split(/\s+/).filter(Boolean).length;
  return { title, markdown, wordCount };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/ingest`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/ingest
git commit -m "feat(ingest): readability HTML extraction to markdown"
```

---

## Task 7: `packages/ingest` — chunker

**Files:**
- Create: `packages/ingest/src/chunk.ts`, `packages/ingest/src/chunk.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ingest/src/chunk.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { chunkText } from "./chunk.js";

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    const chunks = chunkText("A short note.", { maxTokens: 100, overlapTokens: 10 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].ordinal).toBe(0);
    expect(chunks[0].content).toBe("A short note.");
  });

  it("splits long text into ordered chunks with overlap", () => {
    const para = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkText(para, { maxTokens: 20, overlapTokens: 5 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
    // overlap: last words of chunk0 reappear at start of chunk1
    const tail = chunks[0].content.split(" ").slice(-5);
    expect(chunks[1].content.startsWith(tail.join(" "))).toBe(true);
  });

  it("estimates token counts (~0.75 words/token heuristic)", () => {
    const chunks = chunkText("one two three four", { maxTokens: 100, overlapTokens: 0 });
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/ingest/src/chunk.test.ts`
Expected: FAIL — cannot find module `./chunk.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/ingest/src/chunk.ts`:

```ts
export interface ChunkOptions { maxTokens: number; overlapTokens: number; }
export interface TextChunk { ordinal: number; content: string; tokenCount: number; }

// Heuristic: ~1.33 tokens per word. Word-based windowing keeps chunks readable.
const WORDS_PER_TOKEN = 0.75;
const toWords = (tokens: number) => Math.max(1, Math.round(tokens * WORDS_PER_TOKEN));
const estTokens = (words: number) => Math.ceil(words / WORDS_PER_TOKEN);

export function chunkText(text: string, opts: ChunkOptions): TextChunk[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const windowWords = toWords(opts.maxTokens);
  const overlapWords = Math.min(toWords(opts.overlapTokens), windowWords - 1);
  const step = Math.max(1, windowWords - overlapWords);

  const chunks: TextChunk[] = [];
  for (let start = 0, ordinal = 0; start < words.length; start += step, ordinal++) {
    const slice = words.slice(start, start + windowWords);
    chunks.push({ ordinal, content: slice.join(" "), tokenCount: estTokens(slice.length) });
    if (start + windowWords >= words.length) break;
  }
  return chunks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/ingest/src/chunk.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ingest
git commit -m "feat(ingest): token-aware text chunker with overlap"
```

---

## Task 8: `packages/ai` — model config resolver

**Files:**
- Create: `packages/ai/package.json`, `packages/ai/tsconfig.json`, `packages/ai/src/models.ts`, `packages/ai/src/models.test.ts`

- [ ] **Step 1: Create the package manifest**

Create `packages/ai/package.json`:

```json
{
  "name": "@gr/ai",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit -p tsconfig.json" },
  "dependencies": {
    "@gr/config": "workspace:*",
    "@gr/core": "workspace:*",
    "ai": "^6.0.0"
  }
}
```

Create `packages/ai/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 2: Write the failing test**

Create `packages/ai/src/models.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveModels } from "./models.js";

describe("resolveModels", () => {
  it("reads provider/model strings from env", () => {
    const m = resolveModels({
      GR_GENERATION_MODEL: "anthropic/claude-sonnet-4-6",
      GR_TAGGING_MODEL: "anthropic/claude-haiku-4-5",
      GR_EMBEDDING_MODEL: "openai/text-embedding-3-small",
      GR_RERANK_MODEL: "cohere/rerank-3.5",
    });
    expect(m.generation).toBe("anthropic/claude-sonnet-4-6");
    expect(m.embedding).toBe("openai/text-embedding-3-small");
  });

  it("rejects an embedding model swap that is not declared 1536-dim safe", () => {
    expect(() => resolveModels({
      GR_GENERATION_MODEL: "openai/gpt-5",
      GR_TAGGING_MODEL: "openai/gpt-5-mini",
      GR_EMBEDDING_MODEL: "openai/text-embedding-3-large", // 3072 dims
      GR_RERANK_MODEL: "cohere/rerank-3.5",
    })).toThrow(/1536/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/ai/src/models.test.ts`
Expected: FAIL — cannot find module `./models.js`.

- [ ] **Step 4: Write the implementation**

Create `packages/ai/src/models.ts`:

```ts
export interface ResolvedModels {
  generation: string;
  tagging: string;
  embedding: string;
  rerank: string;
}

// Embedding models known to emit 1536-dim vectors (the pinned column width).
const EMBEDDING_1536 = new Set([
  "openai/text-embedding-3-small",
  "openai/text-embedding-ada-002",
]);

export function resolveModels(env: {
  GR_GENERATION_MODEL: string; GR_TAGGING_MODEL: string;
  GR_EMBEDDING_MODEL: string; GR_RERANK_MODEL: string;
}): ResolvedModels {
  if (!EMBEDDING_1536.has(env.GR_EMBEDDING_MODEL)) {
    throw new Error(
      `GR_EMBEDDING_MODEL '${env.GR_EMBEDDING_MODEL}' is not a known 1536-dim model. ` +
      `The chunks.embedding column is pinned to 1536; changing dimensions requires a re-embed migration.`,
    );
  }
  return {
    generation: env.GR_GENERATION_MODEL,
    tagging: env.GR_TAGGING_MODEL,
    embedding: env.GR_EMBEDDING_MODEL,
    rerank: env.GR_RERANK_MODEL,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/ai/src/models.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/ai
git commit -m "feat(ai): model config resolver with embedding-dim guard"
```

---

## Task 9: `packages/ai` — AiClient interface + mock

**Files:**
- Create: `packages/ai/src/index.ts`, `packages/ai/src/mock.ts`

- [ ] **Step 1: Write the interface and the real implementation**

Create `packages/ai/src/index.ts`:

```ts
import { embedMany, generateText } from "ai";
import { env } from "@gr/config";
import { resolveModels } from "./models.js";

export interface RerankHit { index: number; score: number; }

export interface AiClient {
  embed(texts: string[]): Promise<number[][]>;
  /** Returns tag slugs for a piece of content. */
  tag(content: string): Promise<string[]>;
  /** Grounded answer over numbered context blocks. */
  answer(question: string, contexts: string[]): Promise<{ text: string; tokens: number }>;
  rerank(query: string, docs: string[]): Promise<RerankHit[]>;
}

export function createAiClient(): AiClient {
  const models = resolveModels(env);
  return {
    async embed(texts) {
      const { embeddings } = await embedMany({ model: models.embedding, values: texts });
      return embeddings;
    },
    async tag(content) {
      const { text } = await generateText({
        model: models.tagging,
        prompt:
          `Return 3-6 short lowercase topic tags (comma-separated, no #) for this content:\n\n` +
          content.slice(0, 4000),
      });
      return text.split(",").map((t) => t.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean);
    },
    async answer(question, contexts) {
      const numbered = contexts.map((c, i) => `[${i + 1}] ${c}`).join("\n\n");
      const { text, usage } = await generateText({
        model: models.generation,
        prompt:
          `Answer the question using ONLY the numbered sources. Cite sources inline like [1].\n` +
          `If the sources do not contain the answer, say "I don't have anything saved about that."\n\n` +
          `Sources:\n${numbered}\n\nQuestion: ${question}`,
      });
      return { text, tokens: usage?.totalTokens ?? 0 };
    },
    async rerank(query, docs) {
      // Cohere rerank via Gateway is added during infra setup; until then,
      // fall back to identity ordering so the pipeline is exercisable.
      return docs.map((_, index) => ({ index, score: 1 - index * 1e-6 }));
    },
  };
}
```

- [ ] **Step 2: Write the mock for tests**

Create `packages/ai/src/mock.ts`:

```ts
import type { AiClient, RerankHit } from "./index.js";

/** Deterministic AiClient for tests: embeddings are a tiny bag-of-words hash. */
export function createMockAiClient(): AiClient {
  const embedOne = (text: string): number[] => {
    const v = new Array(1536).fill(0);
    for (const w of text.toLowerCase().split(/\s+/).filter(Boolean)) {
      let h = 0;
      for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) >>> 0;
      v[h % 1536] += 1;
    }
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  };
  return {
    async embed(texts) { return texts.map(embedOne); },
    async tag() { return ["test-tag"]; },
    async answer(question, contexts) {
      return { text: contexts.length ? `Answer [1]` : "I don't have anything saved about that.", tokens: 42 };
    },
    async rerank(_query, docs): Promise<RerankHit[]> {
      return docs.map((_, index) => ({ index, score: 1 - index * 1e-6 }));
    },
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @gr/ai typecheck`
Expected: PASS.

> Note on `ai` v6: if `usage.totalTokens` is named differently in the installed version, adjust the `answer` mapping. The mock keeps tests independent of the live SDK.

- [ ] **Step 4: Commit**

```bash
git add packages/ai
git commit -m "feat(ai): AiClient interface (gateway impl) + deterministic mock"
```

---

## Task 10: `packages/retrieval` — Reciprocal Rank Fusion (pure)

**Files:**
- Create: `packages/retrieval/package.json`, `packages/retrieval/tsconfig.json`, `packages/retrieval/src/rrf.ts`, `packages/retrieval/src/rrf.test.ts`

- [ ] **Step 1: Create the package manifest**

Create `packages/retrieval/package.json`:

```json
{
  "name": "@gr/retrieval",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit -p tsconfig.json" },
  "dependencies": {
    "@gr/core": "workspace:*",
    "@gr/db": "workspace:*",
    "@gr/ai": "workspace:*",
    "drizzle-orm": "^0.36.0"
  }
}
```

Create `packages/retrieval/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 2: Write the failing test**

Create `packages/retrieval/src/rrf.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fuseRrf } from "./rrf.js";

describe("fuseRrf", () => {
  it("ranks an item appearing high in both lists first", () => {
    const dense = ["a", "b", "c"];
    const sparse = ["b", "a", "d"];
    const fused = fuseRrf([dense, sparse], { k: 60 });
    expect(fused[0]).toBe("a"); // top in dense, 2nd in sparse → best combined
  });

  it("includes items present in only one list", () => {
    const fused = fuseRrf([["x"], ["y"]], { k: 60 });
    expect(new Set(fused)).toEqual(new Set(["x", "y"]));
  });

  it("returns empty for empty input", () => {
    expect(fuseRrf([], { k: 60 })).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/retrieval/src/rrf.test.ts`
Expected: FAIL — cannot find module `./rrf.js`.

- [ ] **Step 4: Write the implementation**

Create `packages/retrieval/src/rrf.ts`:

```ts
export interface RrfOptions { k: number; }

/** Reciprocal Rank Fusion: score(id) = Σ 1/(k + rank). Returns ids best-first. */
export function fuseRrf(rankedLists: string[][], opts: RrfOptions): string[] {
  const scores = new Map<string, number>();
  for (const list of rankedLists) {
    list.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (opts.k + rank + 1));
    });
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/retrieval/src/rrf.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/retrieval
git commit -m "feat(retrieval): reciprocal rank fusion"
```

---

## Task 11: `packages/retrieval` — HybridRetriever (integration)

**Files:**
- Create: `packages/retrieval/src/hybrid.ts`, `packages/retrieval/src/index.ts`, `packages/retrieval/src/hybrid.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/retrieval/src/hybrid.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test pnpm vitest run packages/retrieval/src/hybrid.test.ts`
Expected: FAIL — cannot find module `./hybrid.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/retrieval/src/hybrid.ts`:

```ts
import { sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import type { AiClient } from "@gr/ai";
import type { RankedChunk } from "@gr/core";
import { fuseRrf } from "./rrf.js";

type Db = ReturnType<typeof drizzle>;

interface Row {
  chunk_id: string; document_id: string; content: string;
  title: string | null; source_url: string | null; added_by: string; captured_at: Date;
}

const CANDIDATES = 40;
const TOP_K = 8;

export class HybridRetriever {
  constructor(private db: Db, private ai: AiClient) {}

  async retrieve(kbId: string, query: string): Promise<RankedChunk[]> {
    const [queryEmbedding] = await this.ai.embed([query]);
    const vecLiteral = `[${queryEmbedding.join(",")}]`;

    // Dense: cosine distance via pgvector, scoped to kb.
    const dense = await this.db.execute<Row>(sql`
      SELECT c.id AS chunk_id, c.document_id, c.content,
             d.title, d.source_url, d.added_by, d.captured_at
      FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE c.kb_id = ${kbId} AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${vecLiteral}::vector
      LIMIT ${CANDIDATES}`);

    // Sparse: full-text search, scoped to kb.
    const sparse = await this.db.execute<Row>(sql`
      SELECT c.id AS chunk_id, c.document_id, c.content,
             d.title, d.source_url, d.added_by, d.captured_at
      FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE c.kb_id = ${kbId}
        AND c.fts @@ websearch_to_tsquery('english', ${query})
      ORDER BY ts_rank(c.fts, websearch_to_tsquery('english', ${query})) DESC
      LIMIT ${CANDIDATES}`);

    const byId = new Map<string, Row>();
    for (const r of [...dense, ...sparse]) byId.set(r.chunk_id, r);

    const fused = fuseRrf(
      [dense.map((r) => r.chunk_id), sparse.map((r) => r.chunk_id)],
      { k: 60 },
    ).slice(0, CANDIDATES);
    if (fused.length === 0) return [];

    const reranked = await this.ai.rerank(query, fused.map((id) => byId.get(id)!.content));
    return reranked.slice(0, TOP_K).map((hit) => {
      const row = byId.get(fused[hit.index])!;
      return {
        chunkId: row.chunk_id, documentId: row.document_id, content: row.content, score: hit.score,
        document: { title: row.title, sourceUrl: row.source_url, addedBy: row.added_by, capturedAt: row.captured_at },
      };
    });
  }
}
```

Create `packages/retrieval/src/index.ts`:

```ts
export { HybridRetriever } from "./hybrid.js";
export { fuseRrf } from "./rrf.js";
export type { RankedChunk } from "@gr/core";
```

> **Note:** add `"./queries"` and `"./mock"` subpath access by referencing the files directly via the workspace (`@gr/db/queries`, `@gr/ai/mock`). Add to `packages/db/package.json` and `packages/ai/package.json` an `"exports"` map:
> `"exports": { ".": "./src/client.ts", "./queries": "./src/queries.ts" }` for db, and
> `"exports": { ".": "./src/index.ts", "./mock": "./src/mock.ts" }` for ai. Make this edit now.

- [ ] **Step 4: Add the exports maps, then run test to verify it passes**

Edit `packages/db/package.json` — replace `"main"` with an exports map:
```json
"exports": { ".": "./src/client.ts", "./queries": "./src/queries.ts" }
```
Edit `packages/ai/package.json` — add:
```json
"exports": { ".": "./src/index.ts", "./mock": "./src/mock.ts", "./models": "./src/models.ts" }
```
Run: `DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test pnpm vitest run packages/retrieval/src/hybrid.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/retrieval packages/db/package.json packages/ai/package.json
git commit -m "feat(retrieval): HybridRetriever (pgvector + FTS + RRF + rerank)"
```

---

## Task 12: `packages/ingest` — pipeline orchestrator

**Files:**
- Create: `packages/ingest/src/pipeline.ts`, `packages/ingest/src/index.ts`, `packages/ingest/src/pipeline.test.ts`
- Modify: `packages/ingest/package.json` (add deps on `@gr/db`, `@gr/ai`)

- [ ] **Step 1: Add dependencies**

Edit `packages/ingest/package.json` `dependencies` to add:
```json
"@gr/db": "workspace:*",
"@gr/ai": "workspace:*"
```
Run: `pnpm install`

- [ ] **Step 2: Write the failing test**

Create `packages/ingest/src/pipeline.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb } from "@gr/db";
import { createUser, createKnowledgeBase, insertDocument, getDocument } from "@gr/db/queries";
import { createMockAiClient } from "@gr/ai/mock";
import { runIngestion } from "./pipeline.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
const ai = createMockAiClient();
let userId: string, kbId: string;

beforeAll(async () => {
  userId = await createUser(db, { id: "u_pipe", email: "p@p.dev" });
  kbId = await createKnowledgeBase(db, { ownerId: userId, name: "Pipe" });
});
afterAll(async () => { await sql.end(); });

describe("runIngestion", () => {
  it("parses, chunks, embeds, tags and marks the document ready", async () => {
    const docId = await insertDocument(db, {
      kbId, addedBy: userId, kind: "web", captureMode: "full_dom",
      sourceUrl: "https://ex.com", title: null,
    });
    await runIngestion(db, ai, {
      documentId: docId, kbId, kind: "web",
      rawContent: "<html><head><title>T</title></head><body><article><p>Kyoto ryokan stay.</p></article></body></html>",
    });
    const doc = await getDocument(db, docId, kbId);
    expect(doc?.status).toBe("ready");
    expect(doc?.title).toBe("T");

    const rows = await db.execute(sql`SELECT count(*)::int AS n FROM chunks WHERE document_id = ${docId}`);
    expect((rows[0] as { n: number }).n).toBeGreaterThan(0);
  });

  it("marks the document failed when extraction throws", async () => {
    const docId = await insertDocument(db, {
      kbId, addedBy: userId, kind: "web", captureMode: "full_dom",
      sourceUrl: null, title: null,
    });
    // null content forces a throw inside the pipeline
    await expect(runIngestion(db, ai, {
      documentId: docId, kbId, kind: "web", rawContent: null as unknown as string,
    })).rejects.toThrow();
    const doc = await getDocument(db, docId, kbId);
    expect(doc?.status).toBe("failed");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test pnpm vitest run packages/ingest/src/pipeline.test.ts`
Expected: FAIL — cannot find module `./pipeline.js`.

- [ ] **Step 4: Write the implementation**

Create `packages/ingest/src/pipeline.ts`:

```ts
import type { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import type { AiClient } from "@gr/ai";
import { schema, type NewChunk } from "@gr/db";
import { insertChunks, setDocumentReady, setDocumentFailed } from "@gr/db/queries";
import { extractContent } from "./extract.js";
import { chunkText } from "./chunk.js";

type Db = ReturnType<typeof drizzle>;

export interface IngestionWork {
  documentId: string;
  kbId: string;
  kind: "web" | "pdf" | "text";
  rawContent: string;
}

export async function runIngestion(db: Db, ai: AiClient, work: IngestionWork): Promise<void> {
  try {
    await db.update(schema.documents).set({ status: "processing" })
      .where(eq(schema.documents.id, work.documentId));

    const extracted = work.kind === "web"
      ? extractContent(work.rawContent, null)
      : { title: null, markdown: work.rawContent.trim(), wordCount: work.rawContent.trim().split(/\s+/).length };

    const pieces = chunkText(extracted.markdown, { maxTokens: 800, overlapTokens: 100 });
    if (pieces.length === 0) throw new Error("no content to ingest");

    const embeddings = await ai.embed(pieces.map((p) => p.content));
    const rows: Omit<NewChunk, "id">[] = pieces.map((p, i) => ({
      documentId: work.documentId, kbId: work.kbId, ordinal: p.ordinal,
      content: p.content, tokenCount: p.tokenCount,
      embedding: embeddings[i], embeddingModel: "configured",
    }));
    await insertChunks(db, rows);

    // Best-effort tagging — failure here must not fail ingestion.
    try { await ai.tag(extracted.markdown); } catch { /* ignore in Stage 0 */ }

    // Set title if the document didn't have one.
    if (extracted.title) {
      await db.update(schema.documents).set({ title: extracted.title })
        .where(eq(schema.documents.id, work.documentId));
    }
    await setDocumentReady(db, work.documentId, {
      wordCount: extracted.wordCount, lang: "en",
    });
  } catch (err) {
    await setDocumentFailed(db, work.documentId);
    throw err;
  }
}
```

Create `packages/ingest/src/index.ts`:

```ts
export { extractContent } from "./extract.js";
export { chunkText } from "./chunk.js";
export { runIngestion, type IngestionWork } from "./pipeline.js";
```

> Add to `packages/db/src/client.ts` exports if not present: `export { documents, chunks } from "./schema.js";` is covered by `export * as schema`. The pipeline imports `schema.documents` via the `@gr/db` main export, which already re-exports `schema`.

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test pnpm vitest run packages/ingest/src/pipeline.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/ingest
git commit -m "feat(ingest): ingestion pipeline orchestrator (parse→chunk→embed→tag)"
```

---

## Task 13: `apps/web` — Next.js scaffold + API-token auth

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/lib/auth.ts`, `apps/web/lib/auth.test.ts`

- [ ] **Step 1: Create the app manifest and config**

Create `apps/web/package.json`:

```json
{
  "name": "@gr/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@gr/config": "workspace:*",
    "@gr/core": "workspace:*",
    "@gr/db": "workspace:*",
    "@gr/ai": "workspace:*",
    "@gr/ingest": "workspace:*",
    "@gr/retrieval": "workspace:*",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0"
  }
}
```

Create `apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "preserve", "plugins": [{ "name": "next" }], "noEmit": true },
  "include": ["**/*.ts", "**/*.tsx", ".next/types/**/*.ts"]
}
```

Create `apps/web/next.config.ts`:

```ts
import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@gr/config", "@gr/core", "@gr/db", "@gr/ai", "@gr/ingest", "@gr/retrieval"],
  serverExternalPackages: ["postgres", "jsdom"],
};
export default config;
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing test**

Create `apps/web/lib/auth.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createDb, schema } from "@gr/db";
import { createUser } from "@gr/db/queries";
import { hashToken, verifyApiToken } from "./auth.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);

beforeAll(async () => {
  const userId = await createUser(db, { id: "u_auth", email: "a@a.dev" });
  const token = "grt_live_secret123";
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId, name: "cli", tokenHash: hashToken(token),
  });
});
afterAll(async () => { await sql.end(); });

describe("verifyApiToken", () => {
  it("resolves the user for a valid token", async () => {
    const user = await verifyApiToken(db, "grt_live_secret123");
    expect(user?.userId).toBe("u_auth");
  });
  it("returns null for an unknown token", async () => {
    expect(await verifyApiToken(db, "grt_live_nope")).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test pnpm vitest run apps/web/lib/auth.test.ts`
Expected: FAIL — cannot find module `./auth.js`.

- [ ] **Step 4: Write the implementation**

Create `apps/web/lib/auth.ts`:

```ts
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { schema } from "@gr/db";

type Db = ReturnType<typeof drizzle>;

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface AuthedUser { userId: string; tokenId: string; }

export async function verifyApiToken(db: Db, raw: string | null | undefined): Promise<AuthedUser | null> {
  if (!raw) return null;
  const rows = await db.select().from(schema.apiTokens)
    .where(and(eq(schema.apiTokens.tokenHash, hashToken(raw)), isNull(schema.apiTokens.revokedAt)));
  const tok = rows[0];
  if (!tok) return null;
  await db.update(schema.apiTokens).set({ lastUsedAt: new Date() })
    .where(eq(schema.apiTokens.id, tok.id));
  return { userId: tok.userId, tokenId: tok.id };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test pnpm vitest run apps/web/lib/auth.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): Next.js app scaffold + API-token verification"
```

---

## Task 14: `apps/web` — ingest API + worker + end-to-end test

**Files:**
- Create: `apps/web/app/api/ingest/route.ts`, `apps/web/app/api/worker/route.ts`, `apps/web/lib/ingest-service.ts`, `apps/web/test/ingest-e2e.test.ts`

- [ ] **Step 1: Write the failing end-to-end test**

Create `apps/web/test/ingest-e2e.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createDb, schema } from "@gr/db";
import { createUser, createKnowledgeBase, getDocument } from "@gr/db/queries";
import { createMockAiClient } from "@gr/ai/mock";
import { hashToken } from "../lib/auth.js";
import { ingestAndProcess } from "../lib/ingest-service.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
const ai = createMockAiClient();
let userId: string, kbId: string, token: string;

beforeAll(async () => {
  userId = await createUser(db, { id: "u_e2e", email: "e@e.dev" });
  kbId = await createKnowledgeBase(db, { ownerId: userId, name: "E2E" });
  token = "grt_live_e2e";
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId, name: "e2e", tokenHash: hashToken(token),
  });
});
afterAll(async () => { await sql.end(); });

describe("ingest → process → retrievable", () => {
  it("ingests selection text and makes it answerable", async () => {
    const { documentId } = await ingestAndProcess(db, ai, {
      kbId, addedBy: userId, captureMode: "selection", kind: "text",
      sourceUrl: null, title: "Kyoto note",
      rawContent: "Tawaraya is a historic ryokan in central Kyoto.",
    });
    const doc = await getDocument(db, documentId, kbId);
    expect(doc?.status).toBe("ready");

    const { HybridRetriever } = await import("@gr/retrieval");
    const hits = await new HybridRetriever(db, ai).retrieve(kbId, "ryokan in Kyoto");
    expect(hits[0]?.content).toContain("Tawaraya");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test pnpm vitest run apps/web/test/ingest-e2e.test.ts`
Expected: FAIL — cannot find module `../lib/ingest-service.js`.

- [ ] **Step 3: Write the ingest service (shared by route + worker)**

Create `apps/web/lib/ingest-service.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { drizzle } from "drizzle-orm/postgres-js";
import type { AiClient } from "@gr/ai";
import type { IngestInput } from "@gr/core";
import { schema } from "@gr/db";
import { insertDocument } from "@gr/db/queries";
import { runIngestion } from "@gr/ingest";

type Db = ReturnType<typeof drizzle>;

/** Create the document + job row. Returns ids for async processing. */
export async function enqueueIngestion(db: Db, input: IngestInput) {
  const documentId = await insertDocument(db, {
    kbId: input.kbId, addedBy: input.addedBy, kind: input.kind,
    captureMode: input.captureMode, sourceUrl: input.sourceUrl, title: input.title,
  });
  const jobId = `job_${randomUUID().slice(0, 12)}`;
  await db.insert(schema.ingestionJobs).values({ id: jobId, documentId, type: "ingest", status: "queued" });
  return { documentId, jobId };
}

/** Run the pipeline for a queued job (called by the worker). */
export async function processJob(db: Db, ai: AiClient, args: {
  documentId: string; kbId: string; kind: "web" | "pdf" | "text"; rawContent: string;
}) {
  await runIngestion(db, ai, args);
}

/** Convenience for tests / synchronous flows: enqueue + process inline. */
export async function ingestAndProcess(db: Db, ai: AiClient, input: IngestInput) {
  const { documentId } = await enqueueIngestion(db, input);
  await processJob(db, ai, {
    documentId, kbId: input.kbId,
    kind: input.kind === "pdf" ? "pdf" : input.kind === "text" ? "text" : "web",
    rawContent: input.rawContent,
  });
  return { documentId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test pnpm vitest run apps/web/test/ingest-e2e.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Write the HTTP routes**

Create `apps/web/app/api/ingest/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createDb } from "@gr/db";
import { verifyApiToken } from "../../../lib/auth.js";
import { enqueueIngestion } from "../../../lib/ingest-service.js";
import type { CaptureMode, DocumentKind } from "@gr/core";

export async function POST(req: NextRequest) {
  const { db } = createDb();
  const auth = await verifyApiToken(db, req.headers.get("authorization")?.replace(/^Bearer /, ""));
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json() as {
    kbId: string; url?: string; title?: string; text?: string; html?: string;
    captureMode?: CaptureMode;
  };
  if (!body.kbId || (!body.text && !body.html && !body.url)) {
    return NextResponse.json({ error: "kbId and one of {text, html, url} required" }, { status: 400 });
  }

  const captureMode: CaptureMode = body.captureMode ?? (body.html ? "full_dom" : body.text ? "selection" : "url_fetch");
  const kind: DocumentKind = body.html || body.url ? "web" : "text";

  const { documentId, jobId } = await enqueueIngestion(db, {
    kbId: body.kbId, addedBy: auth.userId, captureMode, kind,
    sourceUrl: body.url ?? null, title: body.title ?? null,
    rawContent: body.html ?? body.text ?? "",
  });
  // Fire-and-forget the worker (Vercel Queues replace this in infra setup).
  void fetch(new URL("/api/worker", req.url), {
    method: "POST",
    headers: { "content-type": "application/json", "x-worker-secret": process.env.WORKER_SECRET ?? "dev" },
    body: JSON.stringify({ jobId, documentId }),
  });
  return NextResponse.json({ documentId, jobId, status: "pending" }, { status: 202 });
}
```

Create `apps/web/app/api/worker/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@gr/db";
import { createAiClient } from "@gr/ai";
import { processJob } from "../../../lib/ingest-service.js";

export async function POST(req: NextRequest) {
  if (req.headers.get("x-worker-secret") !== (process.env.WORKER_SECRET ?? "dev")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { documentId } = await req.json() as { jobId: string; documentId: string };
  const { db } = createDb();

  const docRows = await db.select().from(schema.documents).where(eq(schema.documents.id, documentId));
  const doc = docRows[0];
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Raw content lives in Blob in production; in Plan 1 we re-read from metadata for web/text.
  // For the prototype the route receives rawContent via metadata set at enqueue time (added in infra).
  const rawContent = (doc.metadata as { rawContent?: string } | null)?.rawContent ?? "";
  await processJob(db, createAiClient(), {
    documentId, kbId: doc.kbId,
    kind: doc.kind === "pdf" ? "pdf" : doc.kind === "text" ? "text" : "web",
    rawContent,
  });
  return NextResponse.json({ ok: true });
}
```

> **Wiring note for infra setup (not a blocker for tests):** `enqueueIngestion` should persist `rawContent` to Vercel Blob and store the `blobKey`; the worker reads it back. For Plan 1's tests we exercise the pipeline via `ingestAndProcess` (in-process), which passes `rawContent` directly — so the HTTP worker's Blob round-trip is implemented during the Vercel infra task in Plan 2. Store `rawContent` in `documents.metadata` at enqueue time as the interim mechanism: update `enqueueIngestion` to set `metadata: { rawContent: input.rawContent }`.

- [ ] **Step 6: Apply the interim rawContent persistence**

Edit `apps/web/lib/ingest-service.ts` `enqueueIngestion`: pass `metadata` through `insertDocument`. First extend `insertDocument` in `packages/db/src/queries.ts` to accept optional `metadata`:
```ts
// add to the param type: metadata?: unknown
// add to the insert values: metadata: d.metadata ?? null,
```
Then in `enqueueIngestion`, pass `metadata: { rawContent: input.rawContent }` into `insertDocument`.
Run: `DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test pnpm vitest run apps/web`
Expected: PASS (auth + e2e).

- [ ] **Step 7: Typecheck the whole repo and commit**

Run: `pnpm -r typecheck`
Expected: PASS across all packages.

```bash
git add -A
git commit -m "feat(web): ingest API + worker route, end-to-end ingestion test"
```

---

## Task 15: Full test sweep + README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the README**

Create `README.md`:

```markdown
# GoldenRetriever — Stage 0 Backend Core

Clip → ingest → ask, for a single user's personal knowledge base.

## Develop
1. `pnpm install`
2. `pnpm db:up` (Postgres+pgvector on :5433)
3. `DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test pnpm --filter @gr/db db:push`
4. `DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test pnpm test`

## Packages
- `@gr/config` env schema · `@gr/core` shared types · `@gr/db` schema+queries
- `@gr/ingest` parse+chunk+pipeline · `@gr/ai` model config + AiClient · `@gr/retrieval` hybrid RAG
- `@gr/web` ingest API + worker (Plan 2 adds UI, Clerk, chat)

See `docs/superpowers/specs/2026-06-14-goldenretriever-architecture-design.md`.
```

- [ ] **Step 2: Run the complete suite**

Run: `pnpm db:up && DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test pnpm test`
Expected: PASS — all packages green (config, ingest unit, ai unit, retrieval rrf, db integration, retrieval hybrid, ingest pipeline, web auth, web e2e).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: add backend-core README and finalize Plan 1"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** ingest API (Task 14), capture modes (`core` types + route), async pipeline shape (enqueue/process split, Task 14), parse→chunk→embed→tag (Tasks 6/7/12), hybrid retrieval + rerank seam (Tasks 10/11), grounded-answer + honest-refusal guardrail (`AiClient.answer`, Task 9), configurable provider + embedding-dim guard (Task 8), multi-tenant data model + `added_by`/`kb_members`/reserved `updated_at`/`update_count` seams (Task 4), API-token auth for headless clients (Task 13), token accounting (`answer` returns `tokens`). Chat persistence (conversations/messages) and the rich UI are intentionally Plan 2.
- **Deferred to Plan 2 (web):** Clerk UI auth, library/search/chat UI, streaming generation endpoint persisting `messages`, import flow, Vercel Blob round-trip for `rawContent`, Vercel Queues wiring. **Deferred to Plan 3 (clients):** WXT extension, iOS Shortcut, Android PWA target.
- **Type consistency:** `AiClient` methods (`embed`/`tag`/`answer`/`rerank`) identical in `index.ts` and `mock.ts`; `RankedChunk` defined once in `@gr/core` and re-exported; `IngestInput` shared by route + service; query-helper signatures used consistently across Tasks 5/11/12/14.
- **Known interim:** worker reads `rawContent` from `documents.metadata` until the Blob round-trip lands in Plan 2 (flagged in Task 14).
```
