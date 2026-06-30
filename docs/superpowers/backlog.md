# GoldenRetriever — Backlog / Deferred Work

Living list of outstanding work, so nothing planned-but-skipped gets lost. Updated 2026-06-30.

## In progress (this round)
- [x] **Real reranking** — replace the identity no-op with an LLM reranker. *(building)*
- [x] **Surface tags** — store `ai.tag()` output + show tags in the Library. *(building)*

## Deferred — agreed to do later (user, 2026-06-29)

### 3. Security cleanups
- **Remove the `?token=` URL fallback** on `GET /api/capture` (token lands in server access logs).
  Keep only the `Authorization: Bearer` header path once the iOS Shortcut is confirmed on the header.
- **SSRF DNS-rebind (TOCTOU)** — `assertSafeHttpUrl` resolves+checks the IP, but the subsequent
  `fetch` can resolve to a different IP. Pin the resolved IP for the actual request.
- **Latent `@vercel/blob` `get`** — `VercelBlobStore.get` imports a `get` that may not exist; only the
  async worker / future re-ingestion path uses it (upload processes in-process), so it's untested.
- **`documents.added_by` has no `onDelete` cascade** — deleting a user is blocked by their documents
  (surfaced during a cleanup). Add a cascade or null-on-delete before any user-deletion flow.

### 4. Tests / CI
- **GitHub Actions CI** (run `scripts/test.sh` + typecheck on push).
- **Playwright e2e smoke** (sign in → save → search → chat).
- **markitdown pytest** for `services/convert` (the test runner has a commented-out hook).

## Outstanding from Stage 0 (planned in the architecture, not yet built)
- **Browser extension** (Chrome MV3 via WXT) — captures the authenticated rendered DOM. `full_dom`
  capture mode + `apps/extension` are seams only.
- **Bulk import** (bookmarks / Pocket / Readwise export → same ingest pipeline).
- **Android PWA share target** (iOS Share Sheet is done).
- **Durable async via Vercel Queues** — currently in-process / Next.js `after()`. Fine for one user;
  fragile under load. The `ingestion_jobs` table + worker route already exist as the seam.

## Polish / ops
- **Chat history UI** *(near-term — building now, 2026-06-30)* — the backend already persists every
  turn (`conversations` + `messages` tables; `/api/chat` writes both and accepts an optional
  `conversationId` to continue a thread). What's missing is the read-back: a conversation
  list/sidebar, resume an existing thread, start-new, and delete. Mostly frontend + a couple of
  list/load queries. Does **not** change what the model sees — that's "conversational memory" below.
- **Custom domain** (currently `goldenretriever-web.vercel.app`).
- **`apple-icon.png`** (favicon `icon.svg` is done; iOS touch icon is a PNG follow-up).
- **Live "processing → ready" auto-refresh** in the Library (no manual reload).
- **GR_TAGGING_MODEL** is `gpt-4o-mini`; revisit now that paid credits unlock better models.

## Future stages (roadmap — `specs/2026-06-14-goldenretriever-architecture-design.md`)
- **Conversational memory** *(design in progress, 2026-06-30 — spec to land in `specs/`)* — two layers:
  (a) **within-conversation** memory so follow-ups work (feed prior turns of the active thread to the
  model); (b) **across-conversation long-term memory** (durable user facts/preferences + retrieval over
  past chats). Builds on the existing `conversations`/`messages` tables and the chat-history UI above.
- **Stage 1 — Collaboration:** shared KBs, per-contributor attribution UI, @GoldenRetriever chatroom.
- **Stage 2 — Knowledge graph** (LazyGraphRAG, paid-gated) + research-report generation.
- **Stage 3 — Refresh & feeds:** document re-ingest, per-doc polling, RSS/Atom/sitemap subscriptions,
  spaced resurfacing, MCP endpoint, native mobile apps, audio/video transcription.
- **Stage 4 — Team/Enterprise:** SSO/SAML/SCIM, RBAC, Postgres RLS (hard tenant isolation),
  SOC 2, admin console, audit logs.
