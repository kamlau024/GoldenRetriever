# Bookmark Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Import" tab to the "Add to your library" card that parses a browser's exported bookmarks `.html` file, lets the user pick pages, and bulk-ingests them into their personal library via the existing URL pipeline.

**Architecture:** Three units. (1) A pure `parseBookmarksHtml` parser + `MAX_BOOKMARK_IMPORT` constant. (2) A `POST /api/import/bookmarks` bulk endpoint that re-validates URLs (SSRF) + authz and enqueues one ingestion job per URL, reusing `enqueueIngestion`. (3) An Import tab UI that parses the file in-browser, previews it grouped by folder with checkboxes, and posts the selection.

**Tech Stack:** Next.js 15 App Router, React, base-ui, Drizzle+Postgres, Vitest (node + jsdom).

## Global Constraints

- **Parser placement:** the parser + `MAX_BOOKMARK_IMPORT` live in `apps/web/lib/bookmarks.ts` (NOT `@gr/ingest`). The `@gr/ingest` barrel imports `node:dns`/`node:net` (url-safety); importing it into a client component would drag node built-ins into the browser bundle. Both consumers (client component + API route) are in `apps/web`, so `apps/web/lib` is the correct client-safe home.
- Ownership + SSRF checks live server-side, mirroring `apps/web/app/api/ingest/route.ts`: `isSafeHttpUrl` per URL, KB membership `owner`/`editor` (403 otherwise), reuse `enqueueIngestion` (kind `web`, captureMode `url_fetch`).
- `MAX_BOOKMARK_IMPORT = 50` — one definition in `apps/web/lib/bookmarks.ts`, imported by client and route.
- base-ui primitives via `render={<X/>}` props (never Radix `asChild`); reuse `tabs.tsx`, `button.tsx`, `input.tsx`, `scroll-area.tsx`. Preview rows use native `<input type="checkbox">` styled with Tailwind (`accent-*`) — no new primitive.
- Tailwind v4 utility classes; `cn` from `@/lib/utils`; `@/` alias → `apps/web`.
- Test commands: pure/node → `bash scripts/test.sh <path>` (spins Docker pgvector, but a pure test just won't touch the DB); component (jsdom) → `pnpm --filter @gr/web exec vitest run components/<file>`; typecheck → `pnpm --filter @gr/web typecheck`.

---

### Task 1: Bookmark parser + cap constant

**Files:**
- Create: `apps/web/lib/bookmarks.ts`
- Test: `apps/web/test/bookmarks-parse.test.ts`

**Interfaces:**
- Produces:
  - `interface BookmarkEntry { url: string; title: string; folder: string; }`
  - `const MAX_BOOKMARK_IMPORT = 50`
  - `function parseBookmarksHtml(html: string): BookmarkEntry[]`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/bookmarks-parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseBookmarksHtml, MAX_BOOKMARK_IMPORT } from "../lib/bookmarks.js";

const SAMPLE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><A HREF="https://example.com/a" ADD_DATE="1">Alpha &amp; Beta</A>
    <DT><A HREF="https://example.com/a" ADD_DATE="2">Duplicate</A>
    <DT><A HREF="javascript:alert(1)">Bad Script</A>
    <DT><A HREF="mailto:x@y.com">Mail</A>
    <DT><H3 ADD_DATE="3">Work</H3>
    <DL><p>
        <DT><A HREF="https://work.example/doc">Work Doc</A>
        <DT><A HREF="https://work.example/empty"></A>
    </DL><p>
</DL><p>`;

describe("parseBookmarksHtml", () => {
  it("extracts http(s) entries with folder + title, de-duped, non-http dropped", () => {
    const out = parseBookmarksHtml(SAMPLE);
    expect(out).toHaveLength(3); // dup, javascript:, mailto: all excluded
    expect(out[0]).toEqual({ url: "https://example.com/a", title: "Alpha & Beta", folder: "Bookmarks" });
    expect(out[1]).toEqual({ url: "https://work.example/doc", title: "Work Doc", folder: "Work" });
    expect(out[2].url).toBe("https://work.example/empty");
    expect(out[2].title).toBe("https://work.example/empty"); // empty title falls back to url
    expect(out[2].folder).toBe("Work");
  });

  it("returns [] for content with no bookmarks and exposes the cap", () => {
    expect(parseBookmarksHtml("<html><body>nothing</body></html>")).toEqual([]);
    expect(MAX_BOOKMARK_IMPORT).toBe(50);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash scripts/test.sh apps/web/test/bookmarks-parse.test.ts`
Expected: FAIL — `Cannot find module '../lib/bookmarks.js'`.

- [ ] **Step 3: Implement the parser**

Create `apps/web/lib/bookmarks.ts`:

