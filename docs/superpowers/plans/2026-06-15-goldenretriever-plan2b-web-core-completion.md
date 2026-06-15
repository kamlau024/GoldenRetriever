# GoldenRetriever Plan 2b — Web Core Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the core local web loop: "Save URL" actually captures the page (server-side fetch, SSRF-guarded), the URL scheme is allowlisted at ingest, chat shows **live** citation chips, and users get a **search page** and the ability to **delete** documents.

**Architecture:** Builds on `main` (Plan 1 backend + Plan 2a web slice). Adds a small URL-safety module in `@gr/ingest` (`assertSafeHttpUrl` + a guarded `fetchUrlContent`), threads server-side URL fetching through the ingestion pipeline behind the existing deps seam, sends citations to the chat client via an `x-citations` response header (the route still streams plain text), adds a `/api/search` route + page reusing `HybridRetriever`, and a delete route + library button. Everything runs locally against the Docker pgvector DB; no Vercel Blob and no Python service are required (binary file upload stays in a later plan).

**Tech Stack:** Next.js App Router, Drizzle, the existing `@gr/*` packages, Vitest (node + jsdom). No new dependencies.

**Scope (Plan 2b):**
- IN: server-side URL fetch+parse (HTML), `assertSafeHttpUrl` (scheme allowlist + SSRF host guard) wired at ingest, live citation chips, `/api/search` + search page, document delete (route + DB helper + library button).
- OUT (→ later): binary file upload via Vercel Blob + markitdown (needs Blob + the Python service), DNS-rebinding-grade SSRF (we do host/IP-literal checks + safe redirect handling), Playwright e2e, deployment.

**Prereq:** Docker test DB running (`pnpm db:up`); tests run via `pnpm test <path>` or `DATABASE_URL=postgres://gr:gr@localhost:5433/gr_test AI_GATEWAY_API_KEY=test pnpm vitest run <path>`.

---

## File Structure

```
packages/ingest/src/
├─ url-safety.ts          assertSafeHttpUrl(url) — scheme allowlist + SSRF host guard
├─ url-safety.test.ts
├─ fetch-url.ts           fetchUrlContent(url, fetchImpl?) — guarded fetch → { contentType, text?, bytes? }
├─ fetch-url.test.ts
├─ pipeline.ts            (modify) fetch URL when no text/bytes; UrlFetcher injected
├─ pipeline.test.ts       (modify) add url_fetch case
└─ index.ts               (modify) export the new symbols

packages/db/src/
├─ queries.ts             (modify) + deleteDocument(db, docId, kbId)
└─ queries.delete.test.ts

apps/web/
├─ app/api/ingest/route.ts        (modify) validate body.url with assertSafeHttpUrl → 400
├─ app/api/chat/route.ts          (modify) add x-citations header
├─ app/api/search/route.ts        NEW — POST: retriever results (deps-injected)
├─ app/api/documents/[id]/route.ts NEW — DELETE: membership-checked document delete
├─ lib/ingest-service.ts          (modify) IngestDeps gains urlFetcher; thread to pipeline
├─ lib/search-service.ts          NEW — resolveSearchDeps / __setSearchDeps
├─ lib/citations.ts               NEW — encode/parse the x-citations header (pure, tested)
├─ components/chat.tsx            (modify) Chat reads x-citations and renders chips
├─ components/library-list.tsx    (modify) add a delete button (client island)
├─ app/(app)/search/page.tsx      NEW — search UI
├─ components/search.tsx          NEW — client search box + results
├─ test/ingest-url-validation.test.ts   NEW
├─ test/chat-route.test.ts        (modify) assert x-citations header
├─ test/search-route.test.ts      NEW
├─ test/documents-delete-route.test.ts  NEW
└─ components/citations.test.ts / search.test.tsx  NEW
```

---

## Task 1: `assertSafeHttpUrl` — scheme allowlist + SSRF host guard

**Files:** Create `packages/ingest/src/url-safety.ts`, `packages/ingest/src/url-safety.test.ts`.

