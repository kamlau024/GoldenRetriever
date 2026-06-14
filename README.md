# GoldenRetriever — Stage 0 Backend Core

Clip → ingest → ask, for a single user's personal knowledge base. This is **Plan 1 of 3** (backend core); the web UI and capture clients (extension, iOS Shortcut) follow in Plans 2 and 3.

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
provisioned separately. `pnpm db:down` tears down the test database.

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
