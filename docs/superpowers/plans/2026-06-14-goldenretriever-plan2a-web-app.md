# GoldenRetriever Plan 2a — Web App (thin usable slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user can see their library, add content (paste text or submit a URL), and chat with their knowledge base — getting streamed, grounded answers with citations.

**Architecture:** Builds on the Stage 0 backend (`@gr/*` packages, merged to `main`). Adds Clerk auth (dev keys, local-first), shadcn/ui + Tailwind, a `resolveAuth` seam that accepts **either** a Clerk session (web UI) **or** an API token (headless), a streaming `/api/chat` route (AI SDK `streamText` + `HybridRetriever`, with an injectable deps seam for tests), and the App-Router UI shell (library + chat). Conversations/messages/citations are persisted.

**Tech Stack:** Next.js App Router, `@clerk/nextjs` v6, Tailwind + shadcn/ui, AI SDK v6 (`ai`, `@ai-sdk/react` `useChat`), Drizzle, the existing `@gr/db` / `@gr/ai` / `@gr/retrieval` packages. Tests: Vitest (route + DB integration via the existing pgvector container; Clerk session path covered by the API-token path in unit tests and by e2e later).

**Scope (Plan 2a of the web app):**
- IN: Clerk auth shell, personal-KB bootstrap, library list, add-content (paste text / submit URL), streaming RAG chat with citations + persistence, honest-refusal path.
- OUT (→ Plan 2b): dedicated search page, import flow (Pocket/Readwise/bookmarks), **file upload of binary docs** (needs Blob + the deployed markitdown service), settings/API-token management UI, delete/takedown UI, Playwright e2e, Vercel Blob/Queues wiring, deployment.

**Prereq:** A Clerk dev instance. Set in `apps/web/.env.local`: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, plus the existing `DATABASE_URL`, `AI_GATEWAY_API_KEY`. Tests do **not** need Clerk keys (they use the API-token auth path).

---

## File Structure

```
apps/web/
├─ middleware.ts                       Clerk middleware
├─ components.json                     shadcn config
├─ tailwind.config.ts · postcss.config.mjs
├─ app/
│  ├─ globals.css                      Tailwind layers
│  ├─ layout.tsx                       <ClerkProvider> + root html
│  ├─ (auth)/sign-in/[[...sign-in]]/page.tsx
│  ├─ (auth)/sign-up/[[...sign-up]]/page.tsx
│  └─ (app)/
│     ├─ layout.tsx                    authed shell (nav + UserButton)
│     ├─ page.tsx                      library (server component)
│     └─ chat/page.tsx                 chat (client)
├─ app/api/chat/route.ts               streaming RAG
├─ lib/
│  ├─ clerk-auth.ts                    resolveAuth (Clerk session OR API token) + ensureUser
│  └─ chat-service.ts                  resolveChatDeps / __setChatDeps (DI seam)
├─ components/
│  ├─ ui/*                             shadcn primitives (button, card, input, textarea, scroll-area)
│  ├─ add-content.tsx                  paste text / submit URL form
│  ├─ library-list.tsx                 document list + status
│  ├─ chat.tsx                         useChat transcript + citations
│  └─ library-list.test.tsx · chat.test.tsx
└─ test/ chat-route.test.ts · ingest-route-session.test.ts

packages/db/src/queries.ts             + upsertUser, getOrCreatePersonalKb, listDocuments,
                                         createConversation, appendMessage, getMessages
packages/retrieval/src/index.ts        + Retriever interface
```

Tests run with the existing runner: `pnpm test <path>` (boots the pgvector DB, applies schema).

---

## Task 1: Tailwind + shadcn/ui setup

**Files:** Create `apps/web/components.json`, `apps/web/tailwind.config.ts`, `apps/web/postcss.config.mjs`, `apps/web/app/globals.css`; add deps.

- [ ] **Step 1: Add dependencies**

Run:
```bash
pnpm --filter @gr/web add tailwindcss @tailwindcss/postcss clsx tailwind-merge class-variance-authority lucide-react tailwindcss-animate
```

- [ ] **Step 2: Create `apps/web/postcss.config.mjs`**

```js
const config = { plugins: { "@tailwindcss/postcss": {} } };
export default config;
```

- [ ] **Step 3: Create `apps/web/app/globals.css`**

```css
@import "tailwindcss";

:root { --background: #ffffff; --foreground: #0a0a0a; }
body { background: var(--background); color: var(--foreground); }
```

- [ ] **Step 4: Initialize shadcn and add primitives**

