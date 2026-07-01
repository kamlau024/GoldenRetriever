# Memory Phase 2 — Extracted Facts + Memory Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distil durable facts about the user from each chat exchange into an editable, user-managed memory store, and inject them into the chat prompt's "About you" section when memory is enabled.

**Architecture:** A `memories` table (userId-scoped) + a `users.memory_enabled` toggle. The chat route loads the user's memory state once per request (to inject facts) and, in `onFinish`, best-effort extracts new facts (cheap model) and stores the novel ones (embedding-based dedup). A Settings → Memory page manages facts via session-only REST endpoints.

**Tech Stack:** Next.js 15 App Router, Drizzle/Postgres + pgvector, AI SDK v6, Vitest.

## Global Constraints

- Memory is **userId-scoped**; all management endpoints use `resolveSessionUser` (session-only, never bearer) and return **404** on a non-owned id (no existence leak).
- Embeddings are **1536-dim** (reuse `GR_EMBEDDING_MODEL` via `ai.embed`); extraction uses the **cheap tagging model**.
- All memory writes in the chat path are **best-effort** — wrapped so a failure never affects or delays the streamed reply. Extraction and injection happen **only when `memory_enabled`**.
- The prompt's citation `[n]` + REFUSAL rules are unchanged; facts go in the non-citable "About you" section (the `facts` slot already exists on `buildChatPrompt`).
- Prod schema is applied with `pnpm --filter @gr/db exec drizzle-kit push` (from `schema.ts`); the **test DB** applies `packages/db/drizzle/*.sql` (a fresh DB via `pnpm db:down && pnpm db:up`).
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Schema — `memories` table + `users.memory_enabled`

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/drizzle/0001_memory.sql`
- Test: `packages/db/src/queries.memories.test.ts` (create — a minimal insert/select proving the migration applies)

**Interfaces:**
- Produces: `memories` table (`id, user_id, content, kind, source_conversation_id, embedding vector(1536), created_at, updated_at`), `users.memory_enabled boolean default true`, and the exported types `Memory`/`NewMemory`.

- [ ] **Step 1: Add the schema**

In `packages/db/src/schema.ts`, add `boolean` to the `drizzle-orm/pg-core` import:

```ts
import {
  pgTable, text, timestamp, integer, jsonb, real, boolean,
  vector, index, primaryKey, customType,
} from "drizzle-orm/pg-core";
```

Add `memoryEnabled` to the `users` table (after `imageUrl`):

```ts
  imageUrl: text("image_url"),
  memoryEnabled: boolean("memory_enabled").notNull().default(true),
```

Add the `memories` table (after the `messages` table) and export its types (next to the other `$inferSelect` exports):

```ts
export const memories = pgTable("memories", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  kind: text("kind").notNull().default("fact"), // 'fact' | 'preference'
  sourceConversationId: text("source_conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  embedding: vector("embedding", { dimensions: 1536 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("memories_user_idx").on(t.userId)]);
```

```ts
export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
```

- [ ] **Step 2: Write the migration SQL**

Create `packages/db/drizzle/0001_memory.sql`:

```sql
CREATE TABLE IF NOT EXISTS "memories" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"kind" text DEFAULT 'fact' NOT NULL,
	"source_conversation_id" text,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_source_conversation_id_conversations_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_user_idx" ON "memories" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "memory_enabled" boolean DEFAULT true NOT NULL;
```

- [ ] **Step 3: Write the failing test**

Create `packages/db/src/queries.memories.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb } from "./client.js";
import { createUser } from "./queries.js";
import { memories, users } from "./schema.js";
import { eq } from "drizzle-orm";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);

beforeAll(async () => { await createUser(db, { id: "u_mem_schema", email: "ms@m.dev" }); });
afterAll(async () => { await sql.end(); });

