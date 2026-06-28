# iOS Share Sheet Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user capture URLs, text, and files into GoldenRetriever from the iOS Share Sheet via a personal API token.

**Architecture:** Add self-serve API-token management (`/api/tokens` routes + a `/settings` page), make `kbId` optional on the ingest/upload routes (default to the caller's personal KB), and deliver an iOS Shortcut as a written recipe. Reuse the existing bearer-token auth (`resolveAuth`/`verifyApiToken`), `api_tokens` schema, and ingest/upload pipeline.

**Tech Stack:** Next.js 15 (App Router), Clerk v7, Drizzle ORM + Neon/Postgres, Vitest 4 / Vite 6, Testing Library (jsdom), pnpm + Turborepo.

## Global Constraints

- **Next.js 15:** dynamic route handler `params` is a `Promise<...>` and `headers()` is async — `await` both.
- **Token-management endpoints are session-only:** authenticate with `resolveSessionUser` (Clerk session), NEVER `resolveAuth` (which accepts bearer tokens). A leaked capture token must not mint/revoke tokens.
- **Token format:** `grt_` + 256 bits of CSPRNG entropy (`randomBytes(32).toString("base64url")`). Store only `sha256(raw)` (via existing `hashToken`); return the raw secret exactly once.
- **Reuse existing helpers:** `hashToken` (`apps/web/lib/auth.ts`), `getOrCreatePersonalKb` + `listDocuments` (`@gr/db/queries`), `verifyApiToken` (`apps/web/lib/auth.ts`).
- **Tests:** node/integration tests live in `apps/web/test/*.test.ts` and run against the Docker DB on `:5433` via `bash scripts/test.sh <path>`; component tests (jsdom) live in `apps/web/components/*.test.tsx` and run via `pnpm --filter @gr/web exec vitest run <path>`.
- **DI seams:** reuse `__setIngestDeps`/`__setBlobStore`; add `__setSessionUser`/`__clearSessionUser` for session auth.
- **Commit after each task.** Author/co-author trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- Create `apps/web/lib/tokens.ts` — token query layer (create/list/revoke).
- Modify `apps/web/lib/clerk-auth.ts` — add `resolveSessionUser` + test seam.
- Create `apps/web/app/api/tokens/route.ts` — `POST` (create) + `GET` (list).
- Create `apps/web/app/api/tokens/[id]/route.ts` — `DELETE` (revoke).
- Modify `apps/web/app/api/ingest/route.ts` — `kbId` optional → personal KB.
- Modify `apps/web/app/api/upload/route.ts` — `kbId` optional → personal KB.
- Create `apps/web/components/api-tokens.tsx` — client UI (create/list/revoke + iOS setup).
- Create `apps/web/app/(app)/settings/page.tsx` — server page rendering `ApiTokens`.
- Modify `apps/web/app/(app)/layout.tsx` — add "Settings" nav link.
- Create `docs/ios-shortcut.md` — the Shortcut recipe.
- Tests: `apps/web/test/tokens.test.ts`, `apps/web/test/session-auth.test.ts`, `apps/web/test/tokens-route.test.ts`, `apps/web/test/tokens-revoke-route.test.ts`, `apps/web/test/ingest-default-kb.test.ts`, `apps/web/components/api-tokens.test.tsx`; modify `apps/web/test/ingest-route.test.ts`.

---

### Task 1: Token query layer

**Files:**
- Create: `apps/web/lib/tokens.ts`
- Test: `apps/web/test/tokens.test.ts`

**Interfaces:**
- Consumes: `hashToken` from `apps/web/lib/auth.ts`; `schema` from `@gr/db`.
- Produces:
  - `createApiToken(db, userId: string, name: string): Promise<{ id: string; token: string }>`
  - `listApiTokens(db, userId: string): Promise<TokenSummary[]>` where `TokenSummary = { id: string; name: string; createdAt: Date; lastUsedAt: Date | null; revoked: boolean }`
  - `revokeApiToken(db, userId: string, id: string): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/tokens.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb, schema } from "@gr/db";
import { eq } from "drizzle-orm";
import { createUser } from "@gr/db/queries";
import { hashToken, verifyApiToken } from "../lib/auth.js";
import { createApiToken, listApiTokens, revokeApiToken } from "../lib/tokens.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let uid: string;
beforeAll(async () => { uid = await createUser(db, { id: "u_tok", email: "t@t.dev" }); });
afterAll(async () => { await sql.end(); });

describe("token query layer", () => {
  it("createApiToken stores only the hash and returns the raw secret once", async () => {
    const { id, token } = await createApiToken(db, uid, "phone");
    expect(token.startsWith("grt_")).toBe(true);
    const row = (await db.select().from(schema.apiTokens).where(eq(schema.apiTokens.id, id)))[0];
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.tokenHash).not.toContain(token);
    // the raw token authenticates
    expect((await verifyApiToken(db, token))?.userId).toBe(uid);
  });

  it("listApiTokens returns summaries without the secret/hash and reflects revocation", async () => {
    const { id } = await createApiToken(db, uid, "laptop");
    let list = await listApiTokens(db, uid);
    const found = list.find((t) => t.id === id)!;
    expect(found.name).toBe("laptop");
    expect(found.revoked).toBe(false);
    expect((found as Record<string, unknown>).tokenHash).toBeUndefined();
    expect(await revokeApiToken(db, uid, id)).toBe(true);
    list = await listApiTokens(db, uid);
    expect(list.find((t) => t.id === id)!.revoked).toBe(true);
    // a revoked token no longer authenticates
  });

  it("revokeApiToken returns false for a token the user does not own (IDOR-safe)", async () => {
    const other = await createUser(db, { id: "u_tok_other", email: "o@t.dev" });
    const { id } = await createApiToken(db, other, "theirs");
    expect(await revokeApiToken(db, uid, id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash scripts/test.sh apps/web/test/tokens.test.ts`
Expected: FAIL — `Cannot find module '../lib/tokens.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/lib/tokens.ts`:

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { schema } from "@gr/db";
import { hashToken } from "./auth.js";

type Db = ReturnType<typeof drizzle>;

export interface TokenSummary {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revoked: boolean;
}

/** Mint a capture token. Returns the raw secret ONCE — only its sha256 hash is stored. */
export async function createApiToken(db: Db, userId: string, name: string): Promise<{ id: string; token: string }> {
  const token = "grt_" + randomBytes(32).toString("base64url");
  const id = `tok_${randomUUID().slice(0, 12)}`;
  await db.insert(schema.apiTokens).values({ id, userId, name, tokenHash: hashToken(token) });
  return { id, token };
}

export async function listApiTokens(db: Db, userId: string): Promise<TokenSummary[]> {
  const rows = await db.select().from(schema.apiTokens)
    .where(eq(schema.apiTokens.userId, userId))
    .orderBy(desc(schema.apiTokens.createdAt));
  return rows.map((r) => ({
    id: r.id, name: r.name, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, revoked: r.revokedAt != null,
  }));
}

/** Revoke one of the caller's tokens. Returns false when it isn't theirs (IDOR-safe). */
export async function revokeApiToken(db: Db, userId: string, id: string): Promise<boolean> {
  const res = await db.update(schema.apiTokens).set({ revokedAt: new Date() })
    .where(and(eq(schema.apiTokens.id, id), eq(schema.apiTokens.userId, userId)))
    .returning({ id: schema.apiTokens.id });
  return res.length > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash scripts/test.sh apps/web/test/tokens.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/tokens.ts apps/web/test/tokens.test.ts
git commit -m "feat(web): API token query layer (create/list/revoke)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Session-only auth helper

**Files:**
- Modify: `apps/web/lib/clerk-auth.ts`
- Test: `apps/web/test/session-auth.test.ts`

**Interfaces:**
- Consumes: `auth`, `currentUser` from `@clerk/nextjs/server`; `upsertUser` from `@gr/db/queries`; existing `Principal` type.
- Produces:
  - `resolveSessionUser(db, req: Request): Promise<Principal | null>` — Clerk session only; ignores the `Authorization` header.
  - `__setSessionUser(userId: string | null): void` and `__clearSessionUser(): void` test seams.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/session-auth.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { resolveSessionUser, __setSessionUser, __clearSessionUser } from "../lib/clerk-auth.js";

const db = {} as never; // not used on the override / no-session paths
afterEach(() => __clearSessionUser());

describe("resolveSessionUser", () => {
  it("returns the overridden session user", async () => {
    __setSessionUser("u_x");
    expect(await resolveSessionUser(db, new Request("http://x"))).toEqual({ userId: "u_x" });
  });
  it("returns null when overridden to no session", async () => {
    __setSessionUser(null);
    expect(await resolveSessionUser(db, new Request("http://x"))).toBeNull();
  });
  it("does NOT authenticate a bearer token (session-only)", async () => {
    __clearSessionUser(); // fall through to Clerk, which has no context in tests → null
    const req = new Request("http://x", { headers: { authorization: "Bearer grt_anything" } });
    expect(await resolveSessionUser(db, req)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash scripts/test.sh apps/web/test/session-auth.test.ts`
Expected: FAIL — `resolveSessionUser` / `__setSessionUser` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/web/lib/clerk-auth.ts` (after the existing `resolveAuth`):

```ts
// --- Session-only auth (token management) -------------------------------------
// Token-management endpoints must NOT accept bearer capture tokens — a leaked token
// could otherwise mint or revoke tokens. resolveSessionUser uses the Clerk session
// only and never inspects the Authorization header.
let sessionOverride: string | null | undefined; // undefined = use real Clerk
/** Test seam: force the session user (null = no session). */
export function __setSessionUser(userId: string | null) { sessionOverride = userId; }
/** Test seam: reset to real Clerk resolution. */
export function __clearSessionUser() { sessionOverride = undefined; }

export async function resolveSessionUser(db: Db, _req: Request): Promise<Principal | null> {
  if (sessionOverride !== undefined) return sessionOverride ? { userId: sessionOverride } : null;
  let userId: string | null;
  try {
    ({ userId } = await auth());
  } catch {
    return null;
  }
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

- [ ] **Step 4: Run test to verify it passes**

Run: `bash scripts/test.sh apps/web/test/session-auth.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/clerk-auth.ts apps/web/test/session-auth.test.ts
git commit -m "feat(web): resolveSessionUser (Clerk session only, no bearer)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Token create + list routes

**Files:**
- Create: `apps/web/app/api/tokens/route.ts`
- Test: `apps/web/test/tokens-route.test.ts`

**Interfaces:**
- Consumes: `resolveSessionUser`, `__setSessionUser`, `__clearSessionUser` (Task 2); `createApiToken`, `listApiTokens` (Task 1); `createDb` from `@gr/db`.
- Produces: `POST` (201 `{ id, name, token }`) and `GET` (200 `{ tokens: TokenSummary[] }`) handlers at `/api/tokens`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/tokens-route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser } from "@gr/db/queries";
import { hashToken } from "../lib/auth.js";
import { __setSessionUser, __clearSessionUser } from "../lib/clerk-auth.js";
import { POST, GET } from "../app/api/tokens/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let bearer: string;
beforeAll(async () => {
  await createUser(db, { id: "u_tr", email: "tr@tr.dev" });
  bearer = "grt_tr_capture";
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId: "u_tr", name: "cap", tokenHash: hashToken(bearer),
  });
});
afterEach(() => __clearSessionUser());
afterAll(async () => { __clearSessionUser(); await sql.end(); });

const jsonReq = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost/api/tokens", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });

describe("POST/GET /api/tokens", () => {
  it("401 without a session", async () => {
    __setSessionUser(null);
    expect((await POST(jsonReq({ name: "x" }))).status).toBe(401);
  });

  it("does NOT accept a bearer capture token (privilege-escalation guard)", async () => {
    __clearSessionUser(); // no session; only a bearer header present
    const res = await POST(jsonReq({ name: "evil" }, { authorization: `Bearer ${bearer}` }));
    expect(res.status).toBe(401);
  });

  it("400 on an empty name", async () => {
    __setSessionUser("u_tr");
    expect((await POST(jsonReq({ name: "  " }))).status).toBe(400);
  });

  it("creates a token (201) and lists it (200)", async () => {
    __setSessionUser("u_tr");
    const created = await POST(jsonReq({ name: "iPhone" }));
    expect(created.status).toBe(201);
    const body = await created.json() as { token: string; name: string };
    expect(body.token.startsWith("grt_")).toBe(true);
    expect(body.name).toBe("iPhone");

    const listed = await GET(new NextRequest("http://localhost/api/tokens"));
    expect(listed.status).toBe(200);
    const { tokens } = await listed.json() as { tokens: { name: string }[] };
    expect(tokens.some((t) => t.name === "iPhone")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash scripts/test.sh apps/web/test/tokens-route.test.ts`
Expected: FAIL — `Cannot find module '../app/api/tokens/route.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/app/api/tokens/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createDb } from "@gr/db";
import { resolveSessionUser } from "../../../lib/clerk-auth.js";
import { createApiToken, listApiTokens } from "../../../lib/tokens.js";

export async function POST(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveSessionUser(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { name?: string };
  const name = (body.name ?? "").trim();
  if (!name || name.length > 64) {
    return NextResponse.json({ error: "name required (1-64 chars)" }, { status: 400 });
  }
  const { id, token } = await createApiToken(db, principal.userId, name);
  return NextResponse.json({ id, name, token }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveSessionUser(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ tokens: await listApiTokens(db, principal.userId) });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash scripts/test.sh apps/web/test/tokens-route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/tokens/route.ts apps/web/test/tokens-route.test.ts
git commit -m "feat(web): POST/GET /api/tokens (session-only, escalation-guarded)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Token revoke route

**Files:**
- Create: `apps/web/app/api/tokens/[id]/route.ts`
- Test: `apps/web/test/tokens-revoke-route.test.ts`

**Interfaces:**
- Consumes: `resolveSessionUser`, `__setSessionUser` (Task 2); `createApiToken`, `revokeApiToken` (Task 1).
- Produces: `DELETE(req, { params: Promise<{ id: string }> })` — 200 `{ ok: true }` on success, 404 when the token isn't the caller's.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/tokens-revoke-route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createDb } from "@gr/db";
import { createUser } from "@gr/db/queries";
import { createApiToken } from "../lib/tokens.js";
import { __setSessionUser, __clearSessionUser } from "../lib/clerk-auth.js";
import { DELETE } from "../app/api/tokens/[id]/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
beforeAll(async () => {
  await createUser(db, { id: "u_rv", email: "rv@rv.dev" });
  await createUser(db, { id: "u_rv2", email: "rv2@rv.dev" });
});
afterEach(() => __clearSessionUser());
afterAll(async () => { __clearSessionUser(); await sql.end(); });

const del = (id: string) =>
  DELETE(new NextRequest(`http://localhost/api/tokens/${id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id }) });

describe("DELETE /api/tokens/:id", () => {
  it("revokes the caller's own token (200)", async () => {
    __setSessionUser("u_rv");
    const { id } = await createApiToken(db, "u_rv", "mine");
    expect((await del(id)).status).toBe(200);
  });
  it("404 when revoking another user's token (IDOR)", async () => {
    const { id } = await createApiToken(db, "u_rv2", "theirs");
    __setSessionUser("u_rv");
    expect((await del(id)).status).toBe(404);
  });
  it("401 without a session", async () => {
    __setSessionUser(null);
    expect((await del("tok_whatever")).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash scripts/test.sh apps/web/test/tokens-revoke-route.test.ts`
Expected: FAIL — `Cannot find module '../app/api/tokens/[id]/route.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/app/api/tokens/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createDb } from "@gr/db";
import { resolveSessionUser } from "../../../../lib/clerk-auth.js";
import { revokeApiToken } from "../../../../lib/tokens.js";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { db } = createDb();
  const principal = await resolveSessionUser(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const ok = await revokeApiToken(db, principal.userId, id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash scripts/test.sh apps/web/test/tokens-revoke-route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/api/tokens/[id]/route.ts" apps/web/test/tokens-revoke-route.test.ts
git commit -m "feat(web): DELETE /api/tokens/:id revoke (IDOR-safe)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Default to personal KB on ingest + upload

**Files:**
- Modify: `apps/web/app/api/ingest/route.ts`
- Modify: `apps/web/app/api/upload/route.ts`
- Modify: `apps/web/test/ingest-route.test.ts` (tighten the now-inaccurate assertion)
- Test: `apps/web/test/ingest-default-kb.test.ts`

**Interfaces:**
- Consumes: `getOrCreatePersonalKb` from `@gr/db/queries`.
- Produces: both routes accept requests with no `kbId` and target the caller's personal KB.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/ingest-default-kb.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser, getOrCreatePersonalKb, listDocuments } from "@gr/db/queries";
import { createMockAiClient } from "@gr/ai/mock";
import { MockConverter } from "@gr/ingest";
import { hashToken } from "../lib/auth.js";
import { __setIngestDeps } from "../lib/ingest-service.js";
import { POST } from "../app/api/ingest/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let token: string;
beforeAll(async () => {
  await createUser(db, { id: "u_defkb", email: "d@d.dev" });
  token = "grt_defkb";
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId: "u_defkb", name: "t", tokenHash: hashToken(token),
  });
  __setIngestDeps({ ai: createMockAiClient(), converter: new MockConverter(),
    urlFetcher: async () => ({ kind: "text" as const, mimeType: "text/plain", text: "" }) });
});
afterAll(async () => { __setIngestDeps(null); await sql.end(); });

it("ingests into the caller's personal KB when kbId is omitted", async () => {
  delete process.env.APP_URL;
  const res = await POST(new NextRequest("http://localhost/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ text: "A Kyoto ryokan note captured from my phone." }),
  }));
  expect(res.status).toBe(202);
  const kbId = await getOrCreatePersonalKb(db, "u_defkb");
  const docs = await listDocuments(db, kbId);
  expect(docs.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash scripts/test.sh apps/web/test/ingest-default-kb.test.ts`
Expected: FAIL — currently returns 400 (kbId required), so `expect(res.status).toBe(202)` fails.

- [ ] **Step 3a: Modify the ingest route**

In `apps/web/app/api/ingest/route.ts`:

Add the import (extend the existing `@gr/db/queries` import line near the top — it currently imports from `@gr/db`; add a new import):

```ts
import { getOrCreatePersonalKb } from "@gr/db/queries";
```

Replace the validation block:

```ts
  if (!body.kbId || (!body.text && !body.html && !body.url)) {
    return NextResponse.json({ error: "kbId and one of {text, html, url} required" }, { status: 400 });
  }
```

with:

```ts
  if (!body.text && !body.html && !body.url) {
    return NextResponse.json({ error: "one of {text, html, url} required" }, { status: 400 });
  }
```

After the `isSafeHttpUrl` check (just before the membership query), insert:

```ts
  // kbId is optional: capture clients (iOS Shortcut) send only a token → use the
  // caller's personal KB. When a kbId is supplied, the membership check below applies.
  const kbId = body.kbId ?? (await getOrCreatePersonalKb(db, principal.userId));
```

Then replace the three remaining `body.kbId` usages with `kbId`:
- the `kbMembers` membership query `eq(schema.kbMembers.kbId, body.kbId)` → `eq(schema.kbMembers.kbId, kbId)`
- `enqueueIngestion(db, { kbId: body.kbId, ... })` → `kbId,`
- `processJob(..., { documentId, kbId: body.kbId, ... })` → `kbId,`

- [ ] **Step 3b: Modify the upload route**

In `apps/web/app/api/upload/route.ts`:

Add the import:

```ts
import { getOrCreatePersonalKb } from "@gr/db/queries";
```

Replace:

```ts
  const form = await req.formData();
  const kbId = form.get("kbId");
  const file = form.get("file");
  if (typeof kbId !== "string" || !(file instanceof File)) {
    return NextResponse.json({ error: "kbId and file required" }, { status: 400 });
  }
```

with:

```ts
  const form = await req.formData();
  const kbIdRaw = form.get("kbId");
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  const kbId = typeof kbIdRaw === "string" && kbIdRaw
    ? kbIdRaw
    : await getOrCreatePersonalKb(db, principal.userId);
```

(The later `file.size`, membership query, `insertDocument`, and `processJob` already reference `kbId`, which is now the resolved string.)

- [ ] **Step 3c: Tighten the existing ingest assertion**

In `apps/web/test/ingest-route.test.ts`, replace:

```ts
  it("400 when kbId or content missing", async () => {
    expect((await post({ kbId }, token)).status).toBe(400);
  });
```

with:

```ts
  it("400 when content is missing", async () => {
    expect((await post({}, token)).status).toBe(400);
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bash scripts/test.sh apps/web/test/ingest-default-kb.test.ts apps/web/test/ingest-route.test.ts apps/web/test/upload-route.test.ts apps/web/test/ingest-route-session.test.ts`
Expected: PASS (all). The new default-KB test is 202; the tightened test is 400; the existing upload/session tests (which pass `kbId` explicitly) still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/ingest/route.ts apps/web/app/api/upload/route.ts apps/web/test/ingest-default-kb.test.ts apps/web/test/ingest-route.test.ts
git commit -m "feat(web): default ingest/upload to the caller's personal KB

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: API tokens UI component

**Files:**
- Create: `apps/web/components/api-tokens.tsx`
- Test: `apps/web/components/api-tokens.test.tsx`

**Interfaces:**
- Consumes: browser `fetch` against `/api/tokens` and `/api/tokens/:id` (Tasks 3–4).
- Produces: `ApiTokens({ baseUrl }: { baseUrl: string })` client component. It fetches the token list on mount, creates tokens (revealing the secret once), and revokes them.

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/api-tokens.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ApiTokens } from "./api-tokens.js";

afterEach(() => vi.restoreAllMocks());

describe("ApiTokens", () => {
  it("creates a token and reveals the secret once", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tokens: [] }) })                                  // mount load
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "t1", name: "iPhone", token: "grt_SECRET" }) }) // POST create
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tokens: [{ id: "t1", name: "iPhone", createdAt: "2026-06-27T00:00:00.000Z", lastUsedAt: null, revoked: false }] }) }); // reload
    vi.stubGlobal("fetch", fetchMock);

    render(<ApiTokens baseUrl="https://app.example" />);
    fireEvent.change(screen.getByPlaceholderText(/token name/i), { target: { value: "iPhone" } });
    fireEvent.click(screen.getByRole("button", { name: /create token/i }));

    await waitFor(() => expect(screen.getByText("grt_SECRET")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("iPhone")).toBeTruthy());
    // base URL is shown for the iOS Shortcut setup
    expect(screen.getByText(/https:\/\/app\.example/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @gr/web exec vitest run components/api-tokens.test.tsx`
Expected: FAIL — `Cannot find module './api-tokens.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/components/api-tokens.tsx`:

```tsx
"use client";
import { useEffect, useState, type FormEvent } from "react";

interface TokenSummary { id: string; name: string; createdAt: string; lastUsedAt: string | null; revoked: boolean; }

export function ApiTokens({ baseUrl }: { baseUrl: string }) {
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/tokens");
    if (res.ok) setTokens(((await res.json()) as { tokens: TokenSummary[] }).tokens);
  }
  useEffect(() => { void load(); }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: n }),
      });
      if (res.ok) {
        const d = (await res.json()) as { name: string; token: string };
        setCreated({ name: d.name, token: d.token });
        setName("");
        await load();
      }
    } finally { setBusy(false); }
  }

  async function revoke(id: string) {
    setBusy(true);
    try { await fetch(`/api/tokens/${id}`, { method: "DELETE" }); await load(); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={create} className="flex gap-2">
        <input className="flex-1 rounded border p-2" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Token name (e.g. iPhone)" />
        <button disabled={busy} className="rounded bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-50">Create token</button>
      </form>

      {created ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium">Copy your token now — you won&apos;t see it again:</p>
          <code className="mt-1 block break-all rounded bg-white px-2 py-1">{created.token}</code>
        </div>
      ) : null}

      <ul className="divide-y rounded border">
        {tokens.length === 0 ? (
          <li className="p-3 text-sm text-neutral-500">No tokens yet.</li>
        ) : tokens.map((t) => (
          <li key={t.id} className="flex items-center justify-between p-3 text-sm">
            <span>
              {t.name}{t.revoked ? <span className="ml-2 text-neutral-400">(revoked)</span> : null}
              <span className="ml-2 text-neutral-400">last used {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleDateString() : "never"}</span>
            </span>
            {t.revoked ? null : (
              <button onClick={() => revoke(t.id)} disabled={busy} className="rounded border px-2 py-1 text-xs disabled:opacity-50">Revoke</button>
            )}
          </li>
        ))}
      </ul>

      <details className="rounded border p-3 text-sm">
        <summary className="cursor-pointer font-medium">iOS Shortcut setup</summary>
        <p className="mt-2">In the “Save to GoldenRetriever” Shortcut, set:</p>
        <ul className="mt-1 list-disc pl-5">
          <li>Base URL: <code className="break-all">{baseUrl}</code></li>
          <li>Authorization header: <code>Bearer &lt;your token above&gt;</code></li>
        </ul>
        <p className="mt-2 text-neutral-600">Full step-by-step recipe: see <code>docs/ios-shortcut.md</code>.</p>
      </details>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @gr/web exec vitest run components/api-tokens.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/api-tokens.tsx apps/web/components/api-tokens.test.tsx
git commit -m "feat(web): API tokens settings UI (create/list/revoke + iOS setup)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Settings page + nav link

**Files:**
- Create: `apps/web/app/(app)/settings/page.tsx`
- Modify: `apps/web/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `ApiTokens` (Task 6); `headers` from `next/headers`.
- Produces: a Clerk-protected `/settings` page reachable from the app nav.

- [ ] **Step 1: Create the Settings page**

Create `apps/web/app/(app)/settings/page.tsx`:

```tsx
import { headers } from "next/headers";
import { ApiTokens } from "../../../components/api-tokens.js";

export default async function SettingsPage() {
  // Base URL for the iOS Shortcut: prefer APP_URL, else infer from the request host.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const baseUrl = process.env.APP_URL ?? (host ? `${proto}://${host}` : "");

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Settings</h1>
      <section className="space-y-2">
        <h2 className="font-medium">API tokens</h2>
        <p className="text-sm text-neutral-600">
          Create a token for the iOS “Save to GoldenRetriever” Shortcut so you can capture links,
          text, and files from your phone&apos;s Share Sheet.
        </p>
        <ApiTokens baseUrl={baseUrl} />
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Add the nav link**

In `apps/web/app/(app)/layout.tsx`, replace the `<nav>` block:

```tsx
        <nav className="flex gap-4">
          <Link href="/" className="font-semibold">Library</Link>
          <Link href="/chat" className="text-neutral-600">Chat</Link>
          <Link href="/search" className="text-neutral-600">Search</Link>
        </nav>
```

with:

```tsx
        <nav className="flex gap-4">
          <Link href="/" className="font-semibold">Library</Link>
          <Link href="/chat" className="text-neutral-600">Chat</Link>
          <Link href="/search" className="text-neutral-600">Search</Link>
          <Link href="/settings" className="text-neutral-600">Settings</Link>
        </nav>
```

- [ ] **Step 3: Typecheck + component sweep**

Run: `pnpm --filter @gr/web typecheck && pnpm --filter @gr/web exec vitest run`
Expected: typecheck exits 0; component tests pass (including `api-tokens.test.tsx`).

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(app)/settings/page.tsx" "apps/web/app/(app)/layout.tsx"
git commit -m "feat(web): /settings page + nav link for API tokens

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: iOS Shortcut recipe doc

**Files:**
- Create: `docs/ios-shortcut.md`

**Interfaces:**
- Consumes: `/api/ingest` (URL/text) and `/api/upload` (files) with `Authorization: Bearer <token>`.
- Produces: a written recipe a user follows once in the iOS Shortcuts app.

- [ ] **Step 1: Write the recipe**

Create `docs/ios-shortcut.md`:

```markdown
# iOS “Save to GoldenRetriever” Shortcut

Capture links, text, and files into GoldenRetriever from the iOS Share Sheet.

## One-time setup

1. In GoldenRetriever, open **Settings → API tokens**, create a token, and copy it.
2. Note your **Base URL** (shown in Settings, e.g. `https://goldenretriever-web.vercel.app`).

## Build the Shortcut

Open the **Shortcuts** app → **+** → and add these actions:

1. **Receive** *Safari web pages, Text, Images, PDFs, and Files* from the **Share Sheet**
   (tap the Shortcut’s settings → "Show in Share Sheet" → accept those types).
2. **Text** action → paste your token. (Name it `Token`.)
3. **Text** action → paste your Base URL. (Name it `BaseURL`.)
4. **If** *Shortcut Input* **has any value** and is a **URL**:
   - **Get Contents of URL**
     - URL: `BaseURL` + `/api/ingest`
     - Method: **POST**
     - Headers: `Authorization` = `Bearer ` + `Token`
     - Request Body: **JSON** → `{ "url": <Shortcut Input> }`
5. **Otherwise If** the input is **Text**:
   - **Get Contents of URL** → `BaseURL/api/ingest`, POST, same `Authorization` header,
     JSON body `{ "text": <Shortcut Input> }`.
6. **Otherwise** (a file/image/PDF):
   - **Get Contents of URL** → `BaseURL/api/upload`, POST, same `Authorization` header,
     Request Body: **Form** → add field **file** = *Shortcut Input* (the shared file).
7. **Show Notification**: “Saved to GoldenRetriever ✓”.

## Use it

Share any page/selection/file → **Save to GoldenRetriever**. It appears in your Library
and becomes searchable / answerable in chat within a few seconds (the first file upload
after idle may take 10–30s while the converter warms up).

## Notes

- No KB id is needed — a token maps to your personal library automatically.
- Revoke a lost token any time in **Settings → API tokens**; it stops working immediately.
```

- [ ] **Step 2: Verify it renders + links resolve**

Run: `git add docs/ios-shortcut.md && git status --short`
Expected: the file is staged; no code/test changes needed (documentation task).

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: iOS Share Sheet Shortcut recipe

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run the full suite: `bash scripts/test.sh`
  Expected: all node + component tests pass (existing 83 + the new token/session/default-KB/component tests).
- [ ] Deploy: `vercel deploy --prod --yes` (from repo root). The token routes and `/settings` ship with the web app; no new env vars are required.
- [ ] Manual smoke: sign in → **Settings** → create a token → copy it → build the Shortcut from `docs/ios-shortcut.md` → share a Safari page and a PDF → confirm both appear in the Library as **ready**.

## Self-Review

- **Spec coverage:** token create/list/revoke (T1, T3, T4) ✓; session-only escalation guard (T2, tested in T3) ✓; default-to-personal-KB (T5) ✓; Settings UI shown-once + revoke + iOS setup (T6, T7) ✓; Shortcut recipe covering URL/text/file branches (T8) ✓; security tests — escalation guard (T3), IDOR revoke (T4), hash-not-raw storage (T1) ✓.
- **Placeholders:** none — every step has full code and exact commands.
- **Type consistency:** `TokenSummary` (Date fields server-side in T1; serialized to ISO strings consumed as `string` in the T6 client interface — intentional and noted); `resolveSessionUser`/`__setSessionUser`/`__clearSessionUser`, `createApiToken`/`listApiTokens`/`revokeApiToken` names match across tasks; `params: Promise<{ id: string }>` matches the Next 15 handler signature used in T4's test.