Run from `apps/web`:
```bash
cd apps/web && pnpm dlx shadcn@latest init -d -b neutral
pnpm dlx shadcn@latest add button card input textarea scroll-area
```
> `init -d` accepts defaults (Next.js + Tailwind, components in `components/ui`, alias `@/components`). If it prompts for a base color, neutral is set via `-b`. Verify `components.json` and `components/ui/button.tsx` exist afterward.

- [ ] **Step 5: Verify the app builds**

Run: `pnpm --filter @gr/web typecheck`
Expected: exit 0. (No automated render test for pure scaffolding.)

- [ ] **Step 6: Commit**

```bash
git add apps/web && git commit -m "chore(web): tailwind + shadcn/ui setup"
```

---

## Task 2: Clerk auth wiring

**Files:** Create `apps/web/middleware.ts`, `apps/web/app/layout.tsx`, `apps/web/app/(auth)/sign-in/[[...sign-in]]/page.tsx`, `apps/web/app/(auth)/sign-up/[[...sign-up]]/page.tsx`; add `@clerk/nextjs`.

- [ ] **Step 1: Add Clerk**

Run: `pnpm --filter @gr/web add @clerk/nextjs`

- [ ] **Step 2: Create `apps/web/middleware.ts`**

```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Public: auth pages and the token-authenticated ingest/worker endpoints.
const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/api/ingest", "/api/worker"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|svg|ico)).*)", "/(api|trpc)(.*)"],
};
```

- [ ] **Step 3: Create `apps/web/app/layout.tsx`**

```tsx
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata = { title: "GoldenRetriever" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en"><body>{children}</body></html>
    </ClerkProvider>
  );
}
```

- [ ] **Step 4: Create the sign-in / sign-up pages**

`apps/web/app/(auth)/sign-in/[[...sign-in]]/page.tsx`:
```tsx
import { SignIn } from "@clerk/nextjs";
export default function Page() {
  return <main className="flex min-h-screen items-center justify-center"><SignIn /></main>;
}
```
`apps/web/app/(auth)/sign-up/[[...sign-up]]/page.tsx`:
```tsx
import { SignUp } from "@clerk/nextjs";
export default function Page() {
  return <main className="flex min-h-screen items-center justify-center"><SignUp /></main>;
}
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @gr/web typecheck`
Expected: exit 0. (Sign-in render is verified manually / in e2e later.)

- [ ] **Step 6: Commit**

```bash
git add apps/web && git commit -m "feat(web): Clerk middleware, provider, sign-in/up pages"
```

---

## Task 3: DB helpers — users, personal KB, library list

**Files:** Modify `packages/db/src/queries.ts`; create `packages/db/src/queries.ui.test.ts`.

- [ ] **Step 1: Write the failing test** `packages/db/src/queries.ui.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb } from "./client.js";
import { upsertUser, getOrCreatePersonalKb, listDocuments, insertDocument } from "./queries.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
afterAll(async () => { await sql.end(); });

describe("ui query helpers", () => {
  it("upsertUser is idempotent and updates email", async () => {
    await upsertUser(db, { id: "u_ui", email: "a@a.dev" });
    await upsertUser(db, { id: "u_ui", email: "b@b.dev", name: "B" });
    const kb = await getOrCreatePersonalKb(db, "u_ui");
    expect(kb).toMatch(/^kb_/);
  });

  it("getOrCreatePersonalKb returns the same kb on repeat calls", async () => {
    const a = await getOrCreatePersonalKb(db, "u_ui");
    const b = await getOrCreatePersonalKb(db, "u_ui");
    expect(a).toBe(b);
  });

  it("listDocuments returns kb docs newest-first", async () => {
    const kbId = await getOrCreatePersonalKb(db, "u_ui");
    await insertDocument(db, { kbId, addedBy: "u_ui", kind: "text", captureMode: "selection", sourceUrl: null, title: "Doc A" });
    const docs = await listDocuments(db, kbId);
    expect(docs.length).toBeGreaterThan(0);
    expect(docs[0]).toHaveProperty("title");
    expect(docs[0]).toHaveProperty("status");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (missing exports):
  `DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test AI_GATEWAY_API_KEY=test pnpm vitest run packages/db/src/queries.ui.test.ts`

- [ ] **Step 3: Add to `packages/db/src/queries.ts`** (append; `documents`, `knowledgeBases`, `kbMembers` are already imported, add `desc` to the drizzle import and `eq` is present):

At the top, ensure the import includes `desc`:
```ts
import { and, eq, desc } from "drizzle-orm";
```
Append:
```ts
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
    kind: documents.kind, status: documents.status, capturedAt: documents.capturedAt,
  }).from(documents).where(eq(documents.kbId, kbId)).orderBy(desc(documents.createdAt)).limit(limit);
}
```
> `getOrCreatePersonalKb` reuses `createKnowledgeBase` (already inserts the owner `kb_members` row), so personal KBs get their membership for free — which is what the ingest/chat authorization checks rely on.

- [ ] **Step 4: Run — expect PASS (3).** **Step 5: Typecheck** `pnpm --filter @gr/db typecheck`. **Step 6: Commit** `feat(db): user upsert, personal-kb bootstrap, document listing`.

---

## Task 4: DB helpers — conversations & messages

**Files:** Modify `packages/db/src/queries.ts`; create `packages/db/src/queries.chat.test.ts`.

- [ ] **Step 1: Write the failing test** `packages/db/src/queries.chat.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb } from "./client.js";
import { createUser, createKnowledgeBase, createConversation, appendMessage, getMessages } from "./queries.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, userId: string;
beforeAll(async () => {
  userId = await createUser(db, { id: "u_chat", email: "c@c.dev" });
  kbId = await createKnowledgeBase(db, { ownerId: userId, name: "Chat" });
});
afterAll(async () => { await sql.end(); });

