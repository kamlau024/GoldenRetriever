# GoldenRetriever — Automated Testing Plan

> **For agentic workers:** Part A is executable now (bite-sized TDD tasks). Parts B–D are testing strategies to fold into the Plan 2 / Plan 3 implementation plans when they are written. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the Stage 0 test gaps (chiefly the untested HTTP route handlers and their security behaviors), and define the testing approach for every later phase so coverage grows with the product rather than lagging it.

---

## Current coverage (Stage 0, after merge `0a7eea5`)

28 tests across 11 files. Run:
```bash
pnpm db:up
cat packages/db/drizzle/0000_*.sql | docker compose -f docker-compose.test.yml exec -T db psql -U gr -d gr_test
DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test AI_GATEWAY_API_KEY=test pnpm test
```

| Area | Tested? | Where |
|---|---|---|
| `@gr/config` env schema | ✅ unit | `packages/config/src/env.test.ts` |
| `@gr/core` types | n/a (types) | — |
| `@gr/db` schema + pgvector | ✅ via integration | exercised by queries/hybrid tests |
| `@gr/db` query helpers + kb scoping | ✅ integration | `packages/db/src/queries.test.ts` |
| `@gr/ingest` Readability extract | ✅ unit | `extract.test.ts` |
| `@gr/ingest` chunker | ✅ unit | `chunk.test.ts` |
| `@gr/ingest` format router (markitdown) | ✅ unit | `router.test.ts` |
| `@gr/ingest` pipeline (html/binary/fail) | ✅ integration | `pipeline.test.ts` |
| `@gr/ai` model-config + dim guard | ✅ unit | `models.test.ts` |
| `@gr/ai` `AiClient` real impl | ❌ (mocked by design) | — |
| `@gr/retrieval` RRF | ✅ unit | `rrf.test.ts` |
| `@gr/retrieval` HybridRetriever | ✅ integration | `hybrid.test.ts` |
| API-token verification | ✅ integration | `apps/web/lib/auth.test.ts` |
| ingest→process→retrieve | ✅ e2e (service layer) | `apps/web/test/ingest-e2e.test.ts` |
| `/api/ingest` route handler | ✅ unit + happy-path | `apps/web/test/ingest-route.test.ts`, `ingest-route-happy.test.ts` |
| `/api/worker` route handler | ✅ unit | `apps/web/test/worker-route.test.ts` |
| Security: IDOR 403 / auth 401 / fail-closed secret | ✅ negative tests | `ingest-route.test.ts`, `worker-route.test.ts` |
| **markitdown Python service (functional)** | ❌ **GAP** (syntax-only) | — (CI-gated, Part A4) |

> **Status (2026-06-14):** Part A1–A3 implemented (35 tests total). A4 (markitdown Python functional test) remains — it needs Python 3.10+ and the markitdown deps, so it runs in CI (Part D), not the local Node suite.

---

## Part A — Stage 0 test backfill (executable now)

The auth, validation, and authorization paths short-circuit **before** any AI call, so they can be tested by calling the exported route handlers directly with a constructed `NextRequest` — no AI mocking needed. The happy path needs a small dependency-injection seam (Task A3).

### Task A1: `/api/ingest` security & validation tests

**Files:** Create `apps/web/test/ingest-route.test.ts`

- [ ] **Step 1: Write the failing tests** (run with `DATABASE_URL` + `AI_GATEWAY_API_KEY`):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser, createKnowledgeBase } from "@gr/db/queries";
import { hashToken } from "../lib/auth.js";
import { POST } from "../app/api/ingest/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, otherKbId: string, token: string;

const post = (body: unknown, auth?: string) =>
  POST(new NextRequest("http://localhost/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
  }));

beforeAll(async () => {
  const owner = await createUser(db, { id: "u_route_owner", email: "o@o.dev" });
  const outsider = await createUser(db, { id: "u_route_outsider", email: "x@x.dev" });
  kbId = await createKnowledgeBase(db, { ownerId: owner, name: "Owned" });
  otherKbId = await createKnowledgeBase(db, { ownerId: outsider, name: "NotMine" });
  token = "grt_route_tok";
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId: owner, name: "r", tokenHash: hashToken(token),
  });
});
afterAll(async () => { await sql.end(); });

describe("POST /api/ingest auth & authz", () => {
  it("401 without a token", async () => {
    expect((await post({ kbId, text: "hi" })).status).toBe(401);
  });
  it("400 when kbId or content missing", async () => {
    expect((await post({ kbId }, token)).status).toBe(400);
  });
  it("403 when caller is not a member of the target kb (IDOR)", async () => {
    expect((await post({ kbId: otherKbId, text: "hi" }, token)).status).toBe(403);
  });
});
```

- [ ] **Step 2:** Run, verify the auth/validation/authz tests pass (the route already implements these). Command:
  `DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test AI_GATEWAY_API_KEY=test pnpm vitest run apps/web/test/ingest-route.test.ts`
  Expected: 3 pass. (If 403 fails, the IDOR guard regressed — fix the route.)

- [ ] **Step 3: Commit** `test(web): /api/ingest auth, validation, IDOR authorization`

### Task A2: `/api/worker` fail-closed secret tests

**Files:** Create `apps/web/test/worker-route.test.ts`

- [ ] **Step 1: Write the failing tests:**

```ts
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/worker/route.js";

const post = (secret?: string) =>
  POST(new NextRequest("http://localhost/api/worker", {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { "x-worker-secret": secret } : {}) },
    body: JSON.stringify({ jobId: "j", documentId: "missing" }),
  }));

