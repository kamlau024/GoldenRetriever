# Import Reasons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show *why* each bookmark was skipped/failed during import (blocked 403, DNS, rate-limited, …).

**Architecture:** Task 1 adds a pure error → reason-code classifier + labels. Task 2 has the import endpoint categorize each item's skip/fail error and return a per-item `results` array. Task 3 shows the reason under each failed/skipped row.

**Tech Stack:** Next.js 15, React 19, Tailwind v4, Vitest (node + jsdom).

## Global Constraints

- No change to `packages/ingest` or the SSRF/pipeline logic — reasons are derived from the existing thrown messages.
- `classifyImportError` is pure string-matching (no node-only APIs), safe in the client bundle; server and client both import from `@/lib/import-reason`.
- Reason **codes** are the stable server↔client contract; the client maps codes → labels via `REASON_LABEL`. Label strings must match exactly (tests assert them).
- The 50-cap, one-item-per-request client loop, `runPool`, and phase machine are unchanged.
- `@/` alias → `apps/web`. Component tests: `pnpm --filter @gr/web exec vitest run components/<file>`. Node tests: `bash scripts/test.sh <path>`.

---

### Task 1: `import-reason.ts` classifier + labels

**Files:**
- Create: `apps/web/lib/import-reason.ts`
- Test: `apps/web/test/import-reason.test.ts`

**Interfaces:**
- Produces `type ReasonCode`, `classifyImportError(err: unknown): ReasonCode`, `REASON_LABEL: Record<ReasonCode, string>` (consumed by Tasks 2 & 3).

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/import-reason.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyImportError, REASON_LABEL } from "../lib/import-reason.js";