describe("conversation helpers", () => {
  it("persists user + assistant messages in order with citations", async () => {
    const convId = await createConversation(db, { kbId, userId });
    await appendMessage(db, { conversationId: convId, role: "user", content: "where to stay?" });
    await appendMessage(db, {
      conversationId: convId, role: "assistant", content: "Tawaraya [1].",
      citations: [{ chunkId: "c1", documentId: "d1", title: "Kyoto" }], tokens: 12,
    });
    const msgs = await getMessages(db, convId);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect((msgs[1].citations as unknown[]).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Append to `packages/db/src/queries.ts`** (add `conversations, messages` to the schema import line):
```ts
import { users, knowledgeBases, kbMembers, documents, chunks, conversations, messages } from "./schema.js";
```
```ts
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
```

- [ ] **Step 4: Run — expect PASS (1).** **Step 5: Typecheck.** **Step 6: Commit** `feat(db): conversation + message persistence helpers`.

---

## Task 5: `Retriever` interface in `@gr/retrieval`

**Files:** Modify `packages/retrieval/src/index.ts`, `packages/retrieval/src/hybrid.ts`.

- [ ] **Step 1: Add the interface and implement it.** In `packages/retrieval/src/index.ts`, append:
```ts
import type { RankedChunk } from "@gr/core";
export interface Retriever { retrieve(kbId: string, query: string): Promise<RankedChunk[]>; }
```
In `packages/retrieval/src/hybrid.ts`, change the class declaration to implement it and import the type:
```ts
import type { Retriever } from "./index.js";
// ...
export class HybridRetriever implements Retriever {
```
> `retrieve(kbId, query): Promise<RankedChunk[]>` already matches the interface, so no body changes.

- [ ] **Step 2: Typecheck** `pnpm --filter @gr/retrieval typecheck` → exit 0. (`hybrid.test.ts` still passes.) Run it to confirm:
  `DATABASE_URL=… AI_GATEWAY_API_KEY=test pnpm vitest run packages/retrieval`
- [ ] **Step 3: Commit** `feat(retrieval): extract Retriever interface (Graph seam)`.

---

## Task 6: `resolveAuth` (Clerk session OR API token)

**Files:** Create `apps/web/lib/clerk-auth.ts`, `apps/web/test/resolve-auth.test.ts`.

- [ ] **Step 1: Write the failing test** (covers the API-token path; the Clerk-session path is exercised by e2e later):

`apps/web/test/resolve-auth.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createDb, schema } from "@gr/db";
import { createUser } from "@gr/db/queries";
import { hashToken } from "../lib/auth.js";
import { resolveAuth } from "../lib/clerk-auth.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
beforeAll(async () => {
  const uid = await createUser(db, { id: "u_resolve", email: "r@r.dev" });
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId: uid, name: "t", tokenHash: hashToken("grt_resolve"),
  });
});
afterAll(async () => { await sql.end(); });

const reqWith = (token?: string) => new Request("http://localhost/api/chat", {
  method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {},
});

describe("resolveAuth (API-token path)", () => {
  it("resolves a userId for a valid token", async () => {
    expect((await resolveAuth(db, reqWith("grt_resolve")))?.userId).toBe("u_resolve");
  });
  it("returns null for a bad token and no session", async () => {
    expect(await resolveAuth(db, reqWith("nope"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `apps/web/lib/clerk-auth.ts`:**
```ts
import { auth, currentUser } from "@clerk/nextjs/server";
import type { drizzle } from "drizzle-orm/postgres-js";
import { upsertUser } from "@gr/db/queries";
import { verifyApiToken } from "./auth.js";

type Db = ReturnType<typeof drizzle>;
export interface Principal { userId: string; }

export async function resolveAuth(db: Db, req: Request): Promise<Principal | null> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (bearer) {
    const tok = await verifyApiToken(db, bearer);
    return tok ? { userId: tok.userId } : null;
  }
  // Clerk session (web UI). Ensure the local user row exists; production uses a Clerk webhook.
  const { userId } = await auth();
  if (!userId) return null;
  const u = await currentUser();
  await upsertUser(db, {
    id: userId,
    email: u?.primaryEmailAddress?.emailAddress ?? `${userId}@clerk.local`,
    name: u?.fullName ?? undefined,
    imageUrl: u?.imageUrl,
  });
  return { userId };
}
```
> When a Bearer token is present we never call Clerk's `auth()`, so this function is fully testable without Clerk context.

- [ ] **Step 4: Run — expect PASS (2).** **Step 5: Typecheck** `pnpm --filter @gr/web typecheck`. **Step 6: Commit** `feat(web): resolveAuth — Clerk session or API token`.

---

## Task 7: Accept Clerk sessions on `/api/ingest`

**Files:** Modify `apps/web/app/api/ingest/route.ts`; create `apps/web/test/ingest-route-session.test.ts`.

The web "add content" form posts with a Clerk session (cookie), not a Bearer token. Swap the route's `verifyApiToken` call for `resolveAuth` so both work. The existing token-based tests still pass (the token path is unchanged).

- [ ] **Step 1: Write the failing test** asserting the token path still authorizes through `resolveAuth` end-to-end:

`apps/web/test/ingest-route-session.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser, getOrCreatePersonalKb } from "@gr/db/queries";
import { createMockAiClient } from "@gr/ai/mock";
import { MockConverter } from "@gr/ingest";
import { hashToken } from "../lib/auth.js";
import { __setIngestDeps } from "../lib/ingest-service.js";
import { POST } from "../app/api/ingest/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, token: string;
beforeAll(async () => {
  const uid = await createUser(db, { id: "u_sess", email: "s@s.dev" });
  kbId = await getOrCreatePersonalKb(db, uid);  // creates kb + owner membership
  token = "grt_sess";
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId: uid, name: "t", tokenHash: hashToken(token),
  });
  __setIngestDeps({ ai: createMockAiClient(), converter: new MockConverter() });
});
afterAll(async () => { __setIngestDeps(null); await sql.end(); });

it("ingests for a token-authenticated member of their personal kb", async () => {
  delete process.env.APP_URL;
  const res = await POST(new NextRequest("http://localhost/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ kbId, text: "Hiiragiya is a classic Kyoto ryokan." }),
  }));
  expect(res.status).toBe(202);
});
```

- [ ] **Step 2: Run — expect it to PASS already if the route used resolveAuth, FAIL otherwise.** Then make the change in **Step 3.**

- [ ] **Step 3: Edit `apps/web/app/api/ingest/route.ts`:** replace the import and the auth line.
  - Replace `import { verifyApiToken } from "../../../lib/auth.js";` with `import { resolveAuth } from "../../../lib/clerk-auth.js";`
  - Replace:
    ```ts
    const auth = await verifyApiToken(db, req.headers.get("authorization")?.replace(/^Bearer /, ""));
    if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    ```
    with:
    ```ts
    const principal = await resolveAuth(db, req);
    if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    ```
  - Replace the two later uses of `auth.userId` with `principal.userId`.

- [ ] **Step 4: Run the new test AND the existing ingest tests** (token path must still 401/400/403/202):
  `DATABASE_URL=… AI_GATEWAY_API_KEY=test pnpm vitest run apps/web/test/ingest-route.test.ts apps/web/test/ingest-route-session.test.ts apps/web/test/ingest-route-happy.test.ts`
  Expected: all pass. **Step 5: Typecheck. Step 6: Commit** `feat(web): /api/ingest accepts Clerk session or API token`.

---

## Task 8: `/api/chat` streaming RAG route

**Files:** Create `apps/web/lib/chat-service.ts`, `apps/web/app/api/chat/route.ts`, `apps/web/test/chat-route.test.ts`.

- [ ] **Step 1: Create the deps seam `apps/web/lib/chat-service.ts`:**
```ts
import type { LanguageModel } from "ai";
import type { drizzle } from "drizzle-orm/postgres-js";
import { HybridRetriever, type Retriever } from "@gr/retrieval";
import { createAiClient } from "@gr/ai";
import { env } from "@gr/config";

