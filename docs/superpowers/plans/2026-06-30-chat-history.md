# Chat History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface and resume the conversations the backend already persists — a slide-over History drawer on the Chat page that lists past conversations, opens one (reloading its transcript), starts a new chat, and deletes a conversation, with LLM-generated titles.

**Architecture:** Client-driven drawer + three thin REST endpoints. The streaming Chat client stays intact and gains conversation state plus a drawer. Titles are generated server-side in the chat route's existing `onFinish`. No schema migration — ordering uses `max(messages.created_at)`.

**Tech Stack:** Next.js 15 App Router, Drizzle + Postgres/pgvector, `@gr/ai` (Vercel AI Gateway via `generateText`), base-ui (`@base-ui/react`), Tailwind v4, Vitest.

## Global Constraints

- Auth via `resolveAuth(db, req)` (Clerk session **or** bearer API token). Ownership failures return **404** (never 403) so a conversation's existence is not leaked — mirrors `apps/web/app/api/documents/[id]/route.ts`.
- UI on **base-ui** (`@base-ui/react`) using `render={<X/>}` props (NOT Radix `asChild`); Tailwind v4 theme tokens; `cn` from `@/lib/utils`; `@/` alias → `apps/web` root.
- Titling uses the **tagging model** (`GR_TAGGING_MODEL`, cheap) — never the generation model.
- This feature does **not** change what the model sees per question (no prior-turn context). Resuming reloads the transcript and appends to the thread; each answer is still independent.
- No new heavyweight dependencies. Reuse existing UI primitives.
- Test runners: node/integration via `bash scripts/test.sh <path>` (boots pgvector on :5433, applies schema); pure node unit via `pnpm exec vitest run <path>`; component (jsdom) via `pnpm --filter @gr/web exec vitest run components/<file>`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Conversation queries

**Files:**
- Modify: `packages/db/src/queries.ts`
- Test: `packages/db/src/queries.conversations.test.ts` (create)

**Interfaces:**
- Consumes (existing in `queries.ts`): `createConversation(db, { kbId, userId, title? })`, `appendMessage(db, { conversationId, role, content, citations?, tokens? })`, `getMessages(db, conversationId)`, the imported `conversations` and `messages` tables, and `sql` from `drizzle-orm`.
- Produces:
  - `interface ConversationSummary { id: string; title: string | null; lastActivityAt: Date; messageCount: number }`
  - `interface ConversationDetail { id: string; title: string | null; messages: { id: string; role: string; content: string; citations: unknown }[] }`
  - `listConversations(db, userId: string, kbId: string): Promise<ConversationSummary[]>`
  - `getConversationForUser(db, conversationId: string, userId: string): Promise<ConversationDetail | null>`
  - `deleteConversation(db, conversationId: string, userId: string): Promise<boolean>`
  - `setConversationTitle(db, conversationId: string, title: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/queries.conversations.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb } from "./client.js";
import {
  createUser, createKnowledgeBase, createConversation, appendMessage, getMessages,
  listConversations, getConversationForUser, deleteConversation, setConversationTitle,
} from "./queries.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, uid: string, otherUid: string, otherKb: string;

beforeAll(async () => {
  uid = await createUser(db, { id: "u_conv", email: "conv@c.dev" });
  otherUid = await createUser(db, { id: "u_conv_other", email: "convo@c.dev" });
  kbId = await createKnowledgeBase(db, { ownerId: uid, name: "Conv" });
  otherKb = await createKnowledgeBase(db, { ownerId: otherUid, name: "Other" });
});
afterAll(async () => { await sql.end(); });

describe("conversation queries", () => {
  it("lists conversations ordered by last activity with message counts", async () => {
    const a = await createConversation(db, { kbId, userId: uid, title: "A" });
    const b = await createConversation(db, { kbId, userId: uid, title: "B" });
    await appendMessage(db, { conversationId: a, role: "user", content: "first in A" });
    await appendMessage(db, { conversationId: b, role: "user", content: "later in B" });
    await appendMessage(db, { conversationId: b, role: "assistant", content: "reply in B" });
    const list = await listConversations(db, uid, kbId);
    const ids = list.map((c) => c.id);
    expect(ids.indexOf(b)).toBeLessThan(ids.indexOf(a)); // b is more recent → sorts first
    expect(list.find((c) => c.id === b)!.messageCount).toBe(2);
    expect(list.find((c) => c.id === a)!.messageCount).toBe(1);
  });

  it("scopes the list to the owner and kb", async () => {
    const mine = await createConversation(db, { kbId, userId: uid });
    await createConversation(db, { kbId: otherKb, userId: otherUid });
    expect((await listConversations(db, uid, kbId)).some((c) => c.id === mine)).toBe(true);
    expect((await listConversations(db, otherUid, otherKb)).some((c) => c.id === mine)).toBe(false);
  });

  it("returns a conversation with messages only to its owner", async () => {
    const c = await createConversation(db, { kbId, userId: uid, title: "Detail" });
    await appendMessage(db, { conversationId: c, role: "user", content: "hello", citations: null });
    await appendMessage(db, { conversationId: c, role: "assistant", content: "hi", citations: [{ title: "T", sourceUrl: null }] });
    const detail = await getConversationForUser(db, c, uid);
    expect(detail).not.toBeNull();
    expect(detail!.title).toBe("Detail");
    expect(detail!.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(await getConversationForUser(db, c, otherUid)).toBeNull(); // not owner → null
  });

  it("deletes a conversation (cascading messages) only for its owner", async () => {
    const c = await createConversation(db, { kbId, userId: uid });
    await appendMessage(db, { conversationId: c, role: "user", content: "x" });
    expect(await deleteConversation(db, c, otherUid)).toBe(false);
    expect(await deleteConversation(db, c, uid)).toBe(true);
    expect(await getMessages(db, c)).toEqual([]); // cascaded
    expect(await getConversationForUser(db, c, uid)).toBeNull();
  });

  it("sets a conversation title", async () => {
    const c = await createConversation(db, { kbId, userId: uid });
    await setConversationTitle(db, c, "Kyoto stay");
    expect((await getConversationForUser(db, c, uid))!.title).toBe("Kyoto stay");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/test.sh packages/db/src/queries.conversations.test.ts`