describe("POST /api/worker secret handling", () => {
  it("500 when WORKER_SECRET is not configured", async () => {
    delete process.env.WORKER_SECRET;
    expect((await post("anything")).status).toBe(500);
  });
  it("403 when the provided secret is wrong", async () => {
    process.env.WORKER_SECRET = "right-secret";
    expect((await post("wrong-secret")).status).toBe(403);
  });
  it("404 for an unknown document once the secret matches", async () => {
    process.env.WORKER_SECRET = "right-secret";
    expect((await post("right-secret")).status).toBe(404);
  });
});
```

- [ ] **Step 2:** Run and verify 3 pass (these paths short-circuit before any AI call). Then **Step 3: Commit** `test(web): /api/worker fail-closed secret + not-found`.

### Task A3: Happy-path route test via dependency injection

The route currently constructs `createAiClient()` + `new MarkitdownConverter()` internally, so the 202 path can't be tested without live AI. Introduce a thin injection seam.

**Files:** Modify `apps/web/lib/ingest-service.ts` (add a `Deps` type + factory default), modify `apps/web/app/api/ingest/route.ts` to read deps from a module-level override, create `apps/web/test/ingest-route-happy.test.ts`.

- [ ] **Step 1:** Add to `ingest-service.ts`:
```ts
import type { AiClient } from "@gr/ai";
import { createAiClient } from "@gr/ai";
import { MarkitdownConverter, type Converter } from "@gr/ingest";

export interface IngestDeps { ai: AiClient; converter: Converter; }
let depsOverride: IngestDeps | null = null;
export function __setIngestDeps(d: IngestDeps | null) { depsOverride = d; }
export function resolveIngestDeps(): IngestDeps {
  return depsOverride ?? { ai: createAiClient(), converter: new MarkitdownConverter() };
}
```
- [ ] **Step 2:** In `route.ts`, replace `createAiClient()` / `new MarkitdownConverter()` in the in-process branch with `const { ai, converter } = resolveIngestDeps();` … `await processJob(db, ai, converter, …)`.
- [ ] **Step 3:** Write `ingest-route-happy.test.ts` that calls `__setIngestDeps({ ai: createMockAiClient(), converter: new MockConverter() })`, posts a valid `{ kbId, text }` with a member token, asserts `202` and that the document reaches `ready` and is retrievable. Reset deps in `afterAll`.
- [ ] **Step 4:** Run (3-ish assertions) green; typecheck; **commit** `test(web): happy-path /api/ingest via injected mock deps`.

### Task A4: markitdown service functional test (Python)

**Files:** Create `services/convert/test_convert.py` (+ note it requires `pip install markitdown`).

- [ ] **Step 1:** Write a pytest that builds a tiny in-memory file (e.g. a small generated PDF or a `.docx`/`.txt`) and asserts `MarkItDown().convert(path).text_content` contains the expected text. Mark `@pytest.mark.skipif` when markitdown isn't importable so local Node-only runs don't fail.
- [ ] **Step 2:** Run `python3 -m pytest services/convert -q` (in CI on Python 3.11 with deps installed). **Commit** `test(convert): markitdown conversion smoke test`.

---

## Part B — Plan 2 (web app) testing strategy

To be written **inline** in the Plan 2 implementation plan (every feature task ships with its tests, TDD):

- **API route handlers** (`/api/search`, `/api/chat`, `/api/documents`, `/api/tokens`): handler tests via constructed `NextRequest` + the `IngestDeps`-style injection seam for AI. For streaming chat, assert the streamed chunks and that the final `messages` row + citations are persisted.
- **React components** (library list, search results, chat transcript, citation chips): Vitest + React Testing Library; render with seeded props, assert DOM and interaction. Snapshot only for stable presentational pieces.
- **Clerk auth**: use Clerk's testing tokens / test mode; a middleware test asserting unauthenticated requests redirect.
- **Import flow** (bookmarks / Pocket / Readwise): pure parser unit tests over fixture export files; one integration test that imports a fixture and asserts N documents enqueued.
- **Blob + Queues**: unit tests mock the Blob client and queue at their module boundary; a CI-gated integration test exercises real Vercel Blob upload/round-trip.
- **E2E**: Playwright against `next dev` with a seeded DB — sign in (Clerk test mode) → submit content → see it in the library → ask a question → see a cited answer.

## Part C — Plan 3 (capture clients) testing strategy

To be written inline in the Plan 3 plan:

- **WXT Chrome extension**: unit-test the DOM-capture/serialization and the ingest API client (mock `fetch`, assert payload shape + token header). WXT supports Vitest. E2E with Playwright loading the unpacked extension in a persistent Chromium context: open a fixture page, click the clip button, assert the ingest API was called with the captured DOM.
- **iOS Shortcut**: not automatable; ship a manual test checklist. Its server contract (the token-authenticated `/api/ingest` path) is already covered by Task A1/A3.
- **Android PWA share target**: unit-test the share-target route handler (multipart form → ingest); manifest validated in build.

## Part D — Continuous Integration

- **GitHub Actions** (`.github/workflows/ci.yml`): on PR — `pnpm install` (cached store) → start `pgvector/pgvector:pg17` as a service container → apply migration → `pnpm -r typecheck` → `pnpm test`. Required to merge.
- **Python job**: Python 3.11 → `pip install -r services/convert/requirements.txt` → `pytest services/convert`.
- **E2E job** (Plan 2+): Playwright with browsers cached; runs against a built app + seeded DB.

## Coverage goals (definition of done per phase)

- Every API route handler has auth + validation + authorization tests.
- Every pure function is unit-tested; every stateful module has one integration test.
- Each phase ships at least one e2e covering its headline flow.
- Security-relevant branches (authz, secret checks) always have an explicit negative test.