type Db = ReturnType<typeof drizzle>;
export interface ChatDeps { retriever: Retriever; model: LanguageModel; }
let override: ChatDeps | null = null;
export function __setChatDeps(d: ChatDeps | null) { override = d; }
export function resolveChatDeps(db: Db): ChatDeps {
  return override ?? { retriever: new HybridRetriever(db, createAiClient()), model: env.GR_GENERATION_MODEL };
}

export const REFUSAL = "I don't have anything saved about that.";
export function groundedPrompt(question: string, contexts: string[]): string {
  const numbered = contexts.map((c, i) => `[${i + 1}] ${c}`).join("\n\n");
  return `Answer the question using ONLY the numbered sources. Cite sources inline like [1].\n` +
    `If the sources do not contain the answer, say "${REFUSAL}"\n\nSources:\n${numbered}\n\nQuestion: ${question}`;
}
```

- [ ] **Step 2: Write the failing test `apps/web/test/chat-route.test.ts`:**
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { MockLanguageModelV2 } from "ai/test";
import { simulateReadableStream } from "ai";
import { createDb, schema } from "@gr/db";
import { createUser, getOrCreatePersonalKb, getMessages } from "@gr/db/queries";
import type { RankedChunk } from "@gr/core";
import type { Retriever } from "@gr/retrieval";
import { hashToken } from "../lib/auth.js";
import { __setChatDeps } from "../lib/chat-service.js";
import { POST } from "../app/api/chat/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, token: string;

// A model that streams a fixed answer (shape must match installed AI SDK v6 `ai/test`).
const modelSaying = (text: string) => new MockLanguageModelV2({
  doStream: async () => ({
    stream: simulateReadableStream({
      chunks: [
        { type: "text-delta", id: "1", delta: text },
        { type: "finish", finishReason: "stop", usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 } },
      ],
    }),
  }),
});
const retrieverReturning = (chunks: RankedChunk[]): Retriever => ({ retrieve: async () => chunks });
const chunk = (content: string): RankedChunk => ({
  chunkId: "c1", documentId: "d1", content, score: 1,
  document: { title: "Kyoto", sourceUrl: null, addedBy: "u_chat_r", capturedAt: new Date() },
});

const post = (body: unknown) => POST(new NextRequest("http://localhost/api/chat", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
}));

beforeAll(async () => {
  const uid = await createUser(db, { id: "u_chat_r", email: "cr@cr.dev" });
  kbId = await getOrCreatePersonalKb(db, uid);
  token = "grt_chat";
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId: uid, name: "t", tokenHash: hashToken(token),
  });
});
afterAll(async () => { __setChatDeps(null); await sql.end(); });

describe("POST /api/chat", () => {
  it("streams a grounded answer and persists the exchange", async () => {
    __setChatDeps({ retriever: retrieverReturning([chunk("Tawaraya is a ryokan in Kyoto.")]), model: modelSaying("Stay at Tawaraya [1].") });
    const res = await post({ kbId, message: "where to stay in Kyoto?" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Tawaraya");
    const convId = res.headers.get("x-conversation-id");
    expect(convId).toBeTruthy();
    const msgs = await getMessages(db, convId!);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("refuses honestly when nothing relevant is retrieved", async () => {
    __setChatDeps({ retriever: retrieverReturning([]), model: modelSaying("(should not be used)") });
    const res = await post({ kbId, message: "unrelated question" });
    expect(await res.text()).toContain("don't have anything saved");
  });

  it("401 without auth", async () => {
    const res = await POST(new NextRequest("http://localhost/api/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kbId, message: "hi" }),
    }));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Run — expect FAIL** (no route).

- [ ] **Step 4: Implement `apps/web/app/api/chat/route.ts`:**
```ts
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { streamText } from "ai";
import { createDb, schema } from "@gr/db";
import { createConversation, appendMessage } from "@gr/db/queries";
import { resolveAuth } from "../../../lib/clerk-auth.js";
import { resolveChatDeps, groundedPrompt, REFUSAL } from "../../../lib/chat-service.js";

