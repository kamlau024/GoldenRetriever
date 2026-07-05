# Import Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show live per-bookmark import progress (status per bookmark + an overall bar) by importing one bookmark per request from the client.

**Architecture:** Task 1 adds a bounded-concurrency `runPool` helper. Task 2 rewrites `bookmark-import.tsx`'s import from a single bulk POST into a client-driven pool that POSTs one bookmark at a time to the existing endpoint, updating per-item status + an overall bar. No server change.

**Tech Stack:** Next.js 15, React 19, Tailwind v4, Vitest (node + jsdom), lucide-react.

## Global Constraints

- No change to `/api/import/bookmarks` or any server code — the client loops over the existing endpoint (one-item `items` array per request). Server already enforces auth/SSRF/validation.
- `IMPORT_CONCURRENCY = 4`, defined once in `bookmark-import.tsx`.
- Reuse `Button`, lucide icons, `cn`; native Tailwind progress bar (no new dependency); the `max-h-72 overflow-y-auto` scroll container from the recent fix.
- Status icons carry `aria-label={status}` (accessible + testable). The overall bar is `role="progressbar"` with `aria-valuenow/min/max`.
- `@/` alias → `apps/web`. Component tests: `pnpm --filter @gr/web exec vitest run components/<file>`. Node tests: `bash scripts/test.sh <path>`.

---

### Task 1: `runPool` bounded-concurrency helper

**Files:**
- Create: `apps/web/lib/pool.ts`
- Test: `apps/web/test/pool.test.ts`

**Interfaces:**
- Produces `runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void>` (consumed by Task 2).

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/pool.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runPool } from "../lib/pool.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("runPool", () => {
  it("processes every item exactly once", async () => {
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5], 2, async (n) => { seen.push(n); });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("never exceeds the concurrency limit but does run concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    await runPool(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      active++; maxActive = Math.max(maxActive, active);
      await delay(5);
      active--;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("resolves immediately for an empty list and never calls the worker", async () => {
    await expect(runPool([], 4, async () => { throw new Error("should not run"); })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash scripts/test.sh apps/web/test/pool.test.ts`
Expected: FAIL — `Cannot find module '../lib/pool.js'`.

- [ ] **Step 3: Implement**

Create `apps/web/lib/pool.ts`:

```ts
/** Run `worker` over `items` with at most `limit` concurrent workers; resolves when all complete. */
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const runNext = async (): Promise<void> => {
    const i = index++;
    if (i >= items.length) return;
    await worker(items[i]);
    await runNext();
  };
  const workers = Math.min(Math.max(limit, 1), items.length);
  await Promise.all(Array.from({ length: workers }, () => runNext()));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/test.sh apps/web/test/pool.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/pool.ts apps/web/test/pool.test.ts
git commit -m "feat(web): runPool bounded-concurrency helper"
```

---

### Task 2: Per-bookmark import progress in `bookmark-import.tsx`

**Files:**
- Modify: `apps/web/components/bookmark-import.tsx` (full replacement below)
- Test: `apps/web/components/bookmark-import.test.tsx`

**Interfaces:**
- Consumes `runPool` from `@/lib/pool` (Task 1) and the existing `POST /api/import/bookmarks` (one-item body → `{ queued, skipped, failed }`).

- [ ] **Step 1: Update the tests**

Replace the body of `apps/web/components/bookmark-import.test.tsx` (keep the top `vi.mock` lines and the `SAMPLE`/`uploadFile` helpers) so the import expectations match the per-item loop. The full file:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { BookmarkImport } from "./bookmark-import.js";

const SAMPLE = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
<DT><A HREF="https://a.example/1">Alpha</A>
<DT><H3>Work</H3><DL><p>
<DT><A HREF="https://b.example/2">Beta</A>
</DL><p></DL><p>`;

const uploadFile = (html: string) => {
  const input = screen.getByLabelText("Bookmarks file") as HTMLInputElement;
  const file = new File([html], "bookmarks.html", { type: "text/html" });
  fireEvent.change(input, { target: { files: [file] } });
};

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ queued: 1, skipped: 0, failed: 0 }) }) as Response)));
afterEach(() => vi.unstubAllGlobals());