```ts
export interface BookmarkEntry { url: string; title: string; folder: string; }

/** Max pages accepted per bookmark import (bounds cost/time). Enforced client- and server-side. */
export const MAX_BOOKMARK_IMPORT = 50;

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const cp = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : whole;
    }
    const key = code.toLowerCase();
    return key in NAMED ? NAMED[key] : whole;
  });
}

const stripTags = (s: string): string => s.replace(/<[^>]*>/g, "");

/**
 * Parse a Netscape-format bookmarks export into http(s) entries. Maintains a folder stack across
 * `<H3>` headings and `<DL>` nesting so each link gets its nearest enclosing folder (top level →
 * "Bookmarks"). Drops non-http(s) links and de-dupes repeated URLs (first wins). No DOM dependency,
 * so it runs both in the browser and in node tests.
 */
export function parseBookmarksHtml(html: string): BookmarkEntry[] {
  const entries: BookmarkEntry[] = [];
  const seen = new Set<string>();
  const stack: string[] = ["Bookmarks"];
  let pending: string | null = null;
  const token = /<h3\b[^>]*>([\s\S]*?)<\/h3>|<dl\b[^>]*>|<\/dl\s*>|<a\b[^>]*\shref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = token.exec(html)) !== null) {
    if (m[1] !== undefined) {
      pending = decodeEntities(stripTags(m[1])).trim() || "Bookmarks";
    } else if (m[2] !== undefined) {
      const url = decodeEntities(m[2]).trim();
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      const title = decodeEntities(stripTags(m[3])).trim() || url;
      entries.push({ url, title, folder: stack[stack.length - 1] });
    } else if (m[0][1] === "/") { // </dl>
      if (stack.length > 1) stack.pop();
    } else { // <dl ...>
      stack.push(pending ?? stack[stack.length - 1]);
      pending = null;
    }
  }
  return entries;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/test.sh apps/web/test/bookmarks-parse.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/bookmarks.ts apps/web/test/bookmarks-parse.test.ts
git commit -m "feat(web): Netscape bookmark-file parser + import cap"
```

---

### Task 2: Bulk import endpoint

**Files:**
- Create: `apps/web/app/api/import/bookmarks/route.ts`
- Test: `apps/web/test/import-bookmarks-route.test.ts`

**Interfaces:**
- Consumes: `parseBookmarksHtml` is NOT used here (client parses); this route consumes `MAX_BOOKMARK_IMPORT` from `../../../../lib/bookmarks.js`, `isSafeHttpUrl` from `@gr/ingest`, and `enqueueIngestion` / `processJob` / `resolveIngestDeps` from `../../../../lib/ingest-service.js`.
- Produces: `POST(req): Response` — body `{ kbId?: string; items: { url: string; title?: string }[] }` → `202 { queued, skipped }`; `401` / `400` (empty or > cap) / `403`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/import-bookmarks-route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser, createKnowledgeBase, getOrCreatePersonalKb } from "@gr/db/queries";
import { createMockAiClient } from "@gr/ai/mock";
import { MockConverter } from "@gr/ingest";
import { hashToken } from "../lib/auth.js";
import { __setIngestDeps } from "../lib/ingest-service.js";
import { POST } from "../app/api/import/bookmarks/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, otherKbId: string, token: string;

const post = (body: unknown, auth?: string) =>
  POST(new NextRequest("http://localhost/api/import/bookmarks", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
  }));

// Public IP-literal URLs skip DNS in isSafeHttpUrl (no network); private literals are rejected.
const safe = () => `http://93.184.216.34/${randomUUID()}`;
const UNSAFE = "http://127.0.0.1/x";

beforeAll(async () => {
  const uid = await createUser(db, { id: "u_bmimp", email: "bm@bm.dev" });
  const outsider = await createUser(db, { id: "u_bmimp_out", email: "bmo@bm.dev" });
  kbId = await getOrCreatePersonalKb(db, uid);
  otherKbId = await createKnowledgeBase(db, { ownerId: outsider, name: "NotMine" });
  token = "grt_bmimp";
  await db.insert(schema.apiTokens).values({ id: `tok_${randomUUID().slice(0, 8)}`, userId: uid, name: "t", tokenHash: hashToken(token) });
  __setIngestDeps({ ai: createMockAiClient(), converter: new MockConverter(), urlFetcher: async () => ({ kind: "text" as const, mimeType: "text/plain", text: "hi" }) });
  delete process.env.APP_URL; // force in-process processing
});
afterAll(async () => { __setIngestDeps(null); await sql.end(); });