export async function POST(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { kbId, conversationId, message } = await req.json() as
    { kbId: string; conversationId?: string; message: string };
  if (!kbId || !message) return NextResponse.json({ error: "kbId and message required" }, { status: 400 });

  const membership = await db.select().from(schema.kbMembers)
    .where(and(eq(schema.kbMembers.kbId, kbId), eq(schema.kbMembers.userId, principal.userId)));
  if (!membership[0]) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const convId = conversationId ?? await createConversation(db, { kbId, userId: principal.userId });
  await appendMessage(db, { conversationId: convId, role: "user", content: message });

  const { retriever, model } = resolveChatDeps(db);
  const hits = await retriever.retrieve(kbId, message);

  if (hits.length === 0) {
    await appendMessage(db, { conversationId: convId, role: "assistant", content: REFUSAL, citations: [] });
    return new Response(REFUSAL, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "x-conversation-id": convId } });
  }

  const citations = hits.map((h) => ({
    chunkId: h.chunkId, documentId: h.documentId, title: h.document.title, sourceUrl: h.document.sourceUrl,
  }));
  const result = streamText({
    model,
    prompt: groundedPrompt(message, hits.map((h) => h.content)),
    onFinish: async ({ text, usage }) => {
      await appendMessage(db, {
        conversationId: convId, role: "assistant", content: text, citations, tokens: usage?.totalTokens,
      });
    },
  });
  return result.toTextStreamResponse({ headers: { "x-conversation-id": convId } });
}
```
> **Version note:** the `simulateReadableStream` chunk shape and `MockLanguageModelV2` import path (`ai/test`) are AI SDK v6 specifics — if the test errors on the chunk type, align the `{ type: "text-delta", … }` parts with the installed `ai/test` types (e.g. `textDelta` vs `delta`). The route code itself uses only the stable `streamText` + `toTextStreamResponse` API.

- [ ] **Step 5: Run — expect PASS (3).** **Step 6: Typecheck. Step 7: Commit** `feat(web): streaming RAG /api/chat with citations + honest refusal`.

---

## Task 9: App shell + library page

**Files:** Create `apps/web/app/(app)/layout.tsx`, `apps/web/app/(app)/page.tsx`, `apps/web/components/library-list.tsx`, `apps/web/components/library-list.test.tsx`.

- [ ] **Step 1: Write the failing component test** `apps/web/components/library-list.test.tsx` (Vitest + Testing Library; add deps in Step 2):
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LibraryList } from "./library-list.js";

describe("LibraryList", () => {
  it("renders titles and a status badge, with an empty state", () => {
    const { rerender } = render(<LibraryList docs={[]} />);
    expect(screen.getByText(/nothing saved yet/i)).toBeTruthy();
    rerender(<LibraryList docs={[{ id: "d1", title: "Kyoto ryokans", sourceUrl: null, kind: "text", status: "ready", capturedAt: new Date() }]} />);
    expect(screen.getByText("Kyoto ryokans")).toBeTruthy();
    expect(screen.getByText(/ready/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Add test deps + jsdom env**

Run: `pnpm --filter @gr/web add -D @testing-library/react @testing-library/jest-dom jsdom`
Add `apps/web/vitest.config.ts` so component tests use jsdom while node tests stay node:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "jsdom", include: ["components/**/*.test.tsx"], globals: true },
});
```
> The root `vitest.config.ts` already runs `apps/**/*.test.ts` in node; this app-local config adds a jsdom project for `.test.tsx`. Run component tests with `pnpm --filter @gr/web exec vitest run`.

