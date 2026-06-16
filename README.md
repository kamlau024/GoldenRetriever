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
3. Sign up, then on the Library page paste a paragraph, **submit a URL** (the page is
   fetched and parsed server-side; only public http(s) URLs are accepted), or **upload a
   PDF/doc/image** (stored to blob storage and converted via the markitdown service). Use the
   **Search** page to find passages, **Chat** to ask a question and get a streamed, grounded
   answer with **live citation chips**, and the **Delete** button to remove a document.
   Document refresh/RSS is Stage 3.

> Note: the automated test suite needs **no Clerk keys, no Blob token, and no markitdown
> service** — every route is covered through the API-token auth path with injected mocks
> (`MockConverter`, `InMemoryBlobStore`, mock AI). Those are only needed to run the UI live.

## Deploy (remaining work)

Not yet done (needs cloud accounts / interactive logins):
- Install the Vercel CLI (`npm i -g vercel`) and provision Vercel + Neon (Postgres+pgvector) + Clerk + AI Gateway + Blob via the Marketplace.
- Deploy `services/convert` (the markitdown Python function) as its own Vercel project.
- Set env: `BLOB_READ_WRITE_TOKEN`, `MARKITDOWN_URL`, `MARKITDOWN_SECRET`, `WORKER_SECRET`, `APP_URL`, Clerk keys, `AI_GATEWAY_API_KEY`, `DATABASE_URL`.
- Hardening: SSRF IP-pinning (TOCTOU) for the URL fetcher, and a Playwright e2e suite.

Binary upload is **code-complete and tested with mocks**; the live PDF→markdown conversion is verified once the markitdown service is reachable.

## Packages

- `@gr/config` — zod env schema (configurable model providers via AI Gateway)
- `@gr/core` — shared domain types (`IngestInput`, `RankedChunk`, `ConvertedContent`)
- `@gr/db` — Drizzle schema (multi-tenant + pgvector) and kb-scoped query helpers
- `@gr/ingest` — format router + Readability extraction + chunker + ingestion pipeline
- `@gr/ai` — model config + `AiClient` (embed / tag / answer / rerank) via AI Gateway, with a deterministic mock
- `@gr/retrieval` — `Retriever` interface + `HybridRetriever` (pgvector + FTS + RRF + rerank)
- `@gr/web` — Next.js app: ingest/worker/chat/search/upload/delete APIs + Clerk auth and the library/search/chat UI (Plans 2a–2c)

## Services

- `services/convert` — **markitdown** Python function (Vercel Fluid Compute) converting PDF/Office/image documents to markdown. Deployed separately; the worker calls it via `MARKITDOWN_URL`.

## Architecture & plans

- Design spec: `docs/superpowers/specs/2026-06-14-goldenretriever-architecture-design.md`
- Plan 1 — backend core: `docs/superpowers/plans/2026-06-14-goldenretriever-stage0-backend-core.md`
- Plan 2a — web app (thin slice): `docs/superpowers/plans/2026-06-14-goldenretriever-plan2a-web-app.md`
- Plan 2b — web core completion: `docs/superpowers/plans/2026-06-15-goldenretriever-plan2b-web-core-completion.md`
- Plan 2c — binary file upload: `docs/superpowers/plans/2026-06-16-goldenretriever-plan2c-binary-upload.md`
- Testing plan: `docs/superpowers/plans/2026-06-14-goldenretriever-testing-plan.md`