describe("BookmarkImport", () => {
  it("imports each selected bookmark individually and shows the finished count", async () => {
    render(<BookmarkImport kbId="kb1" />);
    uploadFile(SAMPLE);
    fireEvent.click(await screen.findByRole("button", { name: /Import 2/ }));
    await waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2));
    for (const call of (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls) {
      expect(JSON.parse(String((call[1] as RequestInit).body)).items).toHaveLength(1);
    }
    await waitFor(() => expect(screen.getByText(/Imported 2 pages/)).toBeTruthy());
  });

  it("shows per-bookmark done and failed statuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const item = JSON.parse(String(init.body)).items[0];
      const failed = item.url.includes("b.example");
      return { ok: true, json: async () => ({ queued: failed ? 0 : 1, skipped: 0, failed: failed ? 1 : 0 }) } as Response;
    }));
    render(<BookmarkImport kbId="kb1" />);
    uploadFile(SAMPLE);
    fireEvent.click(await screen.findByRole("button", { name: /Import 2/ }));
    expect(await screen.findByRole("img", { name: "done" })).toBeTruthy();
    expect(await screen.findByRole("img", { name: "failed" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Imported 1 page/)).toBeTruthy());
  });

  it("disables import when more than the cap is selected", async () => {
    const many = Array.from({ length: 51 }, (_, i) => `<DT><A HREF="https://x.example/${i}">L${i}</A>`).join("\n");
    render(<BookmarkImport kbId="kb1" />);
    uploadFile(`<DL><p>${many}</DL><p>`);
    expect(await screen.findByText(/Found 51 bookmarks/)).toBeTruthy();
    expect(screen.getByText(/Select up to 50/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Import/ })).toHaveProperty("disabled", true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @gr/web exec vitest run components/bookmark-import.test.tsx`
Expected: FAIL — the current component sends one bulk POST (fetch called once, items length 2) and renders no `done`/`failed` labels or "Imported 2 pages" progress text.

- [ ] **Step 3: Replace `bookmark-import.tsx`**

Replace the entire file `apps/web/components/bookmark-import.tsx` with:

```tsx
"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Check, X, Clock, Loader2, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { cn } from "@/lib/utils";
import { runPool } from "@/lib/pool";
import { parseBookmarksHtml, MAX_BOOKMARK_IMPORT, type BookmarkEntry } from "@/lib/bookmarks";

const IMPORT_CONCURRENCY = 4;
type ItemStatus = "pending" | "importing" | "done" | "failed" | "skipped";
type ImportItem = { url: string; title: string };

/** Read a File as text via FileReader (works across browsers + jsdom, unlike Blob.text()). */
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function StatusIcon({ status }: { status: ItemStatus }) {
  const Icon = status === "done" ? Check : status === "failed" ? X : status === "skipped" ? Minus : status === "importing" ? Loader2 : Clock;
  const color = status === "done" ? "text-green-600" : status === "failed" ? "text-destructive" : status === "importing" ? "text-amber-600" : "text-muted-foreground";
  // role="img" + aria-label gives the icon an accessible name that tests query via getByRole("img", { name }).
  return (
    <span role="img" aria-label={status} className="shrink-0">
      <Icon aria-hidden className={cn("size-4", status === "importing" && "animate-spin", color)} />
    </span>
  );
}

export function BookmarkImport({ kbId }: { kbId: string }) {
  const router = useRouter();
  const [entries, setEntries] = useState<BookmarkEntry[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<"select" | "running" | "finished">("select");
  const [importItems, setImportItems] = useState<ImportItem[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ItemStatus>>({});
  const [completed, setCompleted] = useState(0);

  const folders = useMemo(() => {
    const map = new Map<string, BookmarkEntry[]>();
    for (const e of entries ?? []) (map.get(e.folder) ?? map.set(e.folder, []).get(e.folder)!).push(e);
    return [...map.entries()];
  }, [entries]);

  async function loadFile(f: File) {
    const parsed = parseBookmarksHtml(await readText(f));
    setEntries(parsed);
    setSelected(new Set(parsed.map((p) => p.url)));
    setOpen(new Set());
  }
  function onValueChange(fs: File[]) {
    setFile(fs[0] ?? null);
    if (fs.length === 0) { setEntries(null); setSelected(new Set()); }
  }

  function toggle(url: string) {
    setSelected((s) => { const n = new Set(s); n.has(url) ? n.delete(url) : n.add(url); return n; });
  }
  function toggleFolder(items: BookmarkEntry[]) {
    setSelected((s) => {
      const n = new Set(s);
      const allOn = items.every((i) => n.has(i.url));
      for (const i of items) allOn ? n.delete(i.url) : n.add(i.url);
      return n;
    });
  }
  function toggleAll() {
    setSelected((s) => (s.size === (entries?.length ?? 0) ? new Set() : new Set((entries ?? []).map((e) => e.url))));
  }
  function toggleOpen(folder: string) {
    setOpen((o) => { const n = new Set(o); n.has(folder) ? n.delete(folder) : n.add(folder); return n; });
  }

  const count = selected.size;
  const overCap = count > MAX_BOOKMARK_IMPORT;
  const canImport = count > 0 && !overCap;

  async function doImport() {
    if (!entries) return;
    const items: ImportItem[] = entries.filter((e) => selected.has(e.url)).map((e) => ({ url: e.url, title: e.title }));
    if (items.length === 0) return;
    setImportItems(items);
    setStatuses(Object.fromEntries(items.map((i) => [i.url, "pending" as ItemStatus])));
    setCompleted(0);
    setPhase("running");

    const setStatus = (url: string, s: ItemStatus) => setStatuses((m) => ({ ...m, [url]: s }));
    await runPool(items, IMPORT_CONCURRENCY, async (item) => {
      setStatus(item.url, "importing");
      try {
        const res = await fetch("/api/import/bookmarks", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ kbId, items: [item] }),
        });
        if (!res.ok) throw new Error();
        const { queued, skipped } = await res.json() as { queued: number; skipped: number; failed: number };
        setStatus(item.url, queued > 0 ? "done" : skipped > 0 ? "skipped" : "failed");
      } catch {
        setStatus(item.url, "failed");
      } finally {
        setCompleted((c) => c + 1);
      }
    });

    setPhase("finished");
    router.refresh();
  }

  function reset() {
    setPhase("select"); setEntries(null); setSelected(new Set()); setFile(null);
    setImportItems([]); setStatuses({}); setCompleted(0);
  }

  const total = importItems.length;
  const doneCount = importItems.filter((i) => statuses[i.url] === "done").length;
  const failedCount = importItems.filter((i) => statuses[i.url] === "failed").length;
  const skippedCount = importItems.filter((i) => statuses[i.url] === "skipped").length;

  return (
    <div className="space-y-3">
      <label className="text-sm text-muted-foreground">Upload your browser&apos;s exported bookmarks file (.html)</label>
      <FileDropzone
        value={file ? [file] : []} onValueChange={onValueChange} onAdd={([f]) => { if (f) loadFile(f); }}
        accept=".html,.htm" maxFileCount={1} ariaLabel="Bookmarks file" disabled={phase !== "select"}
      />

      {phase === "select" && entries && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>Found {entries.length} bookmark{entries.length === 1 ? "" : "s"} in {folders.length} folder{folders.length === 1 ? "" : "s"}</span>
            <button type="button" className="underline" onClick={toggleAll}>
              {selected.size === entries.length ? "Deselect all" : "Select all"}
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto rounded-md border">
            <div className="p-1">
              {folders.map(([folder, items]) => {
                const allOn = items.every((i) => selected.has(i.url));
                const isOpen = open.has(folder);
                return (
                  <div key={folder}>
                    <div className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
                      <input type="checkbox" className="size-4 accent-amber-600" checked={allOn} onChange={() => toggleFolder(items)} aria-label={`Select folder ${folder}`} />
                      <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left text-sm font-medium" onClick={() => toggleOpen(folder)}>
                        <ChevronRight className={cn("size-4 shrink-0 transition-transform", isOpen && "rotate-90")} />
                        <span className="truncate">{folder}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">({items.length})</span>
                      </button>
                    </div>
                    {isOpen && items.map((i) => (
                      <label key={i.url} className="flex items-center gap-2 rounded px-2 py-1 pl-8 text-sm hover:bg-muted">
                        <input type="checkbox" className="size-4 accent-amber-600" checked={selected.has(i.url)} onChange={() => toggle(i.url)} />
                        <span className="min-w-0 flex-1 truncate">{i.title}</span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className={cn("text-xs", overCap ? "text-destructive" : "text-muted-foreground")}>
              {count} selected{overCap ? ` — Select up to ${MAX_BOOKMARK_IMPORT} pages per import` : ""}
            </span>
            <Button disabled={!canImport} onClick={doImport}>Import {count} page{count === 1 ? "" : "s"}</Button>
          </div>
        </div>
      )}

      {phase !== "select" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>
              {phase === "running"
                ? `Importing ${completed} / ${total}…`
                : `Imported ${doneCount} page${doneCount === 1 ? "" : "s"}${failedCount ? ` · ${failedCount} failed` : ""}${skippedCount ? ` · ${skippedCount} skipped` : ""}`}
            </span>
            {phase === "finished" && <Button size="sm" variant="outline" onClick={reset}>Done</Button>}
          </div>

          <div className="h-2 w-full overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={total}>
            <div className="h-full rounded bg-amber-600 transition-all" style={{ width: `${total ? Math.round((completed / total) * 100) : 0}%` }} />
          </div>

          <div className="max-h-72 overflow-y-auto rounded-md border">
            <div className="p-1">
              {importItems.map((i) => (
                <div key={i.url} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm">
                  <StatusIcon status={statuses[i.url] ?? "pending"} />
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

Note: `toast` and `busy` are removed (progress replaces toasts and the busy flag). Do not leave an unused `sonner` import.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @gr/web exec vitest run components/bookmark-import.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck & commit**

```bash
pnpm --filter @gr/web typecheck
git add apps/web/components/bookmark-import.tsx apps/web/components/bookmark-import.test.tsx
git commit -m "feat(web): per-bookmark import progress (client-driven pool)"
```

---

## Final verification (before finishing the branch)

- [ ] Full component suite: `pnpm --filter @gr/web exec vitest run` — all green.
- [ ] Full node/DB suite: `bash scripts/test.sh` — all green (no server change; confirm nothing broke).
- [ ] Typecheck: `pnpm --filter @gr/web typecheck` — clean.
- [ ] Manual: import several bookmarks → the folder tree is replaced by a progress bar + per-bookmark list; each row goes ⏳ → spinner → ✓/✗; the bar fills to N/N; a summary + **Done** button appear; **Done** returns to the upload state and the Library shows the new pages.
```
