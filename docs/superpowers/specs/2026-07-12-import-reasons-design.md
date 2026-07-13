# Import Reasons Design (why each bookmark was skipped / failed)

**Status:** Approved pending user review
**Date:** 2026-07-12

Show *why* a bookmark was skipped or failed during import (e.g. "Blocked by the site (403)", "Couldn't be reached (DNS)", "Rate-limited"), so the results list is diagnostic instead of a bare ✗/–.

## What's already available

The thrown errors already carry the detail — no new instrumentation of the pipeline is needed:

- `assertSafeHttpUrl` (`packages/ingest/src/url-safety.ts`) throws distinct messages: `unsupported url scheme`, `blocked host (private/loopback)` / `blocked private ip` / `blocked host resolving to private ip`, `dns lookup failed: <host>`, `invalid url`.
- `fetchUrlContent` (`fetch-url.ts`) throws `fetch failed <status> for <url>` (the HTTP status is in the message) and re-guards redirect targets.
- `runIngestion` (`pipeline.ts`) throws `no content to ingest`, `binary URL content is not supported yet`, `content too large (<n> bytes)`, and propagates `ai.embed` errors (rate limits). On any error it also marks the document `failed` (`setDocumentFailed`) then rethrows — so the route's `catch` receives the error.

## Architecture

### Shared classifier — `apps/web/lib/import-reason.ts` (pure, node-testable; client-safe)

```ts
export type ReasonCode =
  | "unreachable" | "private-address" | "unsupported-url"                 // skip reasons
  | "blocked" | "not-found" | "rate-limited" | "server-error"
  | "no-content" | "unsupported-content" | "too-large" | "error";         // fail reasons

export function classifyImportError(err: unknown): ReasonCode;
export const REASON_LABEL: Record<ReasonCode, string>;
```

`classifyImportError` lower-cases the error message and maps it to a code (checked in this order): `dns lookup failed`/`enotfound`/`getaddrinfo` → `unreachable`; `private`/`loopback`/`blocked host` → `private-address`; `unsupported url scheme`/`invalid url` → `unsupported-url`; `fetch failed <status>` → `blocked` (401/403) / `not-found` (404) / `rate-limited` (429) / `server-error` (≥500) / `error`; `no content to ingest` → `no-content`; `binary url content`/`not supported` → `unsupported-content`; `content too large`/`too large` → `too-large`; `rate`/`429`/`quota`/`resource_exhausted` → `rate-limited` (best-effort for AI/embedding limits); else `error`.

`REASON_LABEL` maps each code to friendly text: e.g. `unreachable`→"Couldn't be reached (DNS)", `private-address`→"Private or local address", `blocked`→"Blocked by the site (403)", `not-found`→"Not found (404)", `rate-limited`→"Rate-limited — try again later", `server-error`→"The site returned an error", `no-content`→"No readable text on the page", `unsupported-content`→"Unsupported content (e.g. a PDF link)", `too-large`→"Page too large", `unsupported-url`→"Unsupported link", `error`→"Couldn't fetch or process".

The server produces codes; the client renders labels. Codes are the stable contract.

### Server — `apps/web/app/api/import/bookmarks/route.ts`

Per item, build a `results` array of `{ url: string; outcome: "done" | "queued" | "skipped" | "failed"; reason?: ReasonCode }`:

- Replace the boolean `isSafeHttpUrl` pre-check with `assertSafeHttpUrl` in a try/catch. On throw → `skipped`, `reason = classifyImportError(e)`, and **no document is created** (unchanged behavior — unreachable/private bookmarks don't clutter the library). Empty `url` → `skipped`, `reason: "unsupported-url"`.
- Else enqueue + process inside a try/catch (unchanged in-process vs. worker branch). Success → `done` (in-process) or `queued` (async worker). On throw → `failed`, `reason = classifyImportError(e)`.

Response becomes `{ queued, skipped, failed, results }` (counts kept for compatibility; `results` is the new per-item detail). Note `assertSafeHttpUrl` is re-run inside `fetchUrlContent`, which is redundant for the original URL but still required there to re-guard redirect targets — the extra check is a cheap DNS lookup.

### Client — `apps/web/components/bookmark-import.tsx`

- Add `reasons: Record<string, ReasonCode>` alongside `statuses`.
- The pool worker reads `results[0]` from the response: set the item's status from `outcome` (`skipped`→"skipped", `failed`→"failed", else "done"), and if a `reason` is present, store it. A thrown fetch / `!res.ok` → status "failed" (no reason, or `"error"`).
- Each `failed`/`skipped` row renders the icon + title on the first line and a small muted second line `REASON_LABEL[reason]` when a reason exists. `done`/`pending`/`importing` rows are unchanged.

## Testing

- **`apps/web/test/import-reason.test.ts`** (node): `classifyImportError` maps representative messages to the right codes — `dns lookup failed: x`→`unreachable`, `blocked private ip: 10.0.0.1`→`private-address`, `fetch failed 403 for x`→`blocked`, `fetch failed 429 for x`→`rate-limited`, `fetch failed 500 for x`→`server-error`, `no content to ingest`→`no-content`, `binary URL content is not supported yet`→`unsupported-content`, an AI "rate limit exceeded" message→`rate-limited`, an unknown message→`error`.
- **`apps/web/test/import-bookmarks-route.test.ts`** (update): assert `results` — a private-IP item is `{ outcome: "skipped", reason: "private-address" }`; a mock `urlFetcher` that throws `fetch failed 403 for …` yields `{ outcome: "failed", reason: "blocked" }`; safe items are `{ outcome: "done" }`. Keep the existing count assertions (now via `toMatchObject`).
- **`apps/web/components/bookmark-import.test.tsx`** (update): the mixed done/failed test mocks a `results:[{ outcome:"failed", reason:"blocked" }]` response for one URL and asserts the label "Blocked by the site (403)" renders under that row.

## Out of scope

- **Retry failed** button (transient rate-limit/timeout retries) — deferred; dead domains/blocked sites wouldn't benefit anyway. Backlog.
- Changing the ingest pipeline's own error types (we classify from the existing messages).
- Deep AI-error categorization — embedding/AI errors are best-effort matched to `rate-limited` or fall through to `error`.

## Global constraints

- No change to `packages/ingest` or the SSRF/pipeline logic — reasons are derived from existing thrown messages.
- `classifyImportError` is pure string-matching (no node-only APIs) so it is safe in the client bundle; server and client both import from `lib/import-reason.ts`.
- The 50-cap, one-item-per-request client loop, `runPool` concurrency, and phase machine are unchanged.
- Tailwind v4; `@/` alias → `apps/web`. Component tests via `pnpm --filter @gr/web exec vitest run components/<file>`; node tests via `bash scripts/test.sh <path>`.