describe("memories schema", () => {
  it("stores a memory row and defaults users.memory_enabled to true", async () => {
    await db.insert(memories).values({ id: "mem_schema_1", userId: "u_mem_schema", content: "likes tea", kind: "fact" });
    const rows = await db.select().from(memories).where(eq(memories.id, "mem_schema_1"));
    expect(rows[0]?.content).toBe("likes tea");
    const u = await db.select().from(users).where(eq(users.id, "u_mem_schema"));
    expect(u[0]?.memoryEnabled).toBe(true);
  });
});
```

- [ ] **Step 4: Reset the test DB (so the new migration applies) and run the test**

Run:
```bash
pnpm db:down && pnpm db:up
bash scripts/test.sh packages/db/src/queries.memories.test.ts
```
Expected: fresh DB applies `0000_*.sql` + `0001_memory.sql`; test PASSES. (The `db:down -v` is required because `scripts/test.sh` skips migrations when `documents` already exists — a fresh volume forces all migrations to apply.)

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/0001_memory.sql packages/db/src/queries.memories.test.ts
git commit -m "feat(db): memories table + users.memory_enabled

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Memory queries (CRUD + embedding dedup)

**Files:**
- Modify: `packages/db/src/queries.ts`
- Test: `packages/db/src/queries.memories.test.ts` (extend)

**Interfaces:**
- Consumes: `memories`, `users` tables (Task 1); `sql`, `and`, `eq` (already imported); the `id()` helper.
- Produces:
  - `interface MemoryRow { id: string; content: string; kind: string; sourceConversationId: string | null; createdAt: Date; updatedAt: Date }`
  - `getMemoryState(db, userId): Promise<{ enabled: boolean; facts: string[] }>`
  - `listMemories(db, userId): Promise<MemoryRow[]>`
  - `insertMemoryIfNovel(db, m: { userId: string; content: string; kind: string; embedding: number[]; sourceConversationId: string | null }, maxDistance?: number): Promise<boolean>`
  - `updateMemory(db, id, userId, content: string, embedding: number[]): Promise<boolean>`
  - `deleteMemory(db, id, userId): Promise<boolean>`
  - `clearMemories(db, userId): Promise<void>`
  - `setMemoryEnabled(db, userId, enabled: boolean): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Append to `packages/db/src/queries.memories.test.ts` (add the new query imports to the top import from `./queries.js`):

```ts
import {
  getMemoryState, listMemories, insertMemoryIfNovel, updateMemory,
  deleteMemory, clearMemories, setMemoryEnabled,
} from "./queries.js";

// helper: a unit vector pointing at one axis, so two facts can be made near/far
const axis = (i: number) => { const v = new Array(1536).fill(0); v[i] = 1; return v as number[]; };

describe("memory queries", () => {
  it("inserts novel facts and dedups near-duplicates by embedding", async () => {
    const uid = await createUser(db, { id: "u_mem_q", email: "mq@m.dev" });
    expect(await insertMemoryIfNovel(db, { userId: uid, content: "PM at a fintech", kind: "fact", embedding: axis(1), sourceConversationId: null })).toBe(true);
    // identical embedding → treated as duplicate → not inserted
    expect(await insertMemoryIfNovel(db, { userId: uid, content: "product manager, fintech", kind: "fact", embedding: axis(1), sourceConversationId: null })).toBe(false);
    // a far-apart embedding → novel → inserted
    expect(await insertMemoryIfNovel(db, { userId: uid, content: "likes Kyoto", kind: "fact", embedding: axis(2), sourceConversationId: null })).toBe(true);
    const facts = (await listMemories(db, uid)).map((m) => m.content);
    expect(facts).toContain("PM at a fintech");
    expect(facts).toContain("likes Kyoto");
    expect(facts).not.toContain("product manager, fintech");
  });

  it("getMemoryState returns the toggle and fact contents; setMemoryEnabled flips it", async () => {
    const uid = await createUser(db, { id: "u_mem_state", email: "mst@m.dev" });
    await insertMemoryIfNovel(db, { userId: uid, content: "drinks tea", kind: "fact", embedding: axis(3), sourceConversationId: null });
    let state = await getMemoryState(db, uid);
    expect(state.enabled).toBe(true);
    expect(state.facts).toContain("drinks tea");
    await setMemoryEnabled(db, uid, false);
    state = await getMemoryState(db, uid);
    expect(state.enabled).toBe(false);
  });

  it("updates and deletes only the owner's memory; clear removes all", async () => {
    const uid = await createUser(db, { id: "u_mem_own", email: "mo@m.dev" });
    const other = await createUser(db, { id: "u_mem_own2", email: "mo2@m.dev" });
    await insertMemoryIfNovel(db, { userId: uid, content: "orig", kind: "fact", embedding: axis(4), sourceConversationId: null });
    const id = (await listMemories(db, uid))[0].id;
    expect(await updateMemory(db, id, other, "hacked", axis(5))).toBe(false); // not owner
    expect(await updateMemory(db, id, uid, "edited", axis(5))).toBe(true);
    expect((await listMemories(db, uid))[0].content).toBe("edited");
    expect(await deleteMemory(db, id, other)).toBe(false); // not owner
    expect(await deleteMemory(db, id, uid)).toBe(true);
    await insertMemoryIfNovel(db, { userId: uid, content: "again", kind: "fact", embedding: axis(6), sourceConversationId: null });
    await clearMemories(db, uid);
    expect(await listMemories(db, uid)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash scripts/test.sh packages/db/src/queries.memories.test.ts`