- [ ] **Step 3: Implement `apps/web/components/library-list.tsx`:**
```tsx
export interface LibraryDoc {
  id: string; title: string | null; sourceUrl: string | null;
  kind: string; status: string; capturedAt: Date;
}

export function LibraryList({ docs }: { docs: LibraryDoc[] }) {
  if (docs.length === 0) {
    return <p className="text-neutral-500">Nothing saved yet — add a page to get started.</p>;
  }
  return (
    <ul className="divide-y divide-neutral-200">
      {docs.map((d) => (
        <li key={d.id} className="flex items-center justify-between py-3">
          <span className="font-medium">{d.title ?? d.sourceUrl ?? "Untitled"}</span>
          <span className="text-xs uppercase text-neutral-500">{d.status}</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run the component test** (`pnpm --filter @gr/web exec vitest run components/library-list.test.tsx`) → PASS.

- [ ] **Step 5: Implement the authed shell + library page (server component).**

`apps/web/app/(app)/layout.tsx`:
```tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4">
      <header className="flex items-center justify-between py-4">
        <nav className="flex gap-4">
          <Link href="/" className="font-semibold">Library</Link>
          <Link href="/chat" className="text-neutral-600">Chat</Link>
        </nav>
        <UserButton />
      </header>
      <main className="py-4">{children}</main>
    </div>
  );
}
```
`apps/web/app/(app)/page.tsx`:
```tsx
import { auth } from "@clerk/nextjs/server";
import { createDb } from "@gr/db";
import { upsertUser, getOrCreatePersonalKb, listDocuments } from "@gr/db/queries";
import { currentUser } from "@clerk/nextjs/server";
import { LibraryList } from "../../components/library-list.js";
import { AddContent } from "../../components/add-content.js";

