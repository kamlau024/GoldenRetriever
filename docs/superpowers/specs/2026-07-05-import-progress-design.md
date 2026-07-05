# Import Progress Design (per-bookmark status + overall bar)

**Status:** Approved pending user review
**Date:** 2026-07-05

Show live progress while importing bookmarks: an overall progress bar with a count, plus a per-bookmark status list (waiting → importing → done / failed). Driven client-side by importing one bookmark per request, so progress is observable as each resolves.

## Why the flow changes

Today `doImport` sends a single bulk `POST /api/import/bookmarks` that processes every URL server-side and returns aggregate counts once — the client can't observe per-item progress. To show progress, the client drives the loop: it POSTs **one bookmark at a time** (the existing endpoint accepts a one-item `items` array and returns `{ queued, skipped, failed }` for that item), updating that bookmark's status and the overall bar as each request resolves. **No server change.** Bonus: each request is short, removing the single-request timeout risk of a 50-item bulk import.

## Architecture

### `runPool` helper (`apps/web/lib/pool.ts`)

A tiny bounded-concurrency runner (pure, node-testable):

```ts
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void>;
```

Runs at most `limit` workers concurrently, each pulling the next item until the list is exhausted; resolves when all are done. Used to import ~4 bookmarks at a time (each URL is fetched+converted+embedded in-process ~2–5s; sequential would take minutes for a 50-item import, so a small pool keeps it to tens of seconds while staying gentle on the free-tier AI rate limits).

### `bookmark-import.tsx` changes

A phase state replaces the single-shot import:

- `phase: "select" | "running" | "finished"` (default `"select"`).
- `statuses: Record<string, ItemStatus>` keyed by URL, where `ItemStatus = "pending" | "importing" | "done" | "failed" | "skipped"`.
- `completed: number`.

**`doImport()`** (select → running):
- `const items = entries.filter(e => selected.has(e.url)).map(e => ({ url: e.url, title: e.title }))`.
- `setPhase("running")`; initialize every item's status to `"pending"`; `completed = 0`.
- `await runPool(items, IMPORT_CONCURRENCY /* = 4 */, async (item) => { … })`, where the worker:
  - sets the item's status to `"importing"`;
  - `POST /api/import/bookmarks` with `{ kbId, items: [item] }`;
  - on `res.ok`, reads `{ queued, skipped, failed }` → status `queued > 0 ? "done" : skipped > 0 ? "skipped" : "failed"`;
  - on `!res.ok` or a thrown fetch → `"failed"`;
  - `finally` increments `completed`.
- After the pool resolves: `setPhase("finished")`, `router.refresh()` (so the Library shows the new documents).

**Progress view (phase `running` | `finished`)** replaces the folder tree:
- An **overall progress bar** (`role="progressbar"`, `aria-valuenow={completed}`, `aria-valuemax={total}`) filled to `completed / total`, with a count: `"Importing {completed} / {total}…"` while running; `"Imported {doneCount} page(s)"` + a failed/skipped tally when finished.
- A **scrollable per-bookmark list** (reusing the `max-h-72 overflow-y-auto` container from the recent scroll fix): each selected bookmark shows a status icon + its title. Icons (lucide, each with `aria-label={status}` so it's testable/accessible): `pending`→`Clock` (muted), `importing`→`Loader2` (`animate-spin`, amber), `done`→`Check` (green), `failed`→`X` (destructive), `skipped`→`Minus` (muted).
- When `finished`: a **Done** button resets to `select` (`setEntries(null)`, `setFile(null)`, `setPhase("select")`, clear `statuses`). The `FileDropzone` is passed `disabled` while `phase !== "select"` so the file can't be swapped mid-import.

The existing `select` phase (folder tree + "Import N pages" button) is unchanged except that clicking Import now enters `running`. The 50-selection cap stays (each request still sends a single item).

## Testing

- **`apps/web/test/pool.test.ts`** (node): `runPool` processes every item exactly once; never exceeds `limit` concurrent workers (track a live counter); resolves after all complete.
- **`apps/web/components/bookmark-import.test.tsx`** (update): after upload + Import, assert the client POSTs `/api/import/bookmarks` **once per selected bookmark** (each with a one-item body); the overall bar reaches `total/total`; a mock returning `failed:1` for one URL renders a `failed` status and a done status for the other, and the finished summary reflects the counts.

## Out of scope

- Canceling an in-progress import (follow-up; in-flight requests would need `AbortController`).
- Real server-pushed progress (SSE/streaming) — the per-request client loop is sufficient and simpler.
- A shared `Progress` UI primitive — the one determinate bar here is inlined (YAGNI; the File tab's indeterminate bar is separate). Extract only when a second consumer appears.
- Retrying failed bookmarks from the results list.

## Global constraints

- No change to `/api/import/bookmarks` or any server code; the client is untrusted and the server already enforces auth/SSRF/validation per request.
- Reuse existing primitives (`Button`, lucide icons, `cn`); native Tailwind progress bar (no new dependency). base-ui via `render`/props, never `asChild`.
- `IMPORT_CONCURRENCY = 4`, defined once in `bookmark-import.tsx`.
- Tailwind v4; `@/` alias → `apps/web`. Component tests via `pnpm --filter @gr/web exec vitest run components/<file>`; node tests via `bash scripts/test.sh <path>`.
