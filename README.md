# GoldenRetriever — Stage 0 Backend Core

Clip → ingest → ask, for a single user's personal knowledge base. This is **Plan 1 of 3** (backend core); the web UI and capture clients (extension, iOS Shortcut) follow in Plans 2 and 3.

## Develop

1. `pnpm install`
2. `pnpm db:up` (Postgres 17 + pgvector on port 5433)
3. Apply the schema:
   ```bash
   cat packages/db/drizzle/0000_*.sql | docker compose -f docker-compose.test.yml exec -T db psql -U gr -d gr_test
   ```
4. Run the tests:
   ```bash
   DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test AI_GATEWAY_API_KEY=test pnpm test
   ```

## Packages

- `@gr/config` — zod env schema (configurable model providers via AI Gateway)
- `@gr/core` — shared domain types (`IngestInput`, `RankedChunk`, `ConvertedContent`)
- `@gr/db` — Drizzle schema (multi-tenant + pgvector) and kb-scoped query helpers
- `@gr/ingest` — format router + Readability extraction + chunker + ingestion pipeline
- `@gr/ai` — model config + `AiClient` (embed / tag / answer / rerank) via AI Gateway, with a deterministic mock
- `@gr/retrieval` — `Retriever` interface + `HybridRetriever` (pgvector + FTS + RRF + rerank)
- `@gr/web` — Next.js ingest API + worker (Plan 2 adds UI, Clerk, chat)

## Services

- `services/convert` — **markitdown** Python function (Vercel Fluid Compute) converting PDF/Office/image documents to markdown. Deployed separately; the worker calls it via `MARKITDOWN_URL`.

## Architecture & plan

- Design spec: `docs/superpowers/specs/2026-06-14-goldenretriever-architecture-design.md`
- Implementation plan: `docs/superpowers/plans/2026-06-14-goldenretriever-stage0-backend-core.md`