export default async function LibraryPage() {
  const { userId } = await auth();
  if (!userId) return null; // middleware protects this route
  const { db } = createDb();
  const u = await currentUser();
  await upsertUser(db, { id: userId, email: u?.primaryEmailAddress?.emailAddress ?? `${userId}@clerk.local`, name: u?.fullName ?? undefined, imageUrl: u?.imageUrl });
  const kbId = await getOrCreatePersonalKb(db, userId);
  const docs = await listDocuments(db, kbId);
  return (
    <div className="space-y-6">
      <AddContent kbId={kbId} />
      <LibraryList docs={docs} />
    </div>
  );
}
```

- [ ] **Step 6: Typecheck** (`AddContent` lands in Task 10 — implement Task 10 before final typecheck, or stub the import). **Commit after Task 10.**

---

## Task 10: Add-content form (paste text / submit URL)

**Files:** Create `apps/web/components/add-content.tsx`.

- [ ] **Step 1: Implement `apps/web/components/add-content.tsx`** (client component posting to `/api/ingest` with the Clerk session cookie — no token needed in-browser):
```tsx
"use client";
import { useState } from "react";

export function AddContent({ kbId }: { kbId: string }) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(body: Record<string, unknown>) {
    setBusy(true);
    await fetch("/api/ingest", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kbId, ...body }),
    });
    setBusy(false);
    setText(""); setUrl("");
    location.reload(); // simple refresh for 2a; SWR/router.refresh() in 2b
  }

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 p-4">
      <textarea className="w-full rounded border p-2" rows={3} placeholder="Paste text to save…"
        value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex gap-2">
        <button disabled={busy || !text.trim()} onClick={() => submit({ text })}
          className="rounded bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-50">Save text</button>
      </div>
      <div className="flex gap-2">
        <input className="flex-1 rounded border p-2" placeholder="https://… (saves the page)"
          value={url} onChange={(e) => setUrl(e.target.value)} />
        <button disabled={busy || !url.trim()} onClick={() => submit({ url })}
          className="rounded border px-3 py-1.5 disabled:opacity-50">Save URL</button>
      </div>
    </div>
  );
}
```
> URL ingest stores the link; server-side fetch+parse of the URL's content is wired in Plan 2b (it currently records the document with `mimeType: null`). File upload of PDFs is Plan 2b (needs Blob + the deployed markitdown service).

- [ ] **Step 2: Typecheck** `pnpm --filter @gr/web typecheck` → exit 0 (resolves the Task 9 import). **Step 3: Commit** `feat(web): library page, app shell, add-content form`.

---

## Task 11: Chat UI

**Files:** Create `apps/web/app/(app)/chat/page.tsx`, `apps/web/components/chat.tsx`, `apps/web/components/chat.test.tsx`; add `@ai-sdk/react`.

- [ ] **Step 1: Add the React AI hook**

Run: `pnpm --filter @gr/web add @ai-sdk/react`

- [ ] **Step 2: Write the failing component test `apps/web/components/chat.test.tsx`** (renders a transcript + a citation chip from props; the live streaming hook is covered by the route test + e2e later):
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Transcript } from "./chat.js";

describe("Transcript", () => {
  it("renders user and assistant turns with a citation chip", () => {
    render(<Transcript messages={[
      { id: "1", role: "user", content: "where to stay?" },
      { id: "2", role: "assistant", content: "Tawaraya [1].", citations: [{ title: "Kyoto", sourceUrl: "https://x" }] },
    ]} />);
    expect(screen.getByText("where to stay?")).toBeTruthy();
    expect(screen.getByText(/Tawaraya/)).toBeTruthy();
    expect(screen.getByText("Kyoto")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Implement `apps/web/components/chat.tsx`** — a presentational `Transcript` (tested) plus the `Chat` client wrapper using `useChat`:
```tsx
"use client";
import { useChat } from "@ai-sdk/react";

export interface Citation { title: string | null; sourceUrl: string | null; }
export interface Turn { id: string; role: string; content: string; citations?: Citation[]; }

