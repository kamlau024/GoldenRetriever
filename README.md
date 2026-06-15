# GoldenRetriever

Clip → ingest → ask, for a single user's personal knowledge base. Stage 0 backend core
(Plan 1) plus the web app's thin usable slice (Plan 2a): Clerk auth, library, add-content,
and streaming grounded chat with citations. Capture clients (extension, iOS Shortcut) are
Plan 3.

## Develop

```bash
pnpm install
pnpm test          # equivalent to ./scripts/test.sh
```

`pnpm test` runs [`scripts/test.sh`](scripts/test.sh): it starts the Postgres 17 +
pgvector test database (Docker, port 5433), applies the schema on first run, and
runs the full Vitest suite. Requires Docker running.

Scope a run by passing args straight through to vitest:

```bash
pnpm test packages/retrieval      # one package
pnpm test -t "IDOR"               # by test name
```

`pnpm test:raw` runs vitest only (no DB setup) — for CI where the database is
provisioned separately. `pnpm db:down` tears down the test database. A full `pnpm test`
also runs the web component tests (jsdom) via the app-local vitest config.

## Run the web app (local)

1. Create a free Clerk dev instance and put the keys in `apps/web/.env.local`:
   ```bash
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
   CLERK_SECRET_KEY=sk_test_...
   DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test
   AI_GATEWAY_API_KEY=...   # a Vercel AI Gateway key (real, for live embeddings/generation)
   ```
2. Start the database and dev server:
   ```bash
   pnpm db:up
   cat packages/db/drizzle/0000_*.sql | docker compose -f docker-compose.test.yml exec -T db psql -U gr -d gr_test
   pnpm --filter @gr/web dev
   ```
3. Sign up, then on the Library page paste a paragraph or **submit a URL** (the page is
   fetched and parsed server-side; only public http(s) URLs are accepted). Use the **Search**
   page to find passages, **Chat** to ask a question and get a streamed, grounded answer with
   **live citation chips**, and the **Delete** button to remove a document. Binary file upload
   (PDF/Office via Blob + the markitdown service) and deployment are Plan 2c; document
   refresh/RSS is Stage 3.

> Note: the automated test suite needs **no Clerk keys** — every route is covered through the
> API-token auth path with injected mock AI. Clerk keys are only needed to run the UI.

## Packages

- `@gr/config` — zod env schema (configurable model providers via AI Gateway)
- `@gr/core` — shared domain types (`IngestInput`, `RankedChunk`, `ConvertedContent`)
- `@gr/db` — Drizzle schema (multi-tenant + pgvector) and kb-scoped query helpers
- `@gr/ingest` — format router + Readability extraction + chunker + ingestion pipeline
- `@gr/ai` — model config + `AiClient` (embed / tag / answer / rerank) via AI Gateway, with a deterministic mock
- `@gr/retrieval` — `Retriever` interface + `HybridRetriever` (pgvector + FTS + RRF + rerank)
- `@gr/web` — Next.js app: ingest/worker/chat APIs + Clerk auth, library, add-content, and chat UI (Plan 2a)

## Services

- `services/convert` — **markitdown** Python function (Vercel Fluid Compute) converting PDF/Office/image documents to markdown. Deployed separately; the worker calls it via `MARKITDOWN_URL`.

## Architecture & plans

- Design spec: `docs/superpowers/specs/2026-06-14-goldenretriever-architecture-design.md`
- Plan 1 — backend core: `docs/superpowers/plans/2026-06-14-goldenretriever-stage0-backend-core.md`
- Plan 2a — web app (thin slice): `docs/superpowers/plans/2026-06-14-goldenretriever-plan2a-web-app.md`
- Testing plan: `docs/superpowers/plans/2026-06-14-goldenretriever-testing-plan.md`