- [ ] **Step 1: Write the failing test** `packages/ingest/src/url-safety.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { assertSafeHttpUrl, isSafeHttpUrl } from "./url-safety.js";

describe("assertSafeHttpUrl", () => {
  it("allows public http(s) URLs", () => {
    expect(isSafeHttpUrl("https://example.com/a")).toBe(true);
    expect(isSafeHttpUrl("http://news.site/path?q=1")).toBe(true);
  });
  it("rejects non-http(s) schemes", () => {
    for (const u of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://h/x"]) {
      expect(isSafeHttpUrl(u)).toBe(false);
    }
  });
  it("rejects private / loopback / metadata hosts (SSRF)", () => {
    for (const u of [
      "http://localhost/x", "http://127.0.0.1/x", "http://0.0.0.0/x",
      "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/x",
      "http://192.168.1.1/x", "http://172.16.0.9/x", "http://[::1]/x",
      "http://router.local/x", "http://svc.internal/x",
    ]) {
      expect(isSafeHttpUrl(u)).toBe(false);
    }
  });
  it("assertSafeHttpUrl throws for unsafe and returns the parsed URL for safe", () => {
    expect(() => assertSafeHttpUrl("javascript:x")).toThrow();
    expect(assertSafeHttpUrl("https://ok.dev/p").hostname).toBe("ok.dev");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`pnpm vitest run packages/ingest/src/url-safety.test.ts`).

- [ ] **Step 3: Implement `packages/ingest/src/url-safety.ts`:**
```ts
const PRIVATE_HOST = /^(localhost|0\.0\.0\.0|127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;
const PRIVATE_SUFFIX = /\.(local|internal|localhost)$/i;

/** Returns the parsed URL if it is a public http(s) URL, else throws. */
export function assertSafeHttpUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`invalid url: ${raw}`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsupported url scheme: ${url.protocol}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (host === "::1" || PRIVATE_HOST.test(host) || PRIVATE_SUFFIX.test(host)) {
    throw new Error(`blocked host (private/loopback): ${host}`);
  }
  return url;
}

export function isSafeHttpUrl(raw: string): boolean {
  try { assertSafeHttpUrl(raw); return true; } catch { return false; }
}
```

- [ ] **Step 4: Run — expect PASS (4).** **Step 5: Typecheck** `pnpm --filter @gr/ingest typecheck`. **Step 6: Commit** `feat(ingest): assertSafeHttpUrl — scheme allowlist + SSRF host guard`.

> Note: this is a host/IP-literal guard. DNS-rebinding-grade protection (resolve the hostname and re-check the IP, and re-validate after redirects) is a documented hardening follow-up; `fetchUrlContent` (Task 2) disables redirects to limit that surface.

---

## Task 2: `fetchUrlContent` — guarded server-side fetch

**Files:** Create `packages/ingest/src/fetch-url.ts`, `packages/ingest/src/fetch-url.test.ts`.

- [ ] **Step 1: Write the failing test** `packages/ingest/src/fetch-url.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { fetchUrlContent } from "./fetch-url.js";

// A fake fetch so the test makes no real network call.
const fakeFetch = (body: string, contentType: string): typeof fetch =>
  (async () => new Response(body, { status: 200, headers: { "content-type": contentType } })) as unknown as typeof fetch;