export function Transcript({ messages }: { messages: Turn[] }) {
  return (
    <div className="space-y-4">
      {messages.map((m) => (
        <div key={m.id} className={m.role === "user" ? "text-right" : "text-left"}>
          <p className="inline-block rounded-lg bg-neutral-100 px-3 py-2">{m.content}</p>
          {m.citations?.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {m.citations.map((c, i) => (
                <a key={i} href={c.sourceUrl ?? "#"} className="rounded bg-amber-100 px-2 py-0.5 text-xs">{c.title ?? "source"}</a>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function Chat({ kbId }: { kbId: string }) {
  const { messages, input, handleInputChange, handleSubmit } = useChat({
    api: "/api/chat", body: { kbId }, streamProtocol: "text",
  });
  return (
    <div className="space-y-4">
      <Transcript messages={messages as Turn[]} />
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input className="flex-1 rounded border p-2" value={input} onChange={handleInputChange} placeholder="Ask your library…" />
        <button className="rounded bg-neutral-900 px-3 py-1.5 text-white">Ask</button>
      </form>
    </div>
  );
}
```
> **Version note:** `useChat`'s option names (`api`, `streamProtocol: "text"`, `body`) are AI SDK v6 React-binding specifics — verify against the installed `@ai-sdk/react`. The `/api/chat` route returns a plain text stream (`toTextStreamResponse`), so the client must use the text stream protocol.

- [ ] **Step 4: Run the component test** → PASS.

- [ ] **Step 5: Implement `apps/web/app/(app)/chat/page.tsx`:**
```tsx
import { auth } from "@clerk/nextjs/server";
import { createDb } from "@gr/db";
import { getOrCreatePersonalKb } from "@gr/db/queries";
import { Chat } from "../../../components/chat.js";

export default async function ChatPage() {
  const { userId } = await auth();
  if (!userId) return null;
  const { db } = createDb();
  const kbId = await getOrCreatePersonalKb(db, userId);
  return <Chat kbId={kbId} />;
}
```

- [ ] **Step 6: Typecheck + commit** `feat(web): chat UI (useChat) with citation chips`.

---

## Task 12: Full sweep, manual smoke, README

**Files:** Modify `scripts/test.sh` (add component-test step), `README.md`.

- [ ] **Step 1: Add the jsdom component-test run to `scripts/test.sh`** after the Vitest suite line:
```bash
echo "▶ Running web component tests…"
pnpm --filter @gr/web exec vitest run
```

- [ ] **Step 2: Run the full runner** `pnpm test` → all node + component tests green (expect the prior 35 + new DB/route/component tests).

- [ ] **Step 3: Manual smoke (documented, not automated in 2a):** with Clerk dev keys in `apps/web/.env.local`, run `pnpm --filter @gr/web dev`, sign up, save a paragraph, ask a question, confirm a streamed cited answer. Record the steps in `README.md` under "Run the web app".

- [ ] **Step 4: Commit** `chore(web): wire component tests into runner + README web instructions`.

---

## Self-Review notes (addressed)

- **Spec coverage (vs architecture spec §4–§9, web-app slice):** Clerk session OR API-token auth at the ingest boundary (Task 6/7); personal-KB multi-tenant bootstrap + membership-gated chat (Task 3/8); streaming grounded RAG with citations + honest-refusal guardrail + token accounting (`tokens` persisted) (Task 8); library view + add-content (Task 9/10); chat UI (Task 11). Deferred-by-design and labeled OUT: search page, import, file upload (Blob), settings/token UI, delete/takedown, deploy — all → Plan 2b.
- **Type consistency:** `Principal.userId` (Task 6) used in Tasks 7/8; `Retriever.retrieve(kbId, query): Promise<RankedChunk[]>` (Task 5) consumed by `ChatDeps` + the chat route (Task 8); `LibraryDoc` shape returned by `listDocuments` (Task 3) matches `LibraryList` props (Task 9); `Citation` shape persisted in `/api/chat` (Task 8) matches the `Transcript` prop (Task 11); `__setIngestDeps` / `__setChatDeps` mirror each other.
- **Two version-sensitive spots flagged inline (not placeholders):** the `ai/test` `MockLanguageModelV2` stream-chunk shape (Task 8) and `useChat` option names (Task 11) — both pinned to "verify against installed AI SDK v6," with the stable route/API code unaffected.
- **Testability:** every route is exercised through the API-token path (no Clerk context needed); AI is injected via deps seams; the Clerk-session path and live streaming are deferred to Playwright e2e in Plan 2b.
```