describe("classifyImportError", () => {
  const cases: [string, string][] = [
    ["dns lookup failed: old.example", "unreachable"],
    ["blocked private ip: 10.0.0.1", "private-address"],
    ["blocked host (private/loopback): localhost", "private-address"],
    ["unsupported url scheme: ftp:", "unsupported-url"],
    ["fetch failed 403 for https://x", "blocked"],
    ["fetch failed 401 for https://x", "blocked"],
    ["fetch failed 404 for https://x", "not-found"],
    ["fetch failed 429 for https://x", "rate-limited"],
    ["fetch failed 503 for https://x", "server-error"],
    ["no content to ingest", "no-content"],
    ["binary URL content is not supported yet (Plan 2c)", "unsupported-content"],
    ["content too large (12345678 bytes)", "too-large"],
    ["Rate limit exceeded, please retry", "rate-limited"],
    ["something totally unexpected", "error"],
  ];
  it.each(cases)("maps %j → %s", (message, expected) => {
    expect(classifyImportError(new Error(message))).toBe(expected);
  });
  it("handles non-Error values", () => {
    expect(classifyImportError("plain string")).toBe("error");
  });
  it("has a label for every reason code", () => {
    for (const [, code] of cases) expect(REASON_LABEL[code as keyof typeof REASON_LABEL]).toBeTruthy();
    expect(REASON_LABEL.blocked).toBe("Blocked by the site (403)");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash scripts/test.sh apps/web/test/import-reason.test.ts`
Expected: FAIL — `Cannot find module '../lib/import-reason.js'`.

- [ ] **Step 3: Implement**

Create `apps/web/lib/import-reason.ts`:

```ts
export type ReasonCode =
  | "unreachable" | "private-address" | "unsupported-url"
  | "blocked" | "not-found" | "rate-limited" | "server-error"
  | "no-content" | "unsupported-content" | "too-large" | "error";

/** Map a thrown ingest/import error to a stable reason code (from the message text). */
export function classifyImportError(err: unknown): ReasonCode {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();

  if (msg.includes("dns lookup failed") || msg.includes("enotfound") || msg.includes("getaddrinfo")) return "unreachable";
  if (msg.includes("private") || msg.includes("loopback") || msg.includes("blocked host")) return "private-address";
  if (msg.includes("unsupported url scheme") || msg.includes("invalid url")) return "unsupported-url";

  const status = msg.match(/fetch failed (\d{3})/);
  if (status) {
    const code = Number(status[1]);
    if (code === 401 || code === 403) return "blocked";
    if (code === 404) return "not-found";
    if (code === 429) return "rate-limited";
    if (code >= 500) return "server-error";
    return "error";
  }

  if (msg.includes("no content to ingest")) return "no-content";
  if (msg.includes("binary url content") || msg.includes("not supported")) return "unsupported-content";
  if (msg.includes("content too large") || msg.includes("too large")) return "too-large";
  if (msg.includes("rate") || msg.includes("429") || msg.includes("quota") || msg.includes("resource_exhausted")) return "rate-limited";

  return "error";
}

export const REASON_LABEL: Record<ReasonCode, string> = {
  "unreachable": "Couldn't be reached (DNS)",
  "private-address": "Private or local address",
  "unsupported-url": "Unsupported link",
  "blocked": "Blocked by the site (403)",
  "not-found": "Not found (404)",
  "rate-limited": "Rate-limited — try again later",
  "server-error": "The site returned an error",
  "no-content": "No readable text on the page",
  "unsupported-content": "Unsupported content (e.g. a PDF link)",
  "too-large": "Page too large",
  "error": "Couldn't fetch or process",
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/test.sh apps/web/test/import-reason.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/import-reason.ts apps/web/test/import-reason.test.ts
git commit -m "feat(web): import error → reason-code classifier + labels"
```

---

### Task 2: Endpoint returns per-item `results` with reasons

**Files:**
- Modify: `apps/web/app/api/import/bookmarks/route.ts`
- Test: `apps/web/test/import-bookmarks-route.test.ts`

**Interfaces:**
- Consumes `classifyImportError` / `ReasonCode` from `@/lib/import-reason` (Task 1) and `assertSafeHttpUrl` from `@gr/ingest`.
- Produces response `{ queued, skipped, failed, results: { url: string; outcome: "done"|"queued"|"skipped"|"failed"; reason?: ReasonCode }[] }`.

- [ ] **Step 1: Update the tests**

In `apps/web/test/import-bookmarks-route.test.ts`:

Change the "enqueues safe URLs" assertions to check `results` (replace that test body):

```ts
  it("enqueues safe URLs, skips unsafe ones with a reason, and creates documents", async () => {
    const good = safe();
    const res = await post({ kbId, items: [{ url: good, title: "Good Page" }, { url: safe() }, { url: UNSAFE }] }, token);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ queued: 2, skipped: 1, failed: 0 });
    expect(body.results.find((r: { url: string }) => r.url === UNSAFE)).toMatchObject({ outcome: "skipped", reason: "private-address" });
    expect(body.results.find((r: { url: string }) => r.url === good)).toMatchObject({ outcome: "done" });
    const docs = await db.select().from(schema.documents).where(eq(schema.documents.sourceUrl, good));
    expect(docs).toHaveLength(1);
    expect(docs[0].kind).toBe("web");
    expect(docs[0].title).toBe("Good Page");
  });
```

Replace the "counts a URL whose processing throws" test so the failure carries a reason:

```ts
  it("marks a URL whose fetch is blocked as failed with a reason, without failing the whole import", async () => {
    __setIngestDeps({
      ai: createMockAiClient(), converter: new MockConverter(),
      urlFetcher: async (u: string) => { if (u.includes("bad")) throw new Error(`fetch failed 403 for ${u}`); return { kind: "text" as const, mimeType: "text/plain", text: "hi" }; },
    });
    const good = `http://93.184.216.34/good-${randomUUID()}`;
    const bad = `http://93.184.216.34/bad-${randomUUID()}`;
    const res = await post({ kbId, items: [{ url: good }, { url: bad }] }, token);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ queued: 1, skipped: 0, failed: 1 });
    expect(body.results.find((r: { url: string }) => r.url === bad)).toMatchObject({ outcome: "failed", reason: "blocked" });
    __setIngestDeps(okDeps()); // restore for any later tests
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `bash scripts/test.sh apps/web/test/import-bookmarks-route.test.ts`
Expected: FAIL — the response has no `results` field yet.

- [ ] **Step 3: Update the route**

In `apps/web/app/api/import/bookmarks/route.ts`:

Change the ingest-safety import from `isSafeHttpUrl` to `assertSafeHttpUrl`, and add the classifier import:

```ts
import { assertSafeHttpUrl } from "@gr/ingest";
import { classifyImportError, type ReasonCode } from "../../../../lib/import-reason.js";
```

Replace the loop + return (from `let queued = 0;` through the final `return`) with:

```ts
  let queued = 0;
  let skipped = 0;
  let failed = 0;
  const results: { url: string; outcome: "done" | "queued" | "skipped" | "failed"; reason?: ReasonCode }[] = [];

  for (const item of items) {
    const url = typeof item?.url === "string" ? item.url.trim() : "";
    if (!url) { skipped++; results.push({ url: "", outcome: "skipped", reason: "unsupported-url" }); continue; }

    // Safety / reachability pre-check — a throw here means we never fetch, and no document is created.
    try { await assertSafeHttpUrl(url); }
    catch (e) { skipped++; results.push({ url, outcome: "skipped", reason: classifyImportError(e) }); continue; }

    const title = typeof item?.title === "string" && item.title.trim() ? item.title.trim().slice(0, 300) : null;
    try {
      const { documentId, jobId } = await enqueueIngestion(db, {
        kbId, addedBy: principal.userId, captureMode: "url_fetch", kind: "web", mimeType: null,
        sourceUrl: url, title, rawContent: "",
      });
      if (base) {
        void fetch(`${base}/api/worker`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-worker-secret": process.env.WORKER_SECRET ?? "" },
          body: JSON.stringify({ jobId, documentId }),
        });
        results.push({ url, outcome: "queued" });
      } else {
        // In-process: a single page that blocks bots, times out, or yields no text must not fail the whole
        // import — record why and move on.
        await processJob(db, deps!.ai, deps!.converter, deps!.urlFetcher, {
          documentId, kbId, mimeType: null, text: "", sourceUrl: url, filename: title,
        });
        results.push({ url, outcome: "done" });
      }
      queued++;
    } catch (e) {
      failed++;
      results.push({ url, outcome: "failed", reason: classifyImportError(e) });
    }
  }
  return NextResponse.json({ queued, skipped, failed, results }, { status: 202 });
```

(The `isSafeHttpUrl` import is now unused — remove it; `assertSafeHttpUrl` replaces it.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bash scripts/test.sh apps/web/test/import-bookmarks-route.test.ts`
Expected: PASS (all cases, including the new `results`/reason assertions).

- [ ] **Step 5: Typecheck & commit**

```bash
pnpm --filter @gr/web typecheck
git add apps/web/app/api/import/bookmarks/route.ts apps/web/test/import-bookmarks-route.test.ts
git commit -m "feat(web): import endpoint returns per-item outcome + reason"
```

---

### Task 3: Show the reason under failed/skipped rows

**Files:**
- Modify: `apps/web/components/bookmark-import.tsx`
- Test: `apps/web/components/bookmark-import.test.tsx`

**Interfaces:**
- Consumes `REASON_LABEL` / `ReasonCode` from `@/lib/import-reason` and the endpoint's `results[0]` (Task 2).

- [ ] **Step 1: Update the tests**

In `apps/web/components/bookmark-import.test.tsx`, update the `beforeEach` default mock and the mixed done/failed test to the `results` shape.

Replace the `beforeEach` line with:

```tsx
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ queued: 1, skipped: 0, failed: 0, results: [{ outcome: "done" }] }) }) as Response)));
```

Replace the "shows per-bookmark done and failed statuses" test with:

```tsx
  it("shows per-bookmark done/failed status and the failure reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const item = JSON.parse(String(init.body)).items[0];
      const failed = item.url.includes("b.example");
      return { ok: true, json: async () => (failed
        ? { queued: 0, skipped: 0, failed: 1, results: [{ url: item.url, outcome: "failed", reason: "blocked" }] }
        : { queued: 1, skipped: 0, failed: 0, results: [{ url: item.url, outcome: "done" }] }) } as Response;
    }));
    render(<BookmarkImport kbId="kb1" />);
    uploadFile(SAMPLE);
    fireEvent.click(await screen.findByRole("button", { name: /Import 2/ }));
    expect(await screen.findByRole("img", { name: "done" })).toBeTruthy();
    expect(await screen.findByRole("img", { name: "failed" })).toBeTruthy();
    expect(await screen.findByText("Blocked by the site (403)")).toBeTruthy();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @gr/web exec vitest run components/bookmark-import.test.tsx`
Expected: FAIL — no "Blocked by the site (403)" text is rendered (the component ignores `results`/reasons).

- [ ] **Step 3: Wire reasons into the component**

In `apps/web/components/bookmark-import.tsx`:

Add the import:
```tsx
import { REASON_LABEL, type ReasonCode } from "@/lib/import-reason";
```

Add reasons state next to `statuses`:
```tsx
  const [reasons, setReasons] = useState<Record<string, ReasonCode>>({});