Expected: FAIL — `listConversations` (and the other new functions) are not exported.

- [ ] **Step 3: Implement the queries**

In `packages/db/src/queries.ts`, add the two interfaces and four functions. Place them just **above** the existing `createConversation` function (the `conversations` and `messages` tables and `sql` are already imported at the top of the file):

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/test.sh packages/db/src/queries.conversations.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/queries.ts packages/db/src/queries.conversations.test.ts
git commit -m "feat(db): conversation list/detail/delete/title queries

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Conversation title generator (AI)

**Files:**
- Create: `packages/ai/src/title.ts`
- Test: `packages/ai/src/title.test.ts` (create)
- Modify: `packages/ai/src/index.ts`

**Interfaces:**
- Consumes (existing): `generateText` from `ai`; `models.tagging` from `resolveModels(env)` inside `createAiClient`.
- Produces:
  - `cleanTitle(raw: string): string` (pure)
  - `AiClient.titleConversation(firstMessage: string): Promise<string>`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/title.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cleanTitle } from "./title.js";

describe("cleanTitle", () => {
  it("strips wrapping quotes and trailing punctuation", () => {
    expect(cleanTitle('"Kyoto lodging."')).toBe("Kyoto lodging");
    expect(cleanTitle("“Best ryokan options”")).toBe("Best ryokan options");
  });
  it("collapses whitespace and newlines into one line", () => {
    expect(cleanTitle("Kyoto\n  trip   plan")).toBe("Kyoto trip plan");
  });
  it("caps length at 60 characters", () => {
    expect(cleanTitle("x".repeat(100)).length).toBe(60);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/ai/src/title.test.ts`
Expected: FAIL — `./title.js` does not exist.

- [ ] **Step 3: Implement `cleanTitle`**

Create `packages/ai/src/title.ts`:

```ts
/** Normalize a model-produced conversation title: one line, no wrapping quotes, no trailing
 *  punctuation, capped to 60 characters. */
export function cleanTitle(raw: string): string {
  const oneLine = raw.replace(/\s+/g, " ").trim();
  const unquoted = oneLine.replace(/^["'“”]+/, "").replace(/["'“”]+$/, "").trim();
  const noTrailingPunct = unquoted.replace(/[.!?,;:]+$/, "").trim();
  return noTrailingPunct.slice(0, 60);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/ai/src/title.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire `titleConversation` into the AI client**

In `packages/ai/src/index.ts`:

1. Add the import after the existing `rerank` import:

```ts
import { cleanTitle } from "./title.js";
```

2. Add to the `AiClient` interface (after the `rerank` line):

```ts
  /** A short (≤6-word) title for a conversation, from its opening question. */
  titleConversation(firstMessage: string): Promise<string>;
```

3. Add the method to the object returned by `createAiClient` (after `rerank`):

```ts
    async titleConversation(firstMessage) {
      const { text } = await generateText({
        model: models.tagging,
        prompt:
          `Write a concise title (at most 6 words, no quotes, no trailing punctuation) for a ` +
          `conversation that begins with this question:\n\n${firstMessage.slice(0, 500)}`,
      });
      return cleanTitle(text);
    },
```

- [ ] **Step 6: Verify typecheck + ai tests still pass**

Run: `pnpm --filter @gr/ai typecheck && pnpm exec vitest run packages/ai/src`
Expected: typecheck clean; all ai tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ai/src/title.ts packages/ai/src/title.test.ts packages/ai/src/index.ts
git commit -m "feat(ai): titleConversation + cleanTitle helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Title new conversations in the chat route

**Files:**
- Modify: `apps/web/lib/chat-service.ts`
- Modify: `apps/web/app/api/chat/route.ts`
- Test: `apps/web/test/chat-route.test.ts` (modify)

**Interfaces:**
- Consumes: `AiClient.titleConversation` (Task 2), `setConversationTitle` and `getConversationForUser` (Task 1).
- Produces:
  - `ChatDeps.titleConversation?: (firstMessage: string) => Promise<string>` (optional, so existing `__setChatDeps({ retriever, model })` callers still typecheck).
  - `firstWords(text: string, max?: number): string` exported from `chat-service.ts`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/test/chat-route.test.ts`, add these two cases inside the `describe("POST /api/chat", …)` block (after the existing "refuses honestly" test):

```ts
  it("titles a new conversation from the model and persists it", async () => {
    __setChatDeps({
      retriever: retrieverReturning([chunk("Tawaraya is a ryokan in Kyoto.")]),
      model: modelSaying("Stay at Tawaraya [1]."),
      titleConversation: async () => "Kyoto stay",
    });
    const res = await post({ kbId, message: "where to stay in Kyoto?" });
    const convId = res.headers.get("x-conversation-id")!;
    await res.text(); // drain the stream so onFinish (and titling) runs
    const { getConversationForUser } = await import("@gr/db/queries");
    expect((await getConversationForUser(db, convId, "u_chat_r"))!.title).toBe("Kyoto stay");
  });

  it("falls back to a snippet title when titling throws", async () => {
    __setChatDeps({
      retriever: retrieverReturning([chunk("Bread needs flour, water, salt, yeast.")]),
      model: modelSaying("Mix and bake [1]."),
      titleConversation: async () => { throw new Error("model down"); },
    });
    const res = await post({ kbId, message: "how do I bake no knead bread at home" });
    const convId = res.headers.get("x-conversation-id")!;
    await res.text();
    const { getConversationForUser } = await import("@gr/db/queries");
    expect((await getConversationForUser(db, convId, "u_chat_r"))!.title).toBe("how do I bake no knead");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bash scripts/test.sh apps/web/test/chat-route.test.ts`
Expected: FAIL — `titleConversation` is not a property of `ChatDeps` (type error) and titles are not set.

- [ ] **Step 3: Extend `ChatDeps` and add `firstWords`**

In `apps/web/lib/chat-service.ts`, replace the `ChatDeps` interface and `resolveChatDeps` function with:

```ts
export interface ChatDeps {
  retriever: Retriever;
  model: LanguageModel;
  titleConversation?: (firstMessage: string) => Promise<string>;
}
let override: ChatDeps | null = null;
export function __setChatDeps(d: ChatDeps | null) { override = d; }
export function resolveChatDeps(db: Db): ChatDeps {
  if (override) return override;
  const ai = createAiClient();
  return {
    retriever: new HybridRetriever(db, ai),
    model: env.GR_GENERATION_MODEL,
    titleConversation: (m) => ai.titleConversation(m),
  };
}

/** First ~6 words of a message, capped — the fallback title when LLM titling fails. */
export function firstWords(text: string, max = 60): string {
  return text.trim().split(/\s+/).slice(0, 6).join(" ").slice(0, max);
}
```

(Keep the existing `import { createAiClient } from "@gr/ai";`, `REFUSAL`, and `groundedPrompt` exactly as they are.)

- [ ] **Step 4: Title new conversations in the route**

In `apps/web/app/api/chat/route.ts`:

1. Add `setConversationTitle` to the db-queries import and `firstWords` to the chat-service import:

```ts
import { createConversation, appendMessage, setConversationTitle } from "@gr/db/queries";
import { resolveChatDeps, groundedPrompt, REFUSAL, firstWords } from "../../../lib/chat-service.js";
```

2. Record whether this request starts a new conversation — change the `convId` line to:

```ts
  const isNew = !conversationId;
  const convId = conversationId ?? await createConversation(db, { kbId, userId: principal.userId });
```

3. Destructure `titleConversation`:

```ts
  const { retriever, model, titleConversation } = resolveChatDeps(db);
```

4. In the `streamText` `onFinish` callback, after the existing `await appendMessage({ … role: "assistant" … })`, add:

```ts
        if (isNew && titleConversation) {
          let title: string;
          try { title = await titleConversation(message); }
          catch { title = firstWords(message); }
          await setConversationTitle(db, convId, title || firstWords(message));
        }
```

(The refusal branch keeps creating a conversation but is intentionally left untitled → it shows "Untitled chat".)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bash scripts/test.sh apps/web/test/chat-route.test.ts`
Expected: PASS — all existing cases plus the two new titling cases.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/chat-service.ts apps/web/app/api/chat/route.ts apps/web/test/chat-route.test.ts
git commit -m "feat(web): generate a title for new chat conversations

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Conversation REST endpoints

**Files:**
- Create: `apps/web/app/api/conversations/route.ts`
- Create: `apps/web/app/api/conversations/[id]/route.ts`
- Test: `apps/web/test/conversations-route.test.ts` (create)

**Interfaces:**
- Consumes: `listConversations`, `getConversationForUser`, `deleteConversation` (Task 1); `getOrCreatePersonalKb` (existing); `resolveAuth` (existing); `hashToken` (existing, for the test).
- Produces: `GET /api/conversations` → `{ conversations: ConversationSummary[] }`; `GET /api/conversations/[id]` → `ConversationDetail` (404 if not owner); `DELETE /api/conversations/[id]` → `{ ok: true }` (404 if not owner).

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/conversations-route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser, getOrCreatePersonalKb, createConversation, appendMessage } from "@gr/db/queries";
import { hashToken } from "../lib/auth.js";
import { GET as listGet } from "../app/api/conversations/route.js";
import { GET as detailGet, DELETE as detailDelete } from "../app/api/conversations/[id]/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, uid: string, token: string, otherToken: string;

async function mkUserToken(id: string, email: string, tok: string) {
  const u = await createUser(db, { id, email });
  await db.insert(schema.apiTokens).values({ id: `tok_${randomUUID().slice(0, 8)}`, userId: u, name: "t", tokenHash: hashToken(tok) });
  return u;
}
const req = (url: string, tok?: string, method = "GET") =>
  new NextRequest(url, { method, headers: tok ? { authorization: `Bearer ${tok}` } : {} });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  token = "grt_conv_owner"; otherToken = "grt_conv_other";
  uid = await mkUserToken("u_conv_route", "cvr@c.dev", token);
  await mkUserToken("u_conv_route_other", "cvro@c.dev", otherToken);
  kbId = await getOrCreatePersonalKb(db, uid);
});
afterAll(async () => { await sql.end(); });

describe("conversations endpoints", () => {
  it("lists only the caller's conversations", async () => {
    const c = await createConversation(db, { kbId, userId: uid, title: "Mine" });
    await appendMessage(db, { conversationId: c, role: "user", content: "hi" });
    const res = await listGet(req("http://localhost/api/conversations", token));
    expect(res.status).toBe(200);
    expect((await res.json()).conversations.some((x: { id: string }) => x.id === c)).toBe(true);
  });

  it("401 without auth", async () => {
    expect((await listGet(req("http://localhost/api/conversations"))).status).toBe(401);
  });

  it("returns a conversation's messages to its owner, 404 to others", async () => {
    const c = await createConversation(db, { kbId, userId: uid, title: "Detail" });
    await appendMessage(db, { conversationId: c, role: "user", content: "hello" });
    const ok = await detailGet(req(`http://localhost/api/conversations/${c}`, token), ctx(c));
    expect(ok.status).toBe(200);
    expect((await ok.json()).messages).toHaveLength(1);
    const denied = await detailGet(req(`http://localhost/api/conversations/${c}`, otherToken), ctx(c));
    expect(denied.status).toBe(404);
  });

  it("deletes only the caller's conversation", async () => {
    const c = await createConversation(db, { kbId, userId: uid });
    const denied = await detailDelete(req(`http://localhost/api/conversations/${c}`, otherToken, "DELETE"), ctx(c));
    expect(denied.status).toBe(404);
    const ok = await detailDelete(req(`http://localhost/api/conversations/${c}`, token, "DELETE"), ctx(c));
    expect(ok.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/test.sh apps/web/test/conversations-route.test.ts`
Expected: FAIL — the route modules do not exist.

- [ ] **Step 3: Implement the list endpoint**

Create `apps/web/app/api/conversations/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createDb } from "@gr/db";
import { getOrCreatePersonalKb, listConversations } from "@gr/db/queries";
import { resolveAuth } from "../../../lib/clerk-auth.js";

export async function GET(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const kbId = await getOrCreatePersonalKb(db, principal.userId);
  const conversations = await listConversations(db, principal.userId, kbId);
  return NextResponse.json({ conversations });
}
```

- [ ] **Step 4: Implement the detail + delete endpoint**

Create `apps/web/app/api/conversations/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createDb } from "@gr/db";
import { getConversationForUser, deleteConversation } from "@gr/db/queries";
import { resolveAuth } from "../../../../lib/clerk-auth.js";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const detail = await getConversationForUser(db, id, principal.userId);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(detail);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const ok = await deleteConversation(db, id, principal.userId);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bash scripts/test.sh apps/web/test/conversations-route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/conversations/ apps/web/test/conversations-route.test.ts
git commit -m "feat(web): /api/conversations list/detail/delete endpoints

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: History drawer (relative-time util + Sheet primitive + ChatHistory)

**Files:**
- Create: `apps/web/lib/relative-time.ts`
- Test: `apps/web/lib/relative-time.test.ts` (create)
- Create: `apps/web/components/ui/sheet.tsx`
- Create: `apps/web/components/chat-history.tsx`
- Test: `apps/web/components/chat-history.test.tsx` (create)

**Interfaces:**
- Consumes: `GET /api/conversations` and `DELETE /api/conversations/[id]` (Task 4); existing UI primitives `Button`, `ScrollArea`, `Skeleton`, the `AlertDialog*` family; `cn`.
- Produces:
  - `relativeTime(date: Date, now?: Date): string`
  - `Sheet`, `SheetTrigger`, `SheetClose`, `SheetContent`, `SheetTitle` (base-ui Dialog wrappers)
  - `ChatHistory` component with props `{ open: boolean; activeId: string | null; onSelect: (id: string) => void; onNew: () => void; onDeletedActive: () => void }`
  - client type `interface ConversationSummary { id: string; title: string | null; lastActivityAt: string; messageCount: number }`

- [ ] **Step 1: Write the failing relative-time test**

Create `apps/web/lib/relative-time.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { relativeTime } from "./relative-time.js";

const now = new Date("2026-06-30T12:00:00Z");
describe("relativeTime", () => {
  it("formats minutes, hours, and days in the past", () => {
    expect(relativeTime(new Date("2026-06-30T11:58:00Z"), now)).toMatch(/2 min/);
    expect(relativeTime(new Date("2026-06-30T09:00:00Z"), now)).toMatch(/3 hour/);
    expect(relativeTime(new Date("2026-06-27T12:00:00Z"), now)).toMatch(/3 day/);
  });
  it("shows 'just now' for very recent times", () => {
    expect(relativeTime(new Date("2026-06-30T11:59:50Z"), now)).toBe("just now");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run apps/web/lib/relative-time.test.ts`
Expected: FAIL — `./relative-time.js` does not exist.

- [ ] **Step 3: Implement `relativeTime`**

Create `apps/web/lib/relative-time.ts`:

```ts
const DIVISIONS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
];
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** Compact relative timestamp: "just now", "2 minutes ago", "3 hours ago", "3 days ago". */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const secs = Math.round((date.getTime() - now.getTime()) / 1000); // negative for the past
  const abs = Math.abs(secs);
  if (abs < 45) return "just now";
  for (const [unit, inSecs] of DIVISIONS) {
    if (abs >= inSecs) return rtf.format(Math.round(secs / inSecs), unit);
  }
  return "just now";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run apps/web/lib/relative-time.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Create the Sheet primitive**

Create `apps/web/components/ui/sheet.tsx` (base-ui Dialog styled as a side slide-over; mirrors `ui/alert-dialog.tsx` conventions — `@base-ui/react/dialog` exposes the same `Root/Trigger/Close/Portal/Backdrop/Popup/Title` parts as alert-dialog):

```tsx
"use client"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"

function Sheet({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetContent({
  className,
  side = "left",
  children,
  ...props
}: DialogPrimitive.Popup.Props & { side?: "left" | "right" }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-black/20 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed inset-y-0 z-50 flex h-full w-80 max-w-[85vw] flex-col gap-3 bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10 duration-150 outline-none",
          side === "left"
            ? "left-0 data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left"
            : "right-0 data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right",
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

function SheetTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title data-slot="sheet-title" className={cn("text-sm font-semibold", className)} {...props} />
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetTitle }
```

If the `@base-ui/react/dialog` namespace turns out to name any part differently, open `apps/web/components/ui/alert-dialog.tsx` and match the exact part names it uses (that file is known-good against the same base-ui version).

- [ ] **Step 6: Write the failing ChatHistory test**

Create `apps/web/components/chat-history.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { ChatHistory } from "./chat-history.js";

const conversations = [
  { id: "c1", title: "Kyoto trip", lastActivityAt: new Date().toISOString(), messageCount: 4 },
  { id: "c2", title: null, lastActivityAt: new Date().toISOString(), messageCount: 1 },
];

function makeFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/conversations") return { ok: true, json: async () => ({ conversations }) } as Response;
    if (init?.method === "DELETE") return { ok: true, json: async () => ({ ok: true }) } as Response;
    return { ok: false } as Response;
  });
}

beforeEach(() => vi.stubGlobal("fetch", makeFetch()));
afterEach(() => vi.unstubAllGlobals());

const noop = () => {};

describe("ChatHistory", () => {
  it("lists conversations (with an Untitled fallback) when opened", async () => {
    render(<ChatHistory open activeId={null} onSelect={noop} onNew={noop} onDeletedActive={noop} />);
    expect(await screen.findByText("Kyoto trip")).toBeTruthy();
    expect(screen.getByText("Untitled chat")).toBeTruthy();
  });

  it("calls onSelect when a conversation row is clicked", async () => {
    const onSelect = vi.fn();
    render(<ChatHistory open activeId={null} onSelect={onSelect} onNew={noop} onDeletedActive={noop} />);
    fireEvent.click(await screen.findByText("Kyoto trip"));
    expect(onSelect).toHaveBeenCalledWith("c1");
  });

  it("calls onNew for the New chat button", async () => {
    const onNew = vi.fn();
    render(<ChatHistory open activeId={null} onSelect={noop} onNew={onNew} onDeletedActive={noop} />);
    fireEvent.click(await screen.findByText("New chat"));
    expect(onNew).toHaveBeenCalled();
  });

  it("deletes a conversation after confirming and reports when the active one is removed", async () => {
    const onDeletedActive = vi.fn();
    render(<ChatHistory open activeId="c1" onSelect={noop} onNew={noop} onDeletedActive={onDeletedActive} />);
    await screen.findByText("Kyoto trip");
    fireEvent.click(screen.getAllByLabelText("Delete conversation")[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText("Kyoto trip")).toBeNull());
    expect(onDeletedActive).toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm --filter @gr/web exec vitest run components/chat-history.test.tsx`
Expected: FAIL — `./chat-history.js` does not exist.

- [ ] **Step 8: Implement ChatHistory**

Create `apps/web/components/chat-history.tsx`:

```tsx
"use client";
import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { relativeTime } from "@/lib/relative-time";

export interface ConversationSummary {
  id: string;
  title: string | null;
  lastActivityAt: string;
  messageCount: number;
}

export function ChatHistory({ open, activeId, onSelect, onNew, onDeletedActive }: {
  open: boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDeletedActive: () => void;
}) {
  const [items, setItems] = useState<ConversationSummary[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) throw new Error();
      setItems((await res.json()).conversations);
    } catch {
      setItems([]);
      toast.error("Couldn't load history");
    }
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setItems((xs) => (xs ?? []).filter((x) => x.id !== id));
      if (id === activeId) onDeletedActive();
    } catch {
      toast.error("Couldn't delete");
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">History</span>
        <Button size="sm" variant="outline" onClick={onNew}><Plus className="size-4" /> New chat</Button>
      </div>
      <ScrollArea className="-mx-1 flex-1">
        <div className="flex flex-col gap-1 px-1">
          {items === null ? (
            <>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </>
          ) : items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">No conversations yet.</p>
          ) : (
            items.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "group flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted",
                  c.id === activeId && "bg-muted",
                )}
              >
                <button type="button" onClick={() => onSelect(c.id)} className="flex min-w-0 flex-1 items-center gap-2">
                  <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{c.title ?? "Untitled chat"}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(new Date(c.lastActivityAt))}</span>
                </button>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button variant="ghost" size="icon" className="size-7 shrink-0 opacity-0 group-hover:opacity-100" aria-label="Delete conversation">
                        <Trash2 className="size-4" />
                      </Button>
                    }
                  />
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
                      <AlertDialogDescription>&ldquo;{c.title ?? "Untitled chat"}&rdquo; will be permanently removed.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => remove(c.id)}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter @gr/web exec vitest run components/chat-history.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 10: Commit**

```bash
git add apps/web/lib/relative-time.ts apps/web/lib/relative-time.test.ts apps/web/components/ui/sheet.tsx apps/web/components/chat-history.tsx apps/web/components/chat-history.test.tsx
git commit -m "feat(web): history drawer (relative-time, sheet, ChatHistory)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Wire the drawer + conversation state into Chat

**Files:**
- Modify: `apps/web/components/chat.tsx`
- Test: `apps/web/components/chat.test.tsx` (modify)

**Interfaces:**
- Consumes: `ChatHistory` and the `Sheet*` primitives (Task 5); `GET /api/conversations/[id]` (Task 4); the chat route's `x-conversation-id` response header (existing); the existing `Turn`/`Citation` types and `Transcript`.
- Produces: a `Chat` that tracks `conversationId`, sends it on each message, captures it from the response, opens the History drawer, resumes a thread, and starts a new chat.

- [ ] **Step 1: Write the failing test**

In `apps/web/components/chat.test.tsx`, add a Clerk mock at the top (just below the existing imports) and a new describe block. The existing `Transcript`/`safeHref` tests are unaffected by the mock.

Add after the existing `import { Transcript, safeHref } from "./chat.js";` line:

```tsx
import { vi, beforeEach, afterEach } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: null }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { Chat } from "./chat.js";

function streamRes(text: string, headers: Record<string, string>) {
  const body = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); },
  });
  return { ok: true, status: 200, headers: new Headers(headers), body } as unknown as Response;
}
```

(`describe`, `it`, `expect`, `render`, `screen` are already imported at the top of the file.)

Then add this describe block at the end of the file:

```tsx
describe("Chat conversation id", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("captures x-conversation-id and sends it on the next message", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(streamRes("hi", { "x-conversation-id": "conv_1", "x-citations": "" }))
      .mockResolvedValueOnce(streamRes("ok", { "x-conversation-id": "conv_1", "x-citations": "" }));
    vi.stubGlobal("fetch", fetchMock);

    render(<Chat kbId="kb_1" />);
    const input = screen.getByPlaceholderText("Ask your library…");

    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ kbId: "kb_1", message: "first" });
    await screen.findByText("hi");

    fireEvent.change(input, { target: { value: "second" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ kbId: "kb_1", conversationId: "conv_1", message: "second" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @gr/web exec vitest run components/chat.test.tsx`
Expected: FAIL — the second request omits `conversationId` (current `send` always posts `{ kbId, message }`).

- [ ] **Step 3: Update the Chat component**

In `apps/web/components/chat.tsx`:

1. Extend the imports — change the `react` import and add the new ones below the existing `remark-gfm` import:

```tsx
import { useState, type FormEvent } from "react";
import { useUser } from "@clerk/nextjs";
import { User, History, Plus } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetTrigger, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ChatHistory } from "@/components/chat-history";
```

(Keep the existing `Card`, `Input`, `Button`, `Badge`, `cn`, `DogAvatar`, `ReactMarkdown`, `remarkGfm` imports. The `User` import becomes `User, History, Plus`.)

2. Replace the whole `Chat` function (from `export function Chat({ kbId }: { kbId: string }) {` to its closing brace) with:

```tsx
export function Chat({ kbId }: { kbId: string }) {
  const [messages, setMessages] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { user } = useUser();

  function newChat() {
    setMessages([]);
    setConversationId(null);
    setHistoryOpen(false);
  }

  async function selectConversation(id: string) {
    setHistoryOpen(false);
    try {
      const res = await fetch(`/api/conversations/${id}`);
      if (!res.ok) throw new Error();
      const detail = await res.json() as {
        id: string;
        messages: { id: string; role: string; content: string; citations: unknown }[];
      };
      setMessages(detail.messages.map((m) => ({
        id: m.id, role: m.role, content: m.content,
        citations: Array.isArray(m.citations)
          ? (m.citations as { title: string | null; sourceUrl: string | null }[])
              .map((c) => ({ title: c.title, sourceUrl: c.sourceUrl }))
          : undefined,
      })));
      setConversationId(id);
    } catch {
      toast.error("Couldn't open that conversation");
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    const userTurn: Turn = { id: crypto.randomUUID(), role: "user", content: message };
    const assistantId = crypto.randomUUID();
    setMessages((m) => [...m, userTurn, { id: assistantId, role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    const setAssistant = (patch: Partial<Turn>) =>
      setMessages((m) => m.map((t) => (t.id === assistantId ? { ...t, ...patch } : t)));
    const ERR = "⚠️ The AI couldn't generate a response right now — it may be rate-limited (the free AI tier limits requests). Please try again in a moment.";
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(conversationId ? { kbId, conversationId, message } : { kbId, message }),
      });
      if (!res.ok) { setAssistant({ content: ERR }); return; }
      const newConvId = res.headers.get("x-conversation-id");
      if (newConvId && !conversationId) setConversationId(newConvId);
      const { parseCitations, citedOnly } = await import("../lib/citations.js");
      const allCitations = parseCitations(res.headers.get("x-citations"))
        .map((c) => ({ title: c.title, sourceUrl: c.sourceUrl }));
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setAssistant({ content: acc });
      }
      if (!acc.trim()) { setAssistant({ content: ERR }); return; }
      setAssistant({ citations: citedOnly(acc, allCitations) });
    } catch {
      setAssistant({ content: "⚠️ Network error — please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
            <SheetTrigger render={<Button variant="outline" size="sm"><History className="size-4" /> History</Button>} />
            <SheetContent side="left">
              <SheetTitle>Conversations</SheetTitle>
              <ChatHistory
                open={historyOpen}
                activeId={conversationId}
                onSelect={selectConversation}
                onNew={newChat}
                onDeletedActive={newChat}
              />
            </SheetContent>
          </Sheet>
          <Button variant="ghost" size="sm" onClick={newChat}><Plus className="size-4" /> New chat</Button>
        </div>
        <Transcript messages={messages} userAvatarUrl={user?.imageUrl ?? undefined} />
        <form onSubmit={send} className="flex gap-2">
          <Input className="flex-1" value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your library…" />
          <Button type="submit" disabled={busy}>Ask</Button>
        </form>
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: Run the component tests to verify they pass**

Run: `pnpm --filter @gr/web exec vitest run components/chat.test.tsx`
Expected: PASS — existing Transcript/safeHref/markdown tests plus the new conversation-id test.

- [ ] **Step 5: Typecheck + full suite**

Run: `pnpm --filter @gr/web typecheck && bash scripts/test.sh`
Expected: typecheck clean; entire node + component suite green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/chat.tsx apps/web/components/chat.test.tsx
git commit -m "feat(web): chat history drawer + resume/new-chat in Chat

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Plan Self-Review

**Spec coverage:**
- Slide-over drawer → Task 5 (Sheet + ChatHistory) + Task 6 (wiring). ✓
- LLM titles → Task 2 (titleConversation) + Task 3 (route sets it on new conversations; snippet fallback). ✓
- `listConversations` ordered by last activity + counts → Task 1. ✓
- `getConversationForUser` / `deleteConversation` ownership (404, no leak) → Task 1 + Task 4. ✓
- Endpoints (GET list, GET detail, DELETE) → Task 4. ✓
- Resume loads transcript; new chat clears; send `conversationId`; capture `x-conversation-id` → Task 6. ✓
- Errors: delete active → reset (`onDeletedActive`/`newChat`); null title → "Untitled chat"; network → toast → Tasks 5 & 6. ✓
- Does NOT change what the model sees → confirmed; no prior-turn context added anywhere. ✓
- Testing across all three runners → each task's tests placed for its runner. ✓

**Placeholder scan:** No TBD/TODO/"handle errors"/"similar to" — every code step is complete. ✓

**Type consistency:** `ConversationSummary`/`ConversationDetail` defined in Task 1 (server, `lastActivityAt: Date`); the client mirror in Task 5 uses `lastActivityAt: string` (JSON-serialized) — intentional and noted. `titleConversation(firstMessage)` signature is identical in the `AiClient` interface (Task 2), `ChatDeps` (Task 3), and its call sites. `ChatHistory` prop names match between its definition (Task 5) and its use in `Chat` (Task 6). Endpoint shapes (`{ conversations }`, `ConversationDetail`, `{ ok: true }`) match between Task 4 and the consumers in Tasks 5–6. ✓