Expected: FAIL — the new query functions are not exported.

- [ ] **Step 3: Implement the queries**

In `packages/db/src/queries.ts`, add `memories` and `users`'s `memoryEnabled` usage. First ensure `memories` and `users` are imported at the top (from `./schema.js`) — `users` already is; add `memories`:

```ts
import { users, knowledgeBases, kbMembers, documents, chunks, conversations, messages, tags, documentTags, memories } from "./schema.js";
```

Then add (near the conversation queries):

```ts
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

export async function setMemoryEnabled(db: Db, userId: string, enabled: boolean): Promise<void> {
  await db.update(users).set({ memoryEnabled: enabled }).where(eq(users.id, userId));
}
```

(`id`, `sql`, `and`, `eq`, `desc` are already imported in `queries.ts`. Note the `id` parameter of `updateMemory`/`deleteMemory` shadows the module `id()` generator, but neither function calls the generator — `insertMemoryIfNovel` uses `id("mem")` and is unaffected.)

- [ ] **Step 4: Run to verify it passes**

Run: `bash scripts/test.sh packages/db/src/queries.memories.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/queries.ts packages/db/src/queries.memories.test.ts
git commit -m "feat(db): memory CRUD queries with embedding dedup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `ai.extractMemories`

**Files:**
- Create: `packages/ai/src/memory.ts`
- Test: `packages/ai/src/memory.test.ts` (create)
- Modify: `packages/ai/src/index.ts` (add `extractMemories` to `AiClient` + impl)
- Modify: `packages/ai/src/mock.ts` (add stub)

**Interfaces:**
- Produces: `parseMemories(reply: string): string[]` (pure); `AiClient.extractMemories(userMessage: string, reply: string): Promise<string[]>`.

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/memory.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseMemories } from "./memory.js";

describe("parseMemories", () => {
  it("splits lines, strips bullets/numbering, caps at 3", () => {
    expect(parseMemories("- PM at a fintech\n2. likes Kyoto\n* drinks tea\nfourth")).toEqual([
      "PM at a fintech", "likes Kyoto", "drinks tea",
    ]);
  });
  it("treats NONE (any case) and blanks as no facts", () => {
    expect(parseMemories("NONE")).toEqual([]);
    expect(parseMemories("none\n\n  ")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/ai/src/memory.test.ts`
Expected: FAIL — `./memory.js` does not exist.

- [ ] **Step 3: Implement the parser**

Create `packages/ai/src/memory.ts`:

```ts
/** Parse the model's memory-extraction reply into 0-3 clean fact strings.
 *  Strips list markers/numbering; drops blanks and a literal "NONE". */
export function parseMemories(reply: string): string[] {
  return reply
    .split("\n")
    .map((l) => l.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((l) => l.length > 0 && l.toUpperCase() !== "NONE")
    .slice(0, 3);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run packages/ai/src/memory.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire `extractMemories` into the client + mock**

In `packages/ai/src/index.ts`, add the import (below the `cleanTitle` import):

```ts
import { parseMemories } from "./memory.js";
```

Add to the `AiClient` interface (after `titleConversation`):

```ts
  /** 0-3 durable facts/preferences about the user, distilled from one exchange. */
  extractMemories(userMessage: string, reply: string): Promise<string[]>;
```

Add the method to the object returned by `createAiClient` (after `titleConversation`):

```ts
    async extractMemories(userMessage, reply) {
      const { text } = await generateText({
        model: models.tagging,
        prompt:
          `From this exchange, extract 0-3 durable facts or preferences ABOUT THE USER worth ` +
          `remembering long-term (their role, projects, stable preferences). Ignore transient or ` +
          `topical details. One per line, no numbering. If nothing durable, reply exactly NONE.\n\n` +
          `User: ${userMessage.slice(0, 1000)}\nAssistant: ${reply.slice(0, 1000)}`,
      });
      return parseMemories(text);
    },