```

In `doImport`, reset reasons at the start (next to `setStatuses(...)`/`setCompleted(0)`):
```tsx
    setReasons({});
```
and replace the pool worker body with one that reads `results[0]`:
```tsx
    const setStatus = (url: string, s: ItemStatus) => setStatuses((m) => ({ ...m, [url]: s }));
    await runPool(items, IMPORT_CONCURRENCY, async (item) => {
      setStatus(item.url, "importing");
      try {
        const res = await fetch("/api/import/bookmarks", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ kbId, items: [item] }),
        });
        if (!res.ok) throw new Error();
        const body = await res.json() as { results?: { outcome: string; reason?: ReasonCode }[] };
        const r = body.results?.[0];
        const status: ItemStatus = r?.outcome === "skipped" ? "skipped" : r?.outcome === "failed" ? "failed" : "done";
        setStatus(item.url, status);
        if (r?.reason && (status === "failed" || status === "skipped")) {
          setReasons((m) => ({ ...m, [item.url]: r.reason! }));
        }
      } catch {
        setStatus(item.url, "failed");
      } finally {
        setCompleted((c) => c + 1);
      }
    });
```

In `reset()`, also clear reasons — add `setReasons({});` to the existing resets.

Replace the per-bookmark progress row (the `importItems.map(...)` block inside the progress view) with a two-line row that shows the reason:
```tsx
              {importItems.map((i) => {
                const status = statuses[i.url] ?? "pending";
                const reason = reasons[i.url];
                return (
                  <div key={i.url} className="flex items-start gap-2 rounded px-2 py-1.5 text-sm">
                    <StatusIcon status={status} />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate">{i.title}</span>
                      {reason && (status === "failed" || status === "skipped") && (
                        <span className="block text-xs text-muted-foreground">{REASON_LABEL[reason]}</span>
                      )}
                    </div>
                  </div>
                );
              })}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @gr/web exec vitest run components/bookmark-import.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck & commit**

```bash
pnpm --filter @gr/web typecheck
git add apps/web/components/bookmark-import.tsx apps/web/components/bookmark-import.test.tsx
git commit -m "feat(web): show the skip/fail reason under each import row"
```

---

## Final verification (before finishing the branch)

- [ ] Full node/DB suite: `bash scripts/test.sh` — all green.
- [ ] Full component suite: `pnpm --filter @gr/web exec vitest run` — all green.
- [ ] Typecheck: `pnpm --filter @gr/web typecheck` — clean.
- [ ] Manual: import bookmarks including a known-blocked site, a dead domain, and a localhost URL → the failed/skipped rows show "Blocked by the site (403)", "Couldn't be reached (DNS)", "Private or local address" respectively.
```