describe("POST /api/import/bookmarks", () => {
  it("401 without auth", async () => {
    expect((await post({ kbId, items: [{ url: safe() }] })).status).toBe(401);
  });
  it("400 when items is empty", async () => {
    expect((await post({ kbId, items: [] }, token)).status).toBe(400);
  });
  it("400 when items exceeds the cap", async () => {
    const items = Array.from({ length: 51 }, () => ({ url: safe() }));
    expect((await post({ kbId, items }, token)).status).toBe(400);
  });
  it("403 when the caller is not a member of the target kb", async () => {
    expect((await post({ kbId: otherKbId, items: [{ url: safe() }] }, token)).status).toBe(403);
  });
  it("enqueues safe URLs, skips unsafe ones, and creates documents", async () => {
    const good = safe();
    const res = await post({ kbId, items: [{ url: good, title: "Good Page" }, { url: safe() }, { url: UNSAFE }] }, token);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ queued: 2, skipped: 1 });
    const docs = await db.select().from(schema.documents).where(eq(schema.documents.sourceUrl, good));
    expect(docs).toHaveLength(1);
    expect(docs[0].kind).toBe("web");
    expect(docs[0].title).toBe("Good Page");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash scripts/test.sh apps/web/test/import-bookmarks-route.test.ts`
Expected: FAIL — `Cannot find module '../app/api/import/bookmarks/route.js'`.

- [ ] **Step 3: Implement the route**

Create `apps/web/app/api/import/bookmarks/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { createDb, schema } from "@gr/db";
import { getOrCreatePersonalKb } from "@gr/db/queries";
import { isSafeHttpUrl } from "@gr/ingest";
import { resolveAuth } from "../../../../lib/clerk-auth.js";
import { enqueueIngestion, processJob, resolveIngestDeps } from "../../../../lib/ingest-service.js";
import { MAX_BOOKMARK_IMPORT } from "../../../../lib/bookmarks.js";

export async function POST(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { kbId?: string; items?: { url?: unknown; title?: unknown }[] };
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ error: "items required" }, { status: 400 });
  if (items.length > MAX_BOOKMARK_IMPORT) {
    return NextResponse.json({ error: `too many items (max ${MAX_BOOKMARK_IMPORT})` }, { status: 400 });
  }

  const kbId = body.kbId ?? (await getOrCreatePersonalKb(db, principal.userId));
  const membership = await db.select().from(schema.kbMembers)
    .where(and(eq(schema.kbMembers.kbId, kbId), eq(schema.kbMembers.userId, principal.userId)));
  const role = membership[0]?.role;
  if (role !== "owner" && role !== "editor") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Trigger processing the same way single-URL ingest does: async worker hand-off when an absolute
  // base URL is configured (prod), else run the pipeline in-process (local/dev/tests).
  const base = process.env.APP_URL?.replace(/\/$/, "");
  const deps = base ? null : resolveIngestDeps();

  let queued = 0;
  let skipped = 0;
  for (const item of items) {
    const url = typeof item?.url === "string" ? item.url.trim() : "";
    if (!url || !(await isSafeHttpUrl(url))) { skipped++; continue; }
    const title = typeof item?.title === "string" && item.title.trim() ? item.title.trim().slice(0, 300) : null;
    const { documentId, jobId } = await enqueueIngestion(db, {
      kbId, addedBy: principal.userId, captureMode: "url_fetch", kind: "web", mimeType: null,
      sourceUrl: url, title, rawContent: "",
    });
    queued++;
    if (base) {
      void fetch(`${base}/api/worker`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-worker-secret": process.env.WORKER_SECRET ?? "" },
        body: JSON.stringify({ jobId, documentId }),
      });
    } else {
      await processJob(db, deps!.ai, deps!.converter, deps!.urlFetcher, {
        documentId, kbId, mimeType: null, text: "", sourceUrl: url, filename: title,
      });
    }
  }
  return NextResponse.json({ queued, skipped }, { status: 202 });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/test.sh apps/web/test/import-bookmarks-route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @gr/web typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/import/bookmarks/route.ts apps/web/test/import-bookmarks-route.test.ts
git commit -m "feat(web): bulk bookmark import endpoint (authz + SSRF + cap)"
```

---

### Task 3: Import tab UI

**Files:**
- Create: `apps/web/components/bookmark-import.tsx`
- Modify: `apps/web/components/add-content.tsx` (add the 4th tab)
- Test: `apps/web/components/bookmark-import.test.tsx`

**Interfaces:**
- Consumes: `parseBookmarksHtml`, `MAX_BOOKMARK_IMPORT`, `BookmarkEntry` from `@/lib/bookmarks`; `POST /api/import/bookmarks` → `{ queued, skipped }`.
- Produces: `export function BookmarkImport({ kbId }: { kbId: string })`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/bookmark-import.test.tsx`:

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

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ queued: 2, skipped: 0 }) }) as Response)));
afterEach(() => vi.unstubAllGlobals());