```

In `packages/ai/src/mock.ts`, add a deterministic stub to the returned object (after `titleConversation`):

```ts
    async extractMemories() { return []; },
```

- [ ] **Step 6: Verify typecheck + ai tests**

Run: `pnpm --filter @gr/ai typecheck && pnpm exec vitest run packages/ai/src`
Expected: typecheck clean; all ai tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ai/src/memory.ts packages/ai/src/memory.test.ts packages/ai/src/index.ts packages/ai/src/mock.ts
git commit -m "feat(ai): extractMemories (0-3 durable facts per exchange)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Inject facts + extract in the chat route

**Files:**
- Create: `apps/web/lib/memory.ts` (`rememberFromExchange`)
- Modify: `apps/web/lib/chat-service.ts` (`ChatDeps.remember` + wire in `resolveChatDeps`)
- Modify: `apps/web/app/api/chat/route.ts` (load memory state, inject facts, extract in `onFinish`)
- Test: `apps/web/test/chat-route.test.ts` (extend)

**Interfaces:**
- Consumes: `getMemoryState`, `insertMemoryIfNovel` (Task 2); `AiClient.extractMemories`/`embed` (Task 3); `buildChatPrompt`'s `facts` slot (Phase 1).
- Produces: `rememberFromExchange(db, ai, args)`; `ChatDeps.remember?`.

- [ ] **Step 1: Write the failing test**

In `apps/web/test/chat-route.test.ts`, add tests inside the `describe("POST /api/chat", …)` block. (These use the `capturingModel` and `__setChatDeps` already present, plus the memory queries.)

```ts
  it("injects the user's facts into the prompt when memory is enabled", async () => {
    const { insertMemoryIfNovel } = await import("@gr/db/queries");
    await insertMemoryIfNovel(db, { userId: "u_chat_r", content: "is a product manager", kind: "fact", embedding: new Array(1536).fill(0).map((_, i) => (i === 7 ? 1 : 0)), sourceConversationId: null });
    __setChatDeps({ retriever: retrieverReturning([chunk("Roadmapping tips.")]), model: capturingModel("Sure [1].") });
    await (await post({ kbId, message: "help me plan" })).text();
    expect(capturedPrompt).toContain("About you");
    expect(capturedPrompt).toContain("is a product manager");
  });

  it("calls remember on a new exchange only when memory is enabled", async () => {
    const { setMemoryEnabled } = await import("@gr/db/queries");
    let calls = 0;
    const deps = { retriever: retrieverReturning([chunk("x")]), model: modelSaying("y [1]."), remember: async () => { calls++; } };
    __setChatDeps(deps);
    await (await post({ kbId, message: "remember this" })).text();
    expect(calls).toBe(1);

    await setMemoryEnabled(db, "u_chat_r", false);
    __setChatDeps(deps);
    await (await post({ kbId, message: "do not remember" })).text();
    expect(calls).toBe(1); // unchanged — extraction skipped while disabled

    await setMemoryEnabled(db, "u_chat_r", true); // restore for other tests
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash scripts/test.sh apps/web/test/chat-route.test.ts`
Expected: FAIL — no "About you" in the prompt; `remember` never invoked (the route doesn't call it yet). A type error on `remember` in `deps` is also expected until Step 3.

- [ ] **Step 3: Add `rememberFromExchange`**

Create `apps/web/lib/memory.ts`:

```ts
import type { drizzle } from "drizzle-orm/postgres-js";
import type { AiClient } from "@gr/ai";
import { insertMemoryIfNovel } from "@gr/db/queries";

type Db = ReturnType<typeof drizzle>;

/** Best-effort: distil durable facts from one exchange and store the novel ones. */
export async function rememberFromExchange(
  db: Db,
  ai: AiClient,
  args: { userId: string; userMessage: string; reply: string; conversationId: string },
): Promise<void> {
  const facts = await ai.extractMemories(args.userMessage, args.reply);
  if (facts.length === 0) return;
  const embeddings = await ai.embed(facts);
  for (let i = 0; i < facts.length; i++) {
    await insertMemoryIfNovel(db, {
      userId: args.userId, content: facts[i], kind: "fact",
      embedding: embeddings[i], sourceConversationId: args.conversationId,
    });
  }
}
```

- [ ] **Step 4: Add `remember` to `ChatDeps`**

In `apps/web/lib/chat-service.ts`, add the import and extend `ChatDeps` + `resolveChatDeps`:

```ts
import { rememberFromExchange } from "./memory.js";
```

```ts
export interface ChatDeps {
  retriever: Retriever;
  model: LanguageModel;
  titleConversation?: (firstMessage: string) => Promise<string>;
  remember?: (args: { userId: string; userMessage: string; reply: string; conversationId: string }) => Promise<void>;
}
```

In `resolveChatDeps`, add `remember` to the returned object:

```ts
  return {
    retriever: new HybridRetriever(db, ai),
    model: env.GR_GENERATION_MODEL,
    titleConversation: (m) => ai.titleConversation(m),
    remember: (args) => rememberFromExchange(db, ai, args),
  };
```

- [ ] **Step 5: Load memory state, inject facts, extract in `onFinish`**

In `apps/web/app/api/chat/route.ts`:

Add `getMemoryState` to the queries import:

```ts
import { createConversation, appendMessage, setConversationTitle, getConversationForUser, getMemoryState } from "@gr/db/queries";
```

Destructure `remember` from deps:

```ts
  const { retriever, model, titleConversation, remember } = resolveChatDeps(db);
```

Load memory state right after resolving deps (before retrieval):

```ts
  const memory = await getMemoryState(db, principal.userId);
```

Pass facts into the prompt (only when enabled):

```ts
    prompt: buildChatPrompt({
      question: message,
      sources: hits.map((h) => h.content),
      history: priorMessages,
      facts: memory.enabled ? memory.facts : [],
    }),
```

In `onFinish`, after the titling block, add best-effort extraction:

```ts
      if (memory.enabled && remember) {
        try { await remember({ userId: principal.userId, userMessage: message, reply: text, conversationId: convId }); }
        catch { /* best-effort; never break the reply */ }
      }
```

- [ ] **Step 6: Run to verify it passes**

Run: `bash scripts/test.sh apps/web/test/chat-route.test.ts`
Expected: PASS — existing chat-route tests plus the two new memory tests.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/memory.ts apps/web/lib/chat-service.ts apps/web/app/api/chat/route.ts apps/web/test/chat-route.test.ts
git commit -m "feat(web): inject user facts + extract memories in the chat route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Memory + settings endpoints

**Files:**
- Create: `apps/web/app/api/memories/route.ts` (`GET`, `DELETE` clear-all)
- Create: `apps/web/app/api/memories/[id]/route.ts` (`PATCH`, `DELETE`)
- Create: `apps/web/app/api/settings/route.ts` (`PATCH` memory toggle)
- Test: `apps/web/test/memories-route.test.ts` (create)

**Interfaces:**
- Consumes: `listMemories`, `updateMemory`, `deleteMemory`, `clearMemories`, `setMemoryEnabled` (Task 2); `resolveSessionUser` + `__setSessionUser` seam; `resolveIngestDeps().ai.embed` (for re-embedding on edit) + `__setIngestDeps` seam.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/memories-route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { createDb } from "@gr/db";
import { createUser, insertMemoryIfNovel, listMemories } from "@gr/db/queries";
import { createMockAiClient } from "@gr/ai";
import { MockConverter } from "@gr/ingest";
import { __setSessionUser, __clearSessionUser } from "../lib/clerk-auth.js";
import { __setIngestDeps } from "../lib/ingest-service.js";
import { GET as memGet, DELETE as memClear } from "../app/api/memories/route.js";
import { PATCH as memPatch, DELETE as memDelete } from "../app/api/memories/[id]/route.js";
import { PATCH as settingsPatch } from "../app/api/settings/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
const req = (body?: unknown, method = "GET") =>
  new NextRequest("http://localhost/x", { method, ...(body ? { body: JSON.stringify(body) } : {}) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const vec = new Array(1536).fill(0).map((_, i) => (i === 9 ? 1 : 0));

beforeAll(async () => {
  await createUser(db, { id: "u_mem_ep", email: "mep@m.dev" });
  await createUser(db, { id: "u_mem_ep2", email: "mep2@m.dev" });
  __setIngestDeps({ ai: createMockAiClient(), converter: new MockConverter(), urlFetcher: async () => ({ kind: "text" as const, mimeType: "text/plain", text: "" }) });
});
afterAll(async () => { __clearSessionUser(); __setIngestDeps(null); await sql.end(); });

describe("memory endpoints", () => {
  it("401 without a session", async () => {
    __setSessionUser(null);
    expect((await memGet(req())).status).toBe(401);
  });

  it("lists, edits, and deletes only the caller's memories", async () => {
    __setSessionUser("u_mem_ep");
    await insertMemoryIfNovel(db, { userId: "u_mem_ep", content: "orig fact", kind: "fact", embedding: vec, sourceConversationId: null });
    const list = await (await memGet(req())).json();
    const id = list.memories[0].id as string;

    // a different user cannot edit it
    __setSessionUser("u_mem_ep2");
    expect((await memPatch(req({ content: "hacked" }, "PATCH"), ctx(id))).status).toBe(404);

    __setSessionUser("u_mem_ep");
    expect((await memPatch(req({ content: "edited fact" }, "PATCH"), ctx(id))).status).toBe(200);
    expect((await listMemories(db, "u_mem_ep"))[0].content).toBe("edited fact");
    expect((await memDelete(req(undefined, "DELETE"), ctx(id))).status).toBe(200);
  });

  it("clears all and toggles memory_enabled", async () => {
    __setSessionUser("u_mem_ep");
    await insertMemoryIfNovel(db, { userId: "u_mem_ep", content: "a", kind: "fact", embedding: vec, sourceConversationId: null });
    expect((await memClear(req(undefined, "DELETE"))).status).toBe(200);
    expect(await listMemories(db, "u_mem_ep")).toEqual([]);
    expect((await settingsPatch(req({ memoryEnabled: false }, "PATCH"))).status).toBe(200);
    const { getMemoryState } = await import("@gr/db/queries");
    expect((await getMemoryState(db, "u_mem_ep")).enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash scripts/test.sh apps/web/test/memories-route.test.ts`
Expected: FAIL — the route modules do not exist.

- [ ] **Step 3: Implement the list + clear-all route**

Create `apps/web/app/api/memories/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createDb } from "@gr/db";
import { listMemories, clearMemories } from "@gr/db/queries";
import { resolveSessionUser } from "../../../lib/clerk-auth.js";

export async function GET(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveSessionUser(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ memories: await listMemories(db, principal.userId) });
}

export async function DELETE(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveSessionUser(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await clearMemories(db, principal.userId);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Implement the edit + delete route**

Create `apps/web/app/api/memories/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createDb } from "@gr/db";
import { updateMemory, deleteMemory } from "@gr/db/queries";
import { resolveSessionUser } from "../../../../lib/clerk-auth.js";
import { resolveIngestDeps } from "../../../../lib/ingest-service.js";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { db } = createDb();
  const principal = await resolveSessionUser(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { content?: string };
  const content = (body.content ?? "").trim();
  if (!content || content.length > 500) return NextResponse.json({ error: "content required (1-500 chars)" }, { status: 400 });
  const [embedding] = await resolveIngestDeps().ai.embed([content]);
  const ok = await updateMemory(db, id, principal.userId, content, embedding);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { db } = createDb();
  const principal = await resolveSessionUser(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const ok = await deleteMemory(db, id, principal.userId);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Implement the settings route**

Create `apps/web/app/api/settings/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createDb } from "@gr/db";
import { setMemoryEnabled } from "@gr/db/queries";
import { resolveSessionUser } from "../../../lib/clerk-auth.js";

export async function PATCH(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveSessionUser(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { memoryEnabled?: boolean };
  if (typeof body.memoryEnabled !== "boolean") return NextResponse.json({ error: "memoryEnabled (boolean) required" }, { status: 400 });
  await setMemoryEnabled(db, principal.userId, body.memoryEnabled);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `bash scripts/test.sh apps/web/test/memories-route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/api/memories/ apps/web/app/api/settings/ apps/web/test/memories-route.test.ts
git commit -m "feat(web): memory + settings REST endpoints (session-only, owner-scoped)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Memory settings UI

**Files:**
- Create: `apps/web/components/memory-settings.tsx`
- Test: `apps/web/components/memory-settings.test.tsx` (create)
- Modify: `apps/web/app/(app)/settings/page.tsx` (load state, render a Memory section)

**Interfaces:**
- Consumes: `GET/DELETE /api/memories`, `PATCH/DELETE /api/memories/[id]`, `PATCH /api/settings` (Task 5); `getMemoryState`/`listMemories` (Task 2) for the server-rendered initial props; the `Button`, `Input`, `Card`, `AlertDialog*` primitives; `relativeTime` from `@/lib/relative-time`.
- Produces: `MemorySettings` component (props `{ enabled: boolean; initialMemories: { id: string; content: string; createdAt: string }[] }`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/memory-settings.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { MemorySettings } from "./memory-settings.js";

const initial = [
  { id: "m1", content: "is a product manager", createdAt: new Date().toISOString() },
  { id: "m2", content: "likes Kyoto", createdAt: new Date().toISOString() },
];

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response)));
afterEach(() => vi.unstubAllGlobals());

describe("MemorySettings", () => {
  it("lists facts and toggles memory via /api/settings", async () => {
    render(<MemorySettings enabled={true} initialMemories={initial} />);
    expect(screen.getByText("is a product manager")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /disable memory/i }));
    await waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      "/api/settings", expect.objectContaining({ method: "PATCH" }),
    ));
  });

  it("deletes a fact via its row control", async () => {
    render(<MemorySettings enabled={true} initialMemories={initial} />);
    fireEvent.click(screen.getAllByLabelText("Delete memory")[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      "/api/memories/m1", expect.objectContaining({ method: "DELETE" }),
    ));
    await waitFor(() => expect(screen.queryByText("is a product manager")).toBeNull());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gr/web exec vitest run components/memory-settings.test.tsx`
Expected: FAIL — `./memory-settings.js` does not exist.

- [ ] **Step 3: Implement the component**

Create `apps/web/components/memory-settings.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { relativeTime } from "@/lib/relative-time";

interface Fact { id: string; content: string; createdAt: string }

export function MemorySettings({ enabled: initialEnabled, initialMemories }: { enabled: boolean; initialMemories: Fact[] }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [items, setItems] = useState<Fact[]>(initialMemories);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    const res = await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ memoryEnabled: next }) });
    if (!res.ok) { setEnabled(!next); toast.error("Couldn't update memory setting"); }
  }

  async function saveEdit(id: string) {
    const content = draft.trim();
    if (!content) return;
    const res = await fetch(`/api/memories/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ content }) });
    if (res.ok) { setItems((xs) => xs.map((x) => (x.id === id ? { ...x, content } : x))); setEditing(null); }
    else toast.error("Couldn't save");
  }

  async function remove(id: string) {
    const res = await fetch(`/api/memories/${id}`, { method: "DELETE" });
    if (res.ok) setItems((xs) => xs.filter((x) => x.id !== id));
    else toast.error("Couldn't delete");
  }

  async function clearAll() {
    const res = await fetch("/api/memories", { method: "DELETE" });
    if (res.ok) { setItems([]); router.refresh(); }
    else toast.error("Couldn't clear memory");
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {enabled ? "GoldenRetriever remembers durable facts about you to personalize answers." : "Memory is off — no facts are used or added."}
        </p>
        <Button variant={enabled ? "outline" : "default"} size="sm" onClick={toggle}>
          {enabled ? "Disable memory" : "Enable memory"}
        </Button>
      </div>

      {items.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">No memories yet.</Card>
      ) : (
        <Card className="divide-y p-0">
          {items.map((m) => (
            <div key={m.id} className="flex items-center gap-2 px-3 py-2">
              {editing === m.id ? (
                <>
                  <Input className="flex-1" value={draft} onChange={(e) => setDraft(e.target.value)} />
                  <Button size="icon" variant="ghost" className="size-7" aria-label="Save memory" onClick={() => saveEdit(m.id)}><Check className="size-4" /></Button>
                  <Button size="icon" variant="ghost" className="size-7" aria-label="Cancel edit" onClick={() => setEditing(null)}><X className="size-4" /></Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm">{m.content}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(new Date(m.createdAt))}</span>
                  <Button size="icon" variant="ghost" className="size-7" aria-label="Edit memory" onClick={() => { setEditing(m.id); setDraft(m.content); }}><Pencil className="size-4" /></Button>
                  <AlertDialog>
                    <AlertDialogTrigger render={<Button size="icon" variant="ghost" className="size-7" aria-label="Delete memory"><Trash2 className="size-4" /></Button>} />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this memory?</AlertDialogTitle>
                        <AlertDialogDescription>&ldquo;{m.content}&rdquo; will be removed.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(m.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </div>
          ))}
        </Card>
      )}

      {items.length > 0 && (
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="destructive" size="sm">Clear all memory</Button>} />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all memory?</AlertDialogTitle>
              <AlertDialogDescription>Every remembered fact will be permanently removed. This can&apos;t be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={clearAll}>Clear all</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gr/web exec vitest run components/memory-settings.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Render the Memory section on the settings page**

In `apps/web/app/(app)/settings/page.tsx`, load the state server-side and render the component. Replace the file with:

```tsx
import { headers } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { createDb } from "@gr/db";
import { getMemoryState, listMemories } from "@gr/db/queries";
import { ApiTokens } from "../../../components/api-tokens.js";
import { MemorySettings } from "../../../components/memory-settings.js";

export default async function SettingsPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const baseUrl = process.env.APP_URL ?? (host ? `${proto}://${host}` : "");

  const { userId } = await auth();
  const { db } = createDb();
  const enabled = userId ? (await getMemoryState(db, userId)).enabled : true;
  const rows = userId ? await listMemories(db, userId) : [];
  const initialMemories = rows.map((m) => ({ id: m.id, content: m.content, createdAt: m.createdAt.toISOString() }));

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Settings</h1>
      <section className="space-y-2">
        <h2 className="font-medium">Memory</h2>
        <MemorySettings enabled={enabled} initialMemories={initialMemories} />
      </section>
      <section className="space-y-2">
        <h2 className="font-medium">API tokens</h2>
        <p className="text-sm text-neutral-600">
          Create a token for the iOS "Save to GoldenRetriever" Shortcut so you can capture links,
          text, and files from your phone&apos;s Share Sheet.
        </p>
        <ApiTokens baseUrl={baseUrl} />
      </section>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck + full suite**

Run: `pnpm --filter @gr/web typecheck && bash scripts/test.sh`
Expected: typecheck clean; entire node + component suite green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/memory-settings.tsx apps/web/components/memory-settings.test.tsx "apps/web/app/(app)/settings/page.tsx"
git commit -m "feat(web): Settings → Memory page (list, edit, delete, clear, toggle)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Deploy note (finishing the branch)

Phase 2 changes the schema, so before/at deploy the production Neon DB must get the new table + column:

```bash
# with the production DATABASE_URL in the environment:
pnpm --filter @gr/db exec drizzle-kit push
```

`drizzle-kit push` applies `schema.ts` (the `memories` table + `users.memory_enabled`) to the target DB. Run it against production before the Vercel deploy serves the new code.

---

## Plan Self-Review

**Spec coverage (Phase 2 rows of the design):**
- `memories` table (userId-scoped) + `users.memory_enabled` + migration → Task 1. ✓
- Extraction after each exchange (cheap model, 0-3 facts, embedding dedup, best-effort) → Task 3 (`extractMemories`) + Task 4 (`rememberFromExchange`, `onFinish`, enabled-gate, try/catch). ✓
- Inject facts into "About you" when enabled → Task 4 (`getMemoryState` → `buildChatPrompt.facts`). ✓
- Endpoints GET/PATCH/DELETE `/api/memories`, DELETE clear-all, PATCH `/api/settings` (session-only, 404-no-leak) → Task 5. ✓
- Settings → Memory page (list, inline edit, delete, clear-all, toggle) → Task 6. ✓
- Toggle off ⇒ no injection + no extraction → Task 4 (`memory.enabled` gates both). ✓
- Privacy: userId-scoped, ownership on every mutation → Tasks 2/5. ✓

**Placeholder scan:** No TBD/TODO/"handle errors"/"similar to" — every code step is complete. ✓

**Type consistency:** `insertMemoryIfNovel`, `getMemoryState`, `listMemories`, `updateMemory`, `deleteMemory`, `clearMemories`, `setMemoryEnabled`, `extractMemories`, `parseMemories`, `rememberFromExchange`, `MemorySettings` props — names/signatures match between definition and every call site across Tasks 2–6. `buildChatPrompt.facts` is the Phase-1 slot. `resolveIngestDeps().ai` / `__setIngestDeps` and `resolveSessionUser` / `__setSessionUser` seams match existing usage. ✓

**Note (Task 5 test):** `__setIngestDeps` takes the full `IngestDeps { ai, converter, urlFetcher }` (verified in `apps/web/lib/ingest-service.ts`), so the test passes `createMockAiClient()` + `new MockConverter()` (from `@gr/ingest`) + a stub `urlFetcher` — the memories endpoint only exercises `ai.embed`, but the seam requires all three.
