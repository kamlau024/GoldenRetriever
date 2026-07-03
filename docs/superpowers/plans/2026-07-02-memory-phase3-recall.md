# Memory Phase 3 — Semantic Recall — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each conversation a running summary + embedding, and inject the most relevant past-conversation summaries into the chat prompt so the model can draw on earlier chats.

**Architecture:** A `summary` + `summary_embedding` per conversation, updated best-effort in the chat route's `onFinish` (extending `rememberFromExchange`). At query time the route embeds the question, cosine-searches other conversations' summaries, and injects the top few into `buildChatPrompt`'s existing `pastChats` slot — all gated on `memory_enabled`.

**Tech Stack:** Next.js 15, Drizzle/Postgres + pgvector, AI SDK v6, Vitest.

## Global Constraints

- Recall + summary generation happen **only when `memory_enabled`** (the same toggle that gates facts).
- Summary generation is **best-effort** in `onFinish` (never breaks/delays the reply); recall at query time is wrapped so a failure falls back to `[]`.
- Summaries use the **cheap tagging model**; embeddings are **1536-dim** (reuse `ai.embed`).
- Recall excludes the **current thread** and conversations with **no summary**; deleting a conversation drops its summary (row deletion); **"Clear all memory"** also nulls conversation summaries/embeddings.
- Facts stay non-citable; recalled summaries go in the non-citable "Possibly relevant past chats" section (already in `buildChatPrompt`). Citation/REFUSAL rules unchanged.
- Prod schema via `pnpm --filter @gr/db exec drizzle-kit push`; test DB applies `drizzle/*.sql` on a fresh volume (`pnpm db:down && pnpm db:up`).
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Schema — `conversations.summary` + `summary_embedding`

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/drizzle/0002_conversation_summary.sql`
- Test: `packages/db/src/queries.summary.test.ts` (create — schema proof)

**Interfaces:**
- Produces: `conversations.summary text` + `conversations.summary_embedding vector(1536)` columns.

- [ ] **Step 1: Add the columns to the schema**

In `packages/db/src/schema.ts`, add `summary` + `summaryEmbedding` to the `conversations` table (after `title`; `vector` is already imported):

```ts
export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  kbId: text("kb_id").notNull().references(() => knowledgeBases.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  summary: text("summary"),
  summaryEmbedding: vector("summary_embedding", { dimensions: 1536 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 2: Write the migration**

Create `packages/db/drizzle/0002_conversation_summary.sql`:

```sql
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "summary" text;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "summary_embedding" vector(1536);
```

- [ ] **Step 3: Write the failing schema test**

Create `packages/db/src/queries.summary.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray, eq } from "drizzle-orm";
import { createDb } from "./client.js";
import { createUser, createKnowledgeBase, createConversation } from "./queries.js";
import { conversations, users } from "./schema.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
const USERS = ["u_sum_schema", "u_sum_q", "u_sum_recall", "u_sum_clear"];
let kbId: string;

beforeAll(async () => {
  await createUser(db, { id: "u_sum_schema", email: "ss@s.dev" });
  kbId = await createKnowledgeBase(db, { ownerId: "u_sum_schema", name: "Sum" });
});
afterAll(async () => { await db.delete(users).where(inArray(users.id, USERS)); await sql.end(); });

describe("conversation summary schema", () => {
  it("stores a summary + embedding on a conversation", async () => {
    const c = await createConversation(db, { kbId, userId: "u_sum_schema" });
    await db.update(conversations).set({ summary: "s", summaryEmbedding: new Array(1536).fill(0) }).where(eq(conversations.id, c));
    const rows = await db.select({ summary: conversations.summary }).from(conversations).where(eq(conversations.id, c));
    expect(rows[0].summary).toBe("s");
  });
});
```

- [ ] **Step 4: Reset the test DB and run**

Run:
```bash
pnpm db:down && pnpm db:up
bash scripts/test.sh packages/db/src/queries.summary.test.ts
```
Expected: fresh DB applies `0000` + `0001` + `0002`; test PASSES.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/0002_conversation_summary.sql packages/db/src/queries.summary.test.ts
git commit -m "feat(db): conversation summary + summary_embedding columns

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Summary queries + recall + clear extension

**Files:**
- Modify: `packages/db/src/queries.ts`
- Test: `packages/db/src/queries.summary.test.ts` (extend)

**Interfaces:**
- Consumes: `conversations` table (Task 1); `sql`/`eq` (already imported in `queries.ts`).
- Produces:
  - `setConversationSummary(db, conversationId, summary: string, embedding: number[]): Promise<void>`
  - `getConversationSummary(db, conversationId): Promise<string | null>`
  - `recallConversations(db, userId, queryEmbedding: number[], excludeConversationId: string, k?: number): Promise<string[]>`
  - `clearMemories` now also nulls the user's conversation summaries.

- [ ] **Step 1: Write the failing tests**

Append to `packages/db/src/queries.summary.test.ts` (add the imports to the `./queries.js` import):

```ts
import { setConversationSummary, getConversationSummary, recallConversations, clearMemories } from "./queries.js";

const axis = (i: number) => { const v = new Array(1536).fill(0); v[i] = 1; return v as number[]; };

describe("summary queries", () => {
  it("sets and gets a conversation summary", async () => {
    const uid = await createUser(db, { id: "u_sum_q", email: "sq@s.dev" });
    const kb = await createKnowledgeBase(db, { ownerId: uid, name: "Q" });
    const c = await createConversation(db, { kbId: kb, userId: uid });
    await setConversationSummary(db, c, "about Kyoto", axis(1));
    expect(await getConversationSummary(db, c)).toBe("about Kyoto");
  });

  it("recalls nearest summaries, excluding the current thread and null-summary conversations", async () => {
    const uid = await createUser(db, { id: "u_sum_recall", email: "sr@s.dev" });
    const kb = await createKnowledgeBase(db, { ownerId: uid, name: "R" });
    const a = await createConversation(db, { kbId: kb, userId: uid });
    const b = await createConversation(db, { kbId: kb, userId: uid });
    const cur = await createConversation(db, { kbId: kb, userId: uid }); // no summary → excluded
    await setConversationSummary(db, a, "Kyoto ryokan trip", axis(2));
    await setConversationSummary(db, b, "bread baking", axis(3));
    const near = await recallConversations(db, uid, axis(2), cur, 3);
    expect(near[0]).toBe("Kyoto ryokan trip");        // closest to axis(2)
    // excluding a itself removes it
    expect(await recallConversations(db, uid, axis(2), a, 3)).not.toContain("Kyoto ryokan trip");
  });

  it("clearMemories nulls the user's conversation summaries", async () => {
    const uid = await createUser(db, { id: "u_sum_clear", email: "sc@s.dev" });
    const kb = await createKnowledgeBase(db, { ownerId: uid, name: "C" });
    const c = await createConversation(db, { kbId: kb, userId: uid });
    await setConversationSummary(db, c, "temp", axis(4));
    await clearMemories(db, uid);
    expect(await getConversationSummary(db, c)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash scripts/test.sh packages/db/src/queries.summary.test.ts`
Expected: FAIL — `setConversationSummary`/`recallConversations` not exported.

- [ ] **Step 3: Implement the queries**

In `packages/db/src/queries.ts`, add (near the other conversation queries):

```ts
export async function setConversationSummary(db: Db, conversationId: string, summary: string, embedding: number[]): Promise<void> {
  await db.update(conversations).set({ summary, summaryEmbedding: embedding }).where(eq(conversations.id, conversationId));
}

export async function getConversationSummary(db: Db, conversationId: string): Promise<string | null> {
  const rows = await db.select({ summary: conversations.summary }).from(conversations).where(eq(conversations.id, conversationId));
  return rows[0]?.summary ?? null;
}

/** Semantically-nearest past-conversation summaries for a user, excluding the current thread and
 *  conversations without a summary. Returns the summary strings, closest first. */
export async function recallConversations(
  db: Db, userId: string, queryEmbedding: number[], excludeConversationId: string, k = 3,
): Promise<string[]> {
  const vec = `[${queryEmbedding.join(",")}]`;
  const rows = await db.execute<{ summary: string }>(sql`
    SELECT summary FROM conversations
    WHERE user_id = ${userId} AND id <> ${excludeConversationId}
      AND summary IS NOT NULL AND summary_embedding IS NOT NULL
    ORDER BY summary_embedding <=> ${vec}::vector
    LIMIT ${k}`);
  return [...rows].map((r) => r.summary);
}
```

And extend `clearMemories` to also clear summaries:

```ts
export async function clearMemories(db: Db, userId: string): Promise<void> {
  await db.delete(memories).where(eq(memories.userId, userId));
  await db.update(conversations).set({ summary: null, summaryEmbedding: null }).where(eq(conversations.userId, userId));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash scripts/test.sh packages/db/src/queries.summary.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/queries.ts packages/db/src/queries.summary.test.ts
git commit -m "feat(db): conversation summary set/get/recall + clear extension

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `ai.summarizeConversation`

**Files:**
- Create: `packages/ai/src/summary.ts`
- Test: `packages/ai/src/summary.test.ts`
- Modify: `packages/ai/src/index.ts` (add `summarizeConversation`)
- Modify: `packages/ai/src/mock.ts` (stub)

**Interfaces:**
- Produces: `cleanSummary(raw: string): string` (pure); `AiClient.summarizeConversation(priorSummary: string | null, userMessage: string, reply: string): Promise<string>`.

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/summary.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cleanSummary } from "./summary.js";

describe("cleanSummary", () => {
  it("collapses whitespace to a single line", () => {
    expect(cleanSummary("about\n  Kyoto   trips")).toBe("about Kyoto trips");
  });
  it("caps length at 300 chars", () => {
    expect(cleanSummary("x".repeat(400)).length).toBe(300);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/ai/src/summary.test.ts`
Expected: FAIL — `./summary.js` missing.

- [ ] **Step 3: Implement + wire**

Create `packages/ai/src/summary.ts`:

```ts
/** Normalize a model-produced conversation summary: single line, capped to 300 chars. */
export function cleanSummary(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 300);
}
```

In `packages/ai/src/index.ts`, add the import (near the `parseMemories` import):

```ts
import { cleanSummary } from "./summary.js";
```

Add to the `AiClient` interface (after `extractMemories`):

```ts
  /** A short running summary of a conversation, updated from the latest exchange, for recall. */
  summarizeConversation(priorSummary: string | null, userMessage: string, reply: string): Promise<string>;
```

Add the method to the object returned by `createAiClient` (after `extractMemories`):

```ts
    async summarizeConversation(priorSummary, userMessage, reply) {
      const { text } = await generateText({
        model: models.tagging,
        prompt:
          `Write or update a 1-2 sentence summary of a conversation, capturing its topic and any ` +
          `conclusions, for later retrieval. Reply with only the summary.\n\n` +
          (priorSummary ? `Current summary: ${priorSummary}\n\n` : "") +
          `Latest exchange:\nUser: ${userMessage.slice(0, 1000)}\nAssistant: ${reply.slice(0, 1000)}`,
      });
      return cleanSummary(text);
    },
```

In `packages/ai/src/mock.ts`, add a deterministic stub (after `extractMemories`):

```ts
    async summarizeConversation() { return "conversation summary"; },
```

- [ ] **Step 4: Run + typecheck**

Run: `pnpm exec vitest run packages/ai/src/summary.test.ts && pnpm --filter @gr/ai typecheck && pnpm exec vitest run packages/ai/src`
Expected: all PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/summary.ts packages/ai/src/summary.test.ts packages/ai/src/index.ts packages/ai/src/mock.ts
git commit -m "feat(ai): summarizeConversation (running summary for recall)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Update the summary on each exchange + recall helper

**Files:**
- Modify: `apps/web/lib/memory.ts` (extend `rememberFromExchange`; add `recallPastChats`)
- Modify: `apps/web/lib/chat-service.ts` (`ChatDeps.recall` + wiring)
- Test: `apps/web/test/memory-lib.test.ts` (create)

**Interfaces:**
- Consumes: `getConversationSummary`/`setConversationSummary`/`recallConversations` (Task 2); `ai.summarizeConversation` (Task 3).
- Produces: `rememberFromExchange` also updates the conversation summary; `recallPastChats(db, ai, { userId, question, excludeConversationId }): Promise<string[]>`; `ChatDeps.recall`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/memory-lib.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { createDb } from "@gr/db";
import { createUser, createKnowledgeBase, createConversation, getConversationSummary } from "@gr/db/queries";
import { users } from "@gr/db/schema";
import { createMockAiClient } from "@gr/ai/mock";
import { rememberFromExchange, recallPastChats } from "../lib/memory.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
const ai = createMockAiClient();
let kbId: string, uid: string;

beforeAll(async () => {
  uid = await createUser(db, { id: "u_memlib", email: "ml@m.dev" });
  kbId = await createKnowledgeBase(db, { ownerId: uid, name: "ML" });
});
afterAll(async () => { await db.delete(users).where(inArray(users.id, ["u_memlib"])); await sql.end(); });

describe("memory lib", () => {
  it("rememberFromExchange stores a conversation summary", async () => {
    const conv = await createConversation(db, { kbId, userId: uid });
    await rememberFromExchange(db, ai, { userId: uid, userMessage: "hi", reply: "hello", conversationId: conv });
    expect(await getConversationSummary(db, conv)).toBe("conversation summary");
  });

  it("recallPastChats returns summaries, excluding the current thread", async () => {
    const past = await createConversation(db, { kbId, userId: uid });
    await rememberFromExchange(db, ai, { userId: uid, userMessage: "kyoto", reply: "ryokan", conversationId: past });
    const cur = await createConversation(db, { kbId, userId: uid });
    const got = await recallPastChats(db, ai, { userId: uid, question: "kyoto", excludeConversationId: cur });
    expect(got).toContain("conversation summary");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash scripts/test.sh apps/web/test/memory-lib.test.ts`
Expected: FAIL — `recallPastChats` not exported / no summary stored.

- [ ] **Step 3: Extend `rememberFromExchange` + add `recallPastChats`**

Replace `apps/web/lib/memory.ts` with:

```ts
import type { drizzle } from "drizzle-orm/postgres-js";
import type { AiClient } from "@gr/ai";
import { insertMemoryIfNovel, getConversationSummary, setConversationSummary, recallConversations } from "@gr/db/queries";

type Db = ReturnType<typeof drizzle>;

/** Best-effort: distil durable facts from one exchange AND update the conversation's running summary. */
export async function rememberFromExchange(
  db: Db,
  ai: AiClient,
  args: { userId: string; userMessage: string; reply: string; conversationId: string },
): Promise<void> {
  const facts = await ai.extractMemories(args.userMessage, args.reply);
  if (facts.length > 0) {
    const embeddings = await ai.embed(facts);
    for (let i = 0; i < facts.length; i++) {
      await insertMemoryIfNovel(db, {
        userId: args.userId, content: facts[i], kind: "fact",
        embedding: embeddings[i], sourceConversationId: args.conversationId,
      });
    }
  }
  // Update the conversation's running summary + embedding for recall (Phase 3).
  const prior = await getConversationSummary(db, args.conversationId);
  const summary = await ai.summarizeConversation(prior, args.userMessage, args.reply);
  if (summary) {
    const [emb] = await ai.embed([summary]);
    await setConversationSummary(db, args.conversationId, summary, emb);
  }
}

/** Semantic recall: summaries of past conversations most relevant to the current question. */
export async function recallPastChats(
  db: Db,
  ai: AiClient,
  args: { userId: string; question: string; excludeConversationId: string },
): Promise<string[]> {
  const [emb] = await ai.embed([args.question]);
  return recallConversations(db, args.userId, emb, args.excludeConversationId, 3);
}
```

- [ ] **Step 4: Add `recall` to `ChatDeps`**

In `apps/web/lib/chat-service.ts`, update the import and `ChatDeps` + `resolveChatDeps`:

```ts
import { rememberFromExchange, recallPastChats } from "./memory.js";
```

```ts
export interface ChatDeps {
  retriever: Retriever;
  model: LanguageModel;
  titleConversation?: (firstMessage: string) => Promise<string>;
  remember?: (args: { userId: string; userMessage: string; reply: string; conversationId: string }) => Promise<void>;
  recall?: (args: { userId: string; question: string; excludeConversationId: string }) => Promise<string[]>;
}
```

In `resolveChatDeps`'s returned object, add:

```ts
    remember: (args) => rememberFromExchange(db, ai, args),
    recall: (args) => recallPastChats(db, ai, args),
```

- [ ] **Step 5: Run to verify it passes**

Run: `bash scripts/test.sh apps/web/test/memory-lib.test.ts && pnpm --filter @gr/web typecheck`
Expected: PASS (2 tests); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/memory.ts apps/web/lib/chat-service.ts apps/web/test/memory-lib.test.ts
git commit -m "feat(web): update conversation summary per exchange + recall helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Inject recalled summaries into the chat prompt

**Files:**
- Modify: `apps/web/app/api/chat/route.ts`
- Test: `apps/web/test/chat-route.test.ts` (extend)

**Interfaces:**
- Consumes: `ChatDeps.recall` (Task 4); `buildChatPrompt`'s `pastChats` slot.

- [ ] **Step 1: Write the failing tests**

In `apps/web/test/chat-route.test.ts`, add inside the `describe("POST /api/chat", …)` block:

```ts
  it("injects recalled past-conversation summaries when memory is enabled", async () => {
    __setChatDeps({
      retriever: retrieverReturning([chunk("Roadmapping tips.")]),
      model: capturingModel("Sure [1]."),
      recall: async () => ["Earlier you planned a Kyoto trip."],
    });
    await (await post({ kbId, message: "plan my week" })).text();
    expect(capturedPrompt).toContain("Possibly relevant past chats");
    expect(capturedPrompt).toContain("Earlier you planned a Kyoto trip");
  });

  it("does not recall when memory is disabled", async () => {
    const { setMemoryEnabled } = await import("@gr/db/queries");
    let recallCalls = 0;
    await setMemoryEnabled(db, "u_chat_r", false);
    __setChatDeps({ retriever: retrieverReturning([chunk("x")]), model: modelSaying("y [1]."), recall: async () => { recallCalls++; return []; } });
    await (await post({ kbId, message: "hi" })).text();
    expect(recallCalls).toBe(0);
    await setMemoryEnabled(db, "u_chat_r", true); // restore for other tests
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash scripts/test.sh apps/web/test/chat-route.test.ts`
Expected: FAIL — no "Possibly relevant past chats" (the route doesn't recall yet); a type error on `recall` in `__setChatDeps` is expected until Task 4 is present (it is).

- [ ] **Step 3: Recall + inject in the route**

In `apps/web/app/api/chat/route.ts`:

Destructure `recall`:

```ts
  const { retriever, model, titleConversation, remember, recall } = resolveChatDeps(db);
```

After the no-hits/REFUSAL branch and before building the prompt, recall (best-effort, gated):

```ts
  let pastChats: string[] = [];
  if (memory.enabled && recall) {
    try { pastChats = await recall({ userId: principal.userId, question: message, excludeConversationId: convId }); }
    catch { /* best-effort — recall must not break the reply */ }
  }
```

Pass it into `buildChatPrompt`:

```ts
    prompt: buildChatPrompt({
      question: message,
      sources: hits.map((h) => h.content),
      history: priorMessages,
      facts: memory.enabled ? memory.facts : [],
      pastChats,
    }),
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash scripts/test.sh apps/web/test/chat-route.test.ts`
Expected: PASS — existing chat-route tests plus the two new recall tests.

- [ ] **Step 5: Typecheck + full suite**

Run: `pnpm --filter @gr/web typecheck && bash scripts/test.sh`
Expected: typecheck clean; whole node + component suite green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/chat/route.ts apps/web/test/chat-route.test.ts
git commit -m "feat(web): inject recalled past-conversation summaries into the chat prompt

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Deploy note

Phase 3 adds columns, so before/at deploy run `pnpm --filter @gr/db exec drizzle-kit push` against production Neon (with the prod `DATABASE_URL`) to add `conversations.summary` + `summary_embedding` before the new code serves.

---

## Plan Self-Review

**Spec coverage (Phase 3 rows):**
- `conversations.summary` + `summary_embedding` + migration → Task 1. ✓
- Summary generated/updated in `onFinish` (cheap model) → Task 3 (`summarizeConversation`) + Task 4 (`rememberFromExchange`). ✓
- Recall: embed question, cosine over summaries, exclude current + null, top-3, inject into "Possibly relevant past chats" → Task 2 (`recallConversations`) + Task 4 (`recallPastChats`) + Task 5 (route). ✓
- Gated on `memory_enabled`; best-effort → Task 5 (recall gate + try/catch), Task 4/route (summary in the already-gated `remember`). ✓
- "Clear all memory" clears summaries; deleting a conversation drops its summary → Task 2 (`clearMemories` extension); row-delete cascade is inherent. ✓
- Tests: schema (T1); set/get/recall/clear (T2); cleanSummary (T3); rememberFromExchange summary + recallPastChats (T4); route injection + gating (T5). ✓

**Placeholder scan:** No TBD/TODO/"handle errors"/"similar to" — complete code in every step. ✓

**Type consistency:** `setConversationSummary`/`getConversationSummary`/`recallConversations`, `summarizeConversation(priorSummary, userMessage, reply)`, `cleanSummary`, `rememberFromExchange`, `recallPastChats({ userId, question, excludeConversationId })`, and `ChatDeps.recall` match between definition and every call site (Tasks 2→4→5). `summaryEmbedding` (Drizzle) ↔ `summary_embedding` (SQL) consistent. The route's `pastChats` uses the Phase-1 `buildChatPrompt` slot. ✓