describe("fetchUrlContent", () => {
  it("returns html text for an html response", async () => {
    const r = await fetchUrlContent("https://ok.dev/a", fakeFetch("<html><body><p>Hi</p></body></html>", "text/html; charset=utf-8"));
    expect(r.kind).toBe("text");
    expect(r.mimeType).toContain("text/html");
    expect(r.text).toContain("Hi");
  });
  it("returns bytes for a binary response", async () => {
    const r = await fetchUrlContent("https://ok.dev/a.pdf", fakeFetch("%PDF-1.4", "application/pdf"));
    expect(r.kind).toBe("bytes");
    expect(r.bytes).toBeInstanceOf(Uint8Array);
  });
  it("rejects an unsafe url before fetching", async () => {
    await expect(fetchUrlContent("http://169.254.169.254/x", fakeFetch("x", "text/html"))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `packages/ingest/src/fetch-url.ts`:**
```ts
import { assertSafeHttpUrl } from "./url-safety.js";

export interface FetchedContent {
  kind: "text" | "bytes";
  mimeType: string;
  text?: string;
  bytes?: Uint8Array;
}

export type UrlFetcher = (url: string) => Promise<FetchedContent>;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB cap

/** Fetch a public http(s) URL safely (no redirects to other hosts) and return its content. */
export async function fetchUrlContent(url: string, fetchImpl: typeof fetch = fetch): Promise<FetchedContent> {
  assertSafeHttpUrl(url);
  const res = await fetchImpl(url, { redirect: "manual", headers: { "user-agent": "GoldenRetriever/0.1" } });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (!loc) throw new Error(`redirect without location from ${url}`);
    assertSafeHttpUrl(new URL(loc, url).toString()); // re-guard the redirect target
    return fetchUrlContent(new URL(loc, url).toString(), fetchImpl);
  }
  if (!res.ok) throw new Error(`fetch failed ${res.status} for ${url}`);
  const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new Error(`content too large (${buf.byteLength} bytes)`);
  if (mimeType.includes("html") || mimeType.startsWith("text/")) {
    return { kind: "text", mimeType, text: new TextDecoder().decode(buf) };
  }
  return { kind: "bytes", mimeType, bytes: buf };
}
```

- [ ] **Step 4: Run — expect PASS (3).** **Step 5: Typecheck.** **Step 6: Commit** `feat(ingest): guarded fetchUrlContent (server-side URL capture)`.

---

## Task 3: Thread URL fetching through the ingestion pipeline

**Files:** Modify `packages/ingest/src/pipeline.ts`, `packages/ingest/src/index.ts`, `packages/ingest/src/pipeline.test.ts`.

The pipeline currently fails when given a `sourceUrl` with no `text`/`bytes`. Add URL fetching behind an injected `UrlFetcher`.

- [ ] **Step 1: Update the failing test — add a case to `packages/ingest/src/pipeline.test.ts`** (add this `it` inside the existing `describe("runIngestion", ...)`; also import `MockConverter` is already imported):
```ts
  it("fetches and parses an html URL when no inline content is provided", async () => {
    const docId = await insertDocument(db, {
      kbId, addedBy: userId, kind: "web", captureMode: "url_fetch",
      sourceUrl: "https://ok.dev/post", title: null, mimeType: null,
    });
    const fakeFetcher = async () => ({ kind: "text" as const, mimeType: "text/html",
      text: "<html><head><title>Post</title></head><body><article><p>Kyoto ryokan guide.</p></article></body></html>" });
    await runIngestion(db, ai, conv, {
      documentId: docId, kbId, mimeType: null, sourceUrl: "https://ok.dev/post",
    }, fakeFetcher);
    const doc = await getDocument(db, docId, kbId);
    expect(doc?.status).toBe("ready");
    expect(doc?.title).toBe("Post");
  });
```

- [ ] **Step 2: Run — expect FAIL** (runIngestion takes 4 args / no fetch).

- [ ] **Step 3: Modify `packages/ingest/src/pipeline.ts`** — import the fetcher type and add the param + fetch step:
  - Add import: `import { fetchUrlContent, type UrlFetcher } from "./fetch-url.js";`
  - Change the signature to accept an optional fetcher:
    ```ts
    export async function runIngestion(
      db: Db, ai: AiClient, converter: Converter, work: IngestionWork,
      urlFetcher: UrlFetcher = fetchUrlContent,
    ): Promise<void> {
    ```
  - At the very start of the `try` block (right after setting status `processing`), resolve URL content when needed:
    ```ts
    let { text, bytes, mimeType } = work;
    if (text === undefined && bytes === undefined && work.sourceUrl) {
      const fetched = await urlFetcher(work.sourceUrl);
      mimeType = fetched.mimeType;
      if (fetched.kind === "text") text = fetched.text;
      else throw new Error("binary URL content is not supported yet (Plan 2c)");
    }
    ```
  - Change the `convertToMarkdown({ ... })` call to use the resolved locals: `{ mimeType, text, bytes, sourceUrl: work.sourceUrl, filename: work.filename }`.

- [ ] **Step 4: Export the new symbols — add to `packages/ingest/src/index.ts`:**
```ts
export { assertSafeHttpUrl, isSafeHttpUrl } from "./url-safety.js";
export { fetchUrlContent, type UrlFetcher, type FetchedContent } from "./fetch-url.js";
```

- [ ] **Step 5: Run pipeline tests — expect PASS (4 now).** **Step 6: Typecheck `@gr/ingest`.** **Step 7: Commit** `feat(ingest): pipeline fetches html URLs via injected UrlFetcher`.

---

## Task 4: Validate `url` scheme at the ingest route (defense-in-depth)

**Files:** Modify `apps/web/app/api/ingest/route.ts`, `apps/web/lib/ingest-service.ts`; create `apps/web/test/ingest-url-validation.test.ts`.

- [ ] **Step 1: Add `urlFetcher` to the ingest deps seam.** In `apps/web/lib/ingest-service.ts`:
  - Import: `import { fetchUrlContent, type UrlFetcher } from "@gr/ingest";`
  - Extend `IngestDeps`: `export interface IngestDeps { ai: AiClient; converter: Converter; urlFetcher: UrlFetcher; }`
  - In `resolveIngestDeps`, default it: `return depsOverride ?? { ai: createAiClient(), converter: new MarkitdownConverter(), urlFetcher: fetchUrlContent };`
  - In `processJob`, accept and forward it: change the signature to `processJob(db, ai, converter, urlFetcher: UrlFetcher, args)` and call `runIngestion(db, ai, converter, args, urlFetcher)`.
  - In `ingestAndProcess`, accept `urlFetcher` and pass it through (used by the route + tests).
  - Update the route's in-process branch to read `const { ai, converter, urlFetcher } = resolveIngestDeps();` and call `processJob(db, ai, converter, urlFetcher, {...})`.
  - **Also update `apps/web/app/api/worker/route.ts`** (it calls `processJob` too): import `fetchUrlContent` (`import { MarkitdownConverter, fetchUrlContent } from "@gr/ingest";`) and pass it — `processJob(db, createAiClient(), new MarkitdownConverter(), fetchUrlContent, { ... })`.

  > After this change, the existing `__setIngestDeps({ ai, converter })` test calls will fail to typecheck (missing `urlFetcher`). Update them in `apps/web/test/ingest-route-happy.test.ts` and `apps/web/test/ingest-route-session.test.ts` to include `urlFetcher: async () => ({ kind: "text" as const, mimeType: "text/plain", text: "" })` (they don't exercise URL fetch, so a stub is fine).

- [ ] **Step 2: Write the failing test `apps/web/test/ingest-url-validation.test.ts`:**
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser, getOrCreatePersonalKb } from "@gr/db/queries";
import { hashToken } from "../lib/auth.js";
import { POST } from "../app/api/ingest/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, token: string;
beforeAll(async () => {
  const uid = await createUser(db, { id: "u_urlval", email: "uv@uv.dev" });
  kbId = await getOrCreatePersonalKb(db, uid);
  token = "grt_urlval";
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId: uid, name: "t", tokenHash: hashToken(token),
  });
});
afterAll(async () => { await sql.end(); });

const post = (body: unknown) => POST(new NextRequest("http://localhost/api/ingest", {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
}));

describe("POST /api/ingest url validation", () => {
  it("400 for a non-http(s) url scheme", async () => {
    expect((await post({ kbId, url: "javascript:alert(1)" })).status).toBe(400);
  });
  it("400 for a private/SSRF url host", async () => {
    expect((await post({ kbId, url: "http://169.254.169.254/meta" })).status).toBe(400);
  });
});
```

- [ ] **Step 3: Run — expect FAIL** (route currently accepts any url).

- [ ] **Step 4: Edit `apps/web/app/api/ingest/route.ts`** — after the existing body validation (the `if (!body.kbId || ...)` 400 check) and before the membership check, add:
  - Import at top: `import { isSafeHttpUrl } from "@gr/ingest";`
  - Insert:
    ```ts
    if (body.url && !isSafeHttpUrl(body.url)) {
      return NextResponse.json({ error: "url must be a public http(s) URL" }, { status: 400 });
    }
    ```

- [ ] **Step 5: Run the new test + all existing ingest tests** (`ingest-route`, `ingest-route-happy`, `ingest-route-session`, `ingest-url-validation`). All pass. **Step 6: Typecheck `@gr/web`.** **Step 7: Commit** `feat(web): reject unsafe ingest URLs (scheme + SSRF) at the boundary`.

---

## Task 5: Live citation chips via `x-citations` header

**Files:** Create `apps/web/lib/citations.ts`, `apps/web/components/citations.test.ts`; modify `apps/web/app/api/chat/route.ts`, `apps/web/test/chat-route.test.ts`, `apps/web/components/chat.tsx`.

- [ ] **Step 1: Write the failing test `apps/web/components/citations.test.ts`** (pure encode/parse helper — non-ASCII safe):
```ts
import { describe, it, expect } from "vitest";
import { encodeCitations, parseCitations, type Citation } from "../lib/citations.js";

describe("citations header codec", () => {
  it("round-trips citations including non-ASCII titles", () => {
    const cites: Citation[] = [{ chunkId: "c1", documentId: "d1", title: "京都 ryokan", sourceUrl: "https://x" }];
    const header = encodeCitations(cites);
    expect(header).toMatch(/^[\x00-\x7F]*$/); // header value is ASCII-safe
    expect(parseCitations(header)).toEqual(cites);
  });
  it("parse returns [] for empty/garbage", () => {
    expect(parseCitations(null)).toEqual([]);
    expect(parseCitations("%%%")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `apps/web/lib/citations.ts`:**
```ts
export interface Citation {
  chunkId: string; documentId: string; title: string | null; sourceUrl: string | null;
}

export function encodeCitations(cites: Citation[]): string {
  return encodeURIComponent(JSON.stringify(cites));
}

export function parseCitations(header: string | null | undefined): Citation[] {
  if (!header) return [];
  try {
    const v = JSON.parse(decodeURIComponent(header));
    return Array.isArray(v) ? v as Citation[] : [];
  } catch { return []; }
}
```

- [ ] **Step 4: Run — expect PASS (2).**

- [ ] **Step 5: Modify `apps/web/app/api/chat/route.ts`** to send the header on BOTH the refusal and the streaming responses:
  - Import: `import { encodeCitations } from "../../../lib/citations.js";`
  - The refusal `Response` headers: add `"x-citations": encodeCitations([])`.
  - The streaming `toTextStreamResponse({ headers: { ... } })`: add `"x-citations": encodeCitations(citations)` (the `citations` array already computed above — ensure its shape is `{ chunkId, documentId, title, sourceUrl }`, which it is).

- [ ] **Step 6: Add an assertion to `apps/web/test/chat-route.test.ts`** in the first test (after `expect(text).toContain("Tawaraya")`):
```ts
    const cites = (await import("../lib/citations.js")).parseCitations(res.headers.get("x-citations"));
    expect(cites[0]?.documentId).toBe("d1");
```

- [ ] **Step 7: Modify `apps/web/components/chat.tsx`** `Chat.send` to attach citations from the header once the response arrives (after `const res = await fetch(...)`, before reading the stream):
```ts
      const { parseCitations } = await import("../lib/citations.js");
      const citations = parseCitations(res.headers.get("x-citations"));
      setMessages((m) => m.map((t) => (t.id === assistantId ? { ...t, citations } : t)));
```
  (`Turn.citations` is `Citation[]` from `./chat.js`; the `lib/citations.ts` `Citation` has extra fields but is structurally compatible with the `{ title, sourceUrl }` the `Transcript` reads — map if TypeScript complains: `citations.map((c) => ({ title: c.title, sourceUrl: c.sourceUrl }))`.)

- [ ] **Step 8: Run chat-route test + component tests; typecheck `@gr/web`.** **Step 9: Commit** `feat(web): live citation chips via x-citations header`.

---

## Task 6: `deleteDocument` DB helper

**Files:** Modify `packages/db/src/queries.ts`; create `packages/db/src/queries.delete.test.ts`.

- [ ] **Step 1: Write the failing test `packages/db/src/queries.delete.test.ts`:**
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql as drizzleSql } from "drizzle-orm";
import { createDb } from "./client.js";
import { createUser, createKnowledgeBase, insertDocument, insertChunks, deleteDocument, getDocument } from "./queries.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, userId: string;
beforeAll(async () => {
  userId = await createUser(db, { id: "u_del", email: "d@d.dev" });
  kbId = await createKnowledgeBase(db, { ownerId: userId, name: "Del" });
});
afterAll(async () => { await sql.end(); });

describe("deleteDocument", () => {
  it("deletes a kb-scoped document and cascades its chunks", async () => {
    const docId = await insertDocument(db, { kbId, addedBy: userId, kind: "text", captureMode: "selection", sourceUrl: null, title: "Doomed" });
    await insertChunks(db, [{ documentId: docId, kbId, ordinal: 0, content: "x", tokenCount: 1, embedding: Array(1536).fill(0.01), embeddingModel: "test" }]);
    const deleted = await deleteDocument(db, docId, kbId);
    expect(deleted).toBe(true);
    expect(await getDocument(db, docId, kbId)).toBeUndefined();
    const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM chunks WHERE document_id = ${docId}`;
    expect(rows[0].n).toBe(0);
  });
  it("returns false when the document is not in the kb", async () => {
    expect(await deleteDocument(db, "doc_missing", kbId)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Append to `packages/db/src/queries.ts`:**
```ts
export async function deleteDocument(db: Db, docId: string, kbId: string): Promise<boolean> {
  const rows = await db.delete(documents)
    .where(and(eq(documents.id, docId), eq(documents.kbId, kbId)))
    .returning({ id: documents.id });
  return rows.length > 0;
}
```
> `chunks.document_id` has `onDelete: "cascade"` in the schema, so deleting the document removes its chunks automatically.

- [ ] **Step 4: Run — expect PASS (2).** **Step 5: Typecheck `@gr/db`.** **Step 6: Commit** `feat(db): kb-scoped deleteDocument (cascades chunks)`.

---

## Task 7: `DELETE /api/documents/[id]` route

**Files:** Create `apps/web/app/api/documents/[id]/route.ts`, `apps/web/test/documents-delete-route.test.ts`.

- [ ] **Step 1: Write the failing test `apps/web/test/documents-delete-route.test.ts`:**
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser, getOrCreatePersonalKb, insertDocument } from "@gr/db/queries";
import { hashToken } from "../lib/auth.js";
import { DELETE } from "../app/api/documents/[id]/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, token: string, userId: string;
beforeAll(async () => {
  userId = await createUser(db, { id: "u_delr", email: "dr@dr.dev" });
  kbId = await getOrCreatePersonalKb(db, userId);
  token = "grt_delr";
  await db.insert(schema.apiTokens).values({
    id: `tok_${randomUUID().slice(0, 8)}`, userId, name: "t", tokenHash: hashToken(token),
  });
});
afterAll(async () => { await sql.end(); });

const del = (id: string, auth = true) => DELETE(
  new NextRequest(`http://localhost/api/documents/${id}`, {
    method: "DELETE", headers: auth ? { authorization: `Bearer ${token}` } : {},
  }),
  { params: Promise.resolve({ id }) },
);

describe("DELETE /api/documents/[id]", () => {
  it("deletes a document the caller owns", async () => {
    const docId = await insertDocument(db, { kbId, addedBy: userId, kind: "text", captureMode: "selection", sourceUrl: null, title: "X" });
    expect((await del(docId)).status).toBe(200);
  });
  it("401 without auth", async () => {
    expect((await del("doc_x", false)).status).toBe(401);
  });
  it("404 for a document not in the caller's kbs", async () => {
    expect((await del("doc_missing")).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `apps/web/app/api/documents/[id]/route.ts`:**
```ts
import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { createDb, schema } from "@gr/db";
import { deleteDocument } from "@gr/db/queries";
import { resolveAuth } from "../../../../lib/clerk-auth.js";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  // Resolve the document's kb and require the caller to be a member of it.
  const docRows = await db.select({ kbId: schema.documents.kbId })
    .from(schema.documents).where(eq(schema.documents.id, id));
  const doc = docRows[0];
  if (doc) {
    const member = await db.select().from(schema.kbMembers)
      .where(and(eq(schema.kbMembers.kbId, doc.kbId), eq(schema.kbMembers.userId, principal.userId)));
    if (member[0]) {
      await deleteDocument(db, id, doc.kbId);
      return NextResponse.json({ ok: true });
    }
  }
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
```
> Returning 404 (not 403) when the caller isn't a member avoids leaking which document ids exist. The unused `inArray` import is not needed — omit it; only import `and, eq`.

- [ ] **Step 4: Run — expect PASS (3).** **Step 5: Typecheck `@gr/web`.** **Step 6: Commit** `feat(web): DELETE /api/documents/[id] (membership-checked)`.

---

## Task 8: `/api/search` route + search service

**Files:** Create `apps/web/lib/search-service.ts`, `apps/web/app/api/search/route.ts`, `apps/web/test/search-route.test.ts`.

- [ ] **Step 1: Create the deps seam `apps/web/lib/search-service.ts`:**
```ts
import type { drizzle } from "drizzle-orm/postgres-js";
import { HybridRetriever, type Retriever } from "@gr/retrieval";
import { createAiClient } from "@gr/ai";

type Db = ReturnType<typeof drizzle>;
let override: Retriever | null = null;
export function __setSearchRetriever(r: Retriever | null) { override = r; }
export function resolveSearchRetriever(db: Db): Retriever {
  return override ?? new HybridRetriever(db, createAiClient());
}
```

- [ ] **Step 2: Write the failing test `apps/web/test/search-route.test.ts`:**
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser, getOrCreatePersonalKb } from "@gr/db/queries";
import type { RankedChunk } from "@gr/core";
import type { Retriever } from "@gr/retrieval";
import { hashToken } from "../lib/auth.js";
import { __setSearchRetriever } from "../lib/search-service.js";
import { POST } from "../app/api/search/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, token: string;
const chunk = (content: string): RankedChunk => ({
  chunkId: "c1", documentId: "d1", content, score: 1,
  document: { title: "Kyoto", sourceUrl: "https://x", addedBy: "u_search", capturedAt: new Date() },
});
beforeAll(async () => {
  const uid = await createUser(db, { id: "u_search", email: "se@se.dev" });
  kbId = await getOrCreatePersonalKb(db, uid);
  token = "grt_search";
  await db.insert(schema.apiTokens).values({ id: `tok_${randomUUID().slice(0, 8)}`, userId: uid, name: "t", tokenHash: hashToken(token) });
});
afterAll(async () => { __setSearchRetriever(null); await sql.end(); });

const post = (body: unknown, auth = true) => POST(new NextRequest("http://localhost/api/search", {
  method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
}));

describe("POST /api/search", () => {
  it("returns ranked results for a member", async () => {
    const fake: Retriever = { retrieve: async () => [chunk("Tawaraya is a ryokan.")] };
    __setSearchRetriever(fake);
    const res = await post({ kbId, query: "ryokan" });
    expect(res.status).toBe(200);
    const json = await res.json() as { results: { content: string; title: string | null }[] };
    expect(json.results[0].content).toContain("Tawaraya");
    expect(json.results[0].title).toBe("Kyoto");
  });
  it("401 without auth", async () => {
    expect((await post({ kbId, query: "x" }, false)).status).toBe(401);
  });
  it("403 when not a member of the kb", async () => {
    __setSearchRetriever({ retrieve: async () => [] });
    expect((await post({ kbId: "kb_other", query: "x" })).status).toBe(403);
  });
});
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement `apps/web/app/api/search/route.ts`:**
```ts
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { createDb, schema } from "@gr/db";
import { resolveAuth } from "../../../lib/clerk-auth.js";
import { resolveSearchRetriever } from "../../../lib/search-service.js";

export async function POST(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { kbId, query } = await req.json() as { kbId: string; query: string };
  if (!kbId || !query) return NextResponse.json({ error: "kbId and query required" }, { status: 400 });

  const member = await db.select().from(schema.kbMembers)
    .where(and(eq(schema.kbMembers.kbId, kbId), eq(schema.kbMembers.userId, principal.userId)));
  if (!member[0]) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const hits = await resolveSearchRetriever(db).retrieve(kbId, query);
  const results = hits.map((h) => ({
    chunkId: h.chunkId, documentId: h.documentId, content: h.content,
    title: h.document.title, sourceUrl: h.document.sourceUrl,
  }));
  return NextResponse.json({ results });
}
```

- [ ] **Step 5: Run — expect PASS (3).** **Step 6: Typecheck `@gr/web`.** **Step 7: Commit** `feat(web): /api/search (hybrid retrieval results)`.

---

## Task 9: Search page + library delete button (UI)

**Files:** Create `apps/web/components/search.tsx`, `apps/web/components/search.test.tsx`, `apps/web/app/(app)/search/page.tsx`; modify `apps/web/components/library-list.tsx`.

- [ ] **Step 1: Write the failing component test `apps/web/components/search.test.tsx`** (presentational `Results`):
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Results } from "./search.js";

describe("Results", () => {
  it("renders result snippets with titles, and an empty state", () => {
    const { rerender } = render(<Results results={[]} searched={false} />);
    expect(screen.getByText(/search your library/i)).toBeTruthy();
    rerender(<Results searched results={[{ chunkId: "c1", documentId: "d1", content: "Tawaraya ryokan", title: "Kyoto", sourceUrl: "https://x" }]} />);
    expect(screen.getByText(/Tawaraya ryokan/)).toBeTruthy();
    expect(screen.getByText("Kyoto")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`pnpm --filter @gr/web exec vitest run components/search.test.tsx`).

- [ ] **Step 3: Implement `apps/web/components/search.tsx`** (presentational `Results` + client `Search`; reuse `safeHref` from chat.tsx):
```tsx
"use client";
import { useState, type FormEvent } from "react";
import { safeHref } from "./chat.js";

export interface SearchResult { chunkId: string; documentId: string; content: string; title: string | null; sourceUrl: string | null; }

export function Results({ results, searched }: { results: SearchResult[]; searched: boolean }) {
  if (!searched) return <p className="text-neutral-500">Search your library.</p>;
  if (results.length === 0) return <p className="text-neutral-500">No matches.</p>;
  return (
    <ul className="space-y-3">
      {results.map((r) => (
        <li key={r.chunkId} className="rounded border border-neutral-200 p-3">
          <a href={safeHref(r.sourceUrl)} target="_blank" rel="noopener noreferrer" className="text-sm font-medium">{r.title ?? r.sourceUrl ?? "Untitled"}</a>
          <p className="mt-1 text-sm text-neutral-600">{r.content.slice(0, 240)}</p>
        </li>
      ))}
    </ul>
  );
}

export function Search({ kbId }: { kbId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  async function run(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    const res = await fetch("/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kbId, query }) });
    const json = await res.json() as { results: SearchResult[] };
    setResults(json.results ?? []); setSearched(true);
  }
  return (
    <div className="space-y-4">
      <form onSubmit={run} className="flex gap-2">
        <input className="flex-1 rounded border p-2" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" />
        <button className="rounded bg-neutral-900 px-3 py-1.5 text-white">Search</button>
      </form>
      <Results results={results} searched={searched} />
    </div>
  );
}
```

- [ ] **Step 4: Run the component test — expect PASS.**

- [ ] **Step 5: Create `apps/web/app/(app)/search/page.tsx`:**
```tsx
import { auth } from "@clerk/nextjs/server";
import { createDb } from "@gr/db";
import { getOrCreatePersonalKb } from "@gr/db/queries";
import { Search } from "../../../components/search.js";

export default async function SearchPage() {
  const { userId } = await auth();
  if (!userId) return null;
  const { db } = createDb();
  const kbId = await getOrCreatePersonalKb(db, userId);
  return <Search kbId={kbId} />;
}
```

- [ ] **Step 6: Add a Search nav link + a delete button to the library.** In `apps/web/app/(app)/layout.tsx`, add `<Link href="/search" className="text-neutral-600">Search</Link>` to the nav. Then convert `apps/web/components/library-list.tsx` to include a delete button per row (it becomes a client component):
```tsx
"use client";

export interface LibraryDoc {
  id: string; title: string | null; sourceUrl: string | null;
  kind: string; status: string; capturedAt: Date;
}

export function LibraryList({ docs }: { docs: LibraryDoc[] }) {
  if (docs.length === 0) {
    return <p className="text-neutral-500">Nothing saved yet — add a page to get started.</p>;
  }
  async function remove(id: string) {
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    location.reload();
  }
  return (
    <ul className="divide-y divide-neutral-200">
      {docs.map((d) => (
        <li key={d.id} className="flex items-center justify-between py-3">
          <span className="font-medium">{d.title ?? d.sourceUrl ?? "Untitled"}</span>
          <span className="flex items-center gap-3">
            <span className="text-xs uppercase text-neutral-500">{d.status}</span>
            <button onClick={() => remove(d.id)} className="text-xs text-red-600 hover:underline">Delete</button>
          </span>
        </li>
      ))}
    </ul>
  );
}
```
> The existing `library-list.test.tsx` still passes — it renders with the same props and the empty-state/title/status text is unchanged. (The delete button is not asserted; it's exercised by the route test in Task 7.)

- [ ] **Step 7: Run component tests + typecheck `@gr/web`.** **Step 8: Commit** `feat(web): search page + library delete button`.

---

## Task 10: Full sweep + README

**Files:** Modify `README.md`.

- [ ] **Step 1: Run the full runner** `pnpm test` — all node + component tests pass.
- [ ] **Step 2: Run repo typecheck** `pnpm -r typecheck` — exit 0.
- [ ] **Step 3: Update `README.md`** "Run the web app" step 3 to mention: Save URL now captures the page server-side; a Search page; deleting documents; live citation chips. Note binary file upload + deploy remain (Plan 2c). 
- [ ] **Step 4: Commit** `docs: note Plan 2b web core-completion features`.

---

## Self-Review notes (addressed)

- **Scope coverage:** server-side URL fetch+parse (Tasks 2/3), `assertSafeHttpUrl` scheme allowlist + SSRF guard wired at ingest (Tasks 1/4) and at fetch (Task 2), live citation chips (Task 5), `/api/search` + page (Tasks 8/9), document delete (Tasks 6/7/9). Binary upload + Blob + e2e explicitly OUT (Plan 2c).
- **Type consistency:** `UrlFetcher` / `FetchedContent` defined in Task 2, consumed in Task 3 (`runIngestion` 5th param) and Task 4 (`IngestDeps.urlFetcher`, `processJob`, `ingestAndProcess`); the `IngestDeps` change forces updating the two existing `__setIngestDeps` test call-sites (flagged in Task 4 Step 1). `Citation` (lib/citations.ts) is structurally compatible with the chat `Transcript`'s `{ title, sourceUrl }` (map noted in Task 5 Step 7). `deleteDocument(db, docId, kbId): Promise<boolean>` (Task 6) used by the DELETE route (Task 7). `Retriever` interface (from Plan 2a) reused by the search seam (Task 8). `safeHref` reused from `chat.tsx` (Task 9).
- **Security:** the XSS sink fix from 2a is reinforced server-side (reject unsafe URLs at ingest); the new server-side fetch is SSRF-guarded (private/loopback/metadata hosts blocked, redirects re-validated, 10 MB cap, `redirect: "manual"`). Documented follow-up: DNS-resolution-based SSRF hardening.
- **Local-only:** no Vercel Blob, no Python service, no new dependency. Every route is tested through the API-token path with injected retriever/fetcher/AI.
- **Known interim:** binary URL content (e.g. a PDF link) throws a clear "not supported yet (Plan 2c)" error → the document is marked `failed` with that message, rather than silently breaking.
```