describe("BookmarkImport", () => {
  it("previews parsed bookmarks and imports the selection", async () => {
    render(<BookmarkImport kbId="kb1" />);
    uploadFile(SAMPLE);
    expect(await screen.findByText(/Found 2 bookmarks/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Import 2/ }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/import/bookmarks",
      expect.objectContaining({ method: "POST" }),
    ));
    const body = JSON.parse((globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body as string);
    expect(body.kbId).toBe("kb1");
    expect(body.items).toHaveLength(2);
    expect(body.items.map((i: { url: string }) => i.url)).toContain("https://a.example/1");
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

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gr/web exec vitest run components/bookmark-import.test.tsx`
Expected: FAIL — `Cannot find module './bookmark-import.js'`.

- [ ] **Step 3: Implement the component**

Create `apps/web/components/bookmark-import.tsx`:

```tsx
"use client";
import { useMemo, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { parseBookmarksHtml, MAX_BOOKMARK_IMPORT, type BookmarkEntry } from "@/lib/bookmarks";

export function BookmarkImport({ kbId }: { kbId: string }) {
  const router = useRouter();
  const [entries, setEntries] = useState<BookmarkEntry[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const folders = useMemo(() => {
    const map = new Map<string, BookmarkEntry[]>();
    for (const e of entries ?? []) (map.get(e.folder) ?? map.set(e.folder, []).get(e.folder)!).push(e);
    return [...map.entries()];
  }, [entries]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const parsed = parseBookmarksHtml(await file.text());
    setEntries(parsed);
    setSelected(new Set(parsed.map((p) => p.url)));
    setOpen(new Set());
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
  const canImport = count > 0 && !overCap && !busy;

  async function doImport() {
    if (!entries) return;
    setBusy(true);
    const items = entries.filter((e) => selected.has(e.url)).map((e) => ({ url: e.url, title: e.title }));
    try {
      const res = await fetch("/api/import/bookmarks", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kbId, items }),
      });
      if (!res.ok) throw new Error();
      const { queued } = await res.json() as { queued: number };
      toast.success(`Importing ${queued} page${queued === 1 ? "" : "s"} — they'll appear as they finish.`);
      setEntries(null); setSelected(new Set());
      router.refresh();
    } catch {
      toast.error("Couldn't import those bookmarks. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="text-sm text-muted-foreground">Upload your browser's exported bookmarks file (.html)</label>
      <Input type="file" accept=".html,.htm" aria-label="Bookmarks file" disabled={busy} className="w-full" onChange={onFile} />

      {entries && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>Found {entries.length} bookmark{entries.length === 1 ? "" : "s"} in {folders.length} folder{folders.length === 1 ? "" : "s"}</span>
            <button type="button" className="underline" onClick={toggleAll}>
              {selected.size === entries.length ? "Deselect all" : "Select all"}
            </button>
          </div>

          <ScrollArea className="max-h-72 rounded-md border">
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
          </ScrollArea>

          <div className="flex items-center justify-between">
            <span className={cn("text-xs", overCap ? "text-destructive" : "text-muted-foreground")}>
              {count} selected{overCap ? ` — Select up to ${MAX_BOOKMARK_IMPORT} pages per import` : ""}
            </span>
            <Button disabled={!canImport} onClick={doImport}>Import {count} page{count === 1 ? "" : "s"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire the Import tab into `add-content.tsx`**

In `apps/web/components/add-content.tsx`, add the import near the top:

```tsx
import { BookmarkImport } from "@/components/bookmark-import";
```

Add the trigger to `<TabsList>` (after the `file` trigger):

```tsx
<TabsTrigger value="import">Import</TabsTrigger>
```

Add the tab content (after the `file` `TabsContent`):

```tsx
<TabsContent value="import" className="space-y-3">
  <BookmarkImport kbId={kbId} />
</TabsContent>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @gr/web exec vitest run components/bookmark-import.test.tsx`
Expected: PASS (2 tests).

Also run the existing add-content test to confirm no regression:
Run: `pnpm --filter @gr/web exec vitest run components/add-content.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @gr/web typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/bookmark-import.tsx apps/web/components/add-content.tsx apps/web/components/bookmark-import.test.tsx
git commit -m "feat(web): Import tab — preview + select browser bookmarks"
```

---

## Final verification (before finishing the branch)

- [ ] Full node/DB suite: `bash scripts/test.sh` — all green.
- [ ] Full component suite: `pnpm --filter @gr/web exec vitest run` — all green.
- [ ] Typecheck: `pnpm --filter @gr/web typecheck` — clean.
- [ ] Manual: export bookmarks from a browser → Import tab → upload → folders preview → select a few → Import → they appear in the Library as processing → ready. Confirm a `javascript:`/`mailto:` entry never appears, and selecting > 50 disables the button.
```
