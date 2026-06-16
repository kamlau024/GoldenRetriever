# GoldenRetriever Plan 2c — Binary File Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload a binary document (PDF / Office / image) which is stored in blob storage, converted to markdown via the markitdown service, and ingested into their library — code-complete and tested locally with mocks (live conversion runs once the markitdown service is deployed).

**Architecture:** Adds a `BlobStore` abstraction (in-memory for tests, Vercel Blob for prod) behind a DI seam. A new `POST /api/upload` route accepts multipart form-data, stores the bytes to the blob store, records the document with its `blob_key`, and runs the existing ingestion pipeline with the bytes (which already routes binary content to the `MarkitdownConverter`). The async worker reads the bytes back from the blob store. Everything is unit-tested through injected mocks (`MockConverter` + `InMemoryBlobStore`); the only piece that needs deployment to verify is the live markitdown HTTP call — identical to how Plan 1 handled markitdown.

**Tech Stack:** Next.js App Router (multipart via `req.formData()`), `@vercel/blob` (prod blob impl), the existing `@gr/*` packages. Tests: Vitest (node).

**Scope (Plan 2c):**
- IN: `BlobStore` interface + `InMemoryBlobStore` + `VercelBlobStore`; `/api/upload` (multipart → blob → ingest binary); `insertDocument` gains `blobKey`; worker reads blob bytes for binary kinds; file-upload UI in the library.
- OUT (→ deploy/hardening phase, needs your accounts or is hard to test locally): actual deployment + live PDF→markdown verification; **SSRF IP-pinning** (TOCTOU fix — documented approach below, deferred); Playwright e2e. Document refresh/RSS is Stage 3.

**Note on local verification:** the markitdown Python service needs Python 3.10+/deploy to actually convert a PDF; this plan tests the full Node orchestration with `MockConverter`, so the feature is code-complete and deploy-ready but the real conversion is verified at deploy.

---

## File Structure

```
apps/web/
├─ lib/blob.ts                BlobStore iface + InMemoryBlobStore + VercelBlobStore + DI seam
├─ lib/blob.test.ts           InMemoryBlobStore round-trip + DI
├─ app/api/upload/route.ts    POST multipart → blob → ingest (binary)
├─ app/api/worker/route.ts    (modify) read bytes from blob for binary kinds
├─ test/upload-route.test.ts  auth/validation/membership + happy path (mocked blob+converter)
├─ components/add-content.tsx (modify) add a file input that posts to /api/upload
└─ package.json               (modify) + @vercel/blob

packages/db/src/
├─ queries.ts                 (modify) insertDocument gains optional blobKey
└─ queries.delete.test.ts ... (existing tests unaffected)
```

---

## Task 1: `BlobStore` abstraction + in-memory impl

**Files:** Create `apps/web/lib/blob.ts`, `apps/web/lib/blob.test.ts`; modify `apps/web/package.json`.

- [ ] **Step 1: Add the Vercel Blob dependency** (used only by the prod impl; tests use the in-memory one):

Run: `pnpm --filter @gr/web add @vercel/blob`

- [ ] **Step 2: Write the failing test `apps/web/lib/blob.test.ts`:**
```ts
import { describe, it, expect } from "vitest";
import { InMemoryBlobStore, resolveBlobStore, __setBlobStore } from "./blob.js";

describe("InMemoryBlobStore", () => {
  it("round-trips bytes and content type, and deletes", async () => {
    const store = new InMemoryBlobStore();
    const ref = await store.put(new Uint8Array([1, 2, 3]), "application/pdf");
    expect(typeof ref).toBe("string");
    const got = await store.get(ref);
    expect(Array.from(got)).toEqual([1, 2, 3]);
    await store.del(ref);
    await expect(store.get(ref)).rejects.toThrow();
  });
});

describe("blob store DI seam", () => {
  it("returns the override when set", () => {
    const fake = new InMemoryBlobStore();
    __setBlobStore(fake);
    expect(resolveBlobStore()).toBe(fake);
    __setBlobStore(null);
  });
});
```

- [ ] **Step 3: Run — expect FAIL** (`DATABASE_URL=… AI_GATEWAY_API_KEY=test pnpm vitest run apps/web/lib/blob.test.ts`).

- [ ] **Step 4: Implement `apps/web/lib/blob.ts`:**
```ts
import { randomUUID } from "node:crypto";

/** Opaque-ref blob storage. `put` returns a ref to store on the document. */
export interface BlobStore {
  put(bytes: Uint8Array, contentType: string): Promise<string>;
  get(ref: string): Promise<Uint8Array>;
  del(ref: string): Promise<void>;
}

export class InMemoryBlobStore implements BlobStore {
  private map = new Map<string, { bytes: Uint8Array; contentType: string }>();
  async put(bytes: Uint8Array, contentType: string): Promise<string> {
    const ref = `mem://${randomUUID()}`;
    this.map.set(ref, { bytes, contentType });
    return ref;
  }
  async get(ref: string): Promise<Uint8Array> {
    const e = this.map.get(ref);
    if (!e) throw new Error(`blob not found: ${ref}`);
    return e.bytes;
  }
  async del(ref: string): Promise<void> { this.map.delete(ref); }
}

/** Vercel Blob impl (prod). The returned URL is the ref. Requires BLOB_READ_WRITE_TOKEN. */
export class VercelBlobStore implements BlobStore {
  async put(bytes: Uint8Array, contentType: string): Promise<string> {
    const { put } = await import("@vercel/blob");
    const { url } = await put(`uploads/${randomUUID()}`, Buffer.from(bytes), {
      access: "public", contentType, addRandomSuffix: false,
    });
    return url;
  }
  async get(ref: string): Promise<Uint8Array> {
    const res = await fetch(ref);
    if (!res.ok) throw new Error(`blob fetch failed ${res.status}: ${ref}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  async del(ref: string): Promise<void> {
    const { del } = await import("@vercel/blob");
    await del(ref);
  }
}

let override: BlobStore | null = null;
export function __setBlobStore(s: BlobStore | null) { override = s; }
export function resolveBlobStore(): BlobStore {
  return override ?? new VercelBlobStore();
}
```
> `@vercel/blob` is imported dynamically inside the prod impl so tests (which use `InMemoryBlobStore`) never load it.

- [ ] **Step 5: Run — expect PASS (2).** **Step 6: Typecheck** `pnpm --filter @gr/web typecheck`. **Step 7: Commit** `feat(web): BlobStore abstraction (in-memory + Vercel Blob)`.

---

## Task 2: `insertDocument` accepts `blobKey`

**Files:** Modify `packages/db/src/queries.ts`; create `packages/db/src/queries.blob.test.ts`.

- [ ] **Step 1: Write the failing test `packages/db/src/queries.blob.test.ts`:**
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb } from "./client.js";
import { createUser, createKnowledgeBase, insertDocument, getDocument } from "./queries.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, userId: string;
beforeAll(async () => {
  userId = await createUser(db, { id: "u_blob", email: "b@b.dev" });
  kbId = await createKnowledgeBase(db, { ownerId: userId, name: "Blob" });
});
afterAll(async () => { await sql.end(); });

it("persists a blobKey on the document", async () => {
  const docId = await insertDocument(db, {
    kbId, addedBy: userId, kind: "pdf", captureMode: "upload",
    sourceUrl: null, title: "report.pdf", mimeType: "application/pdf", blobKey: "mem://abc",
  });
  const doc = await getDocument(db, docId, kbId);
  expect(doc?.blobKey).toBe("mem://abc");
});
```

- [ ] **Step 2: Run — expect FAIL** (insertDocument rejects `blobKey`).

- [ ] **Step 3: Modify `insertDocument` in `packages/db/src/queries.ts`** — add `blobKey` to the param type and the insert values:
  - Param type: add `blobKey?: string | null;`
  - In `.values({...})`: add `blobKey: d.blobKey ?? null,`

- [ ] **Step 4: Run — expect PASS.** **Step 5: Typecheck `@gr/db`.** **Step 6: Commit** `feat(db): insertDocument accepts blobKey`.

---

## Task 3: `POST /api/upload` (multipart → blob → ingest)

**Files:** Create `apps/web/app/api/upload/route.ts`, `apps/web/test/upload-route.test.ts`.

The route shares the auth/membership pattern with `/api/ingest`. It reads the file, stores it to the blob store, records the document with `blobKey`, and processes it in-process (passing the bytes directly to `processJob`, which routes binary content to the converter). A `kind` is derived from the MIME type.

- [ ] **Step 1: Write the failing test `apps/web/test/upload-route.test.ts`:**
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser, getOrCreatePersonalKb, getDocument } from "@gr/db/queries";
import { createMockAiClient } from "@gr/ai/mock";
import { MockConverter } from "@gr/ingest";
import { hashToken } from "../lib/auth.js";
import { __setIngestDeps } from "../lib/ingest-service.js";
import { InMemoryBlobStore, __setBlobStore } from "../lib/blob.js";
import { POST } from "../app/api/upload/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, token: string;

const upload = (kb: string, file: File | null, auth = true) => {
  const fd = new FormData();
  fd.set("kbId", kb);
  if (file) fd.set("file", file);
  return POST(new NextRequest("http://localhost/api/upload", {
    method: "POST", headers: auth ? { authorization: `Bearer ${token}` } : {}, body: fd,
  }));
};
const pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "report.pdf", { type: "application/pdf" });

beforeAll(async () => {
  const uid = await createUser(db, { id: "u_upload", email: "up@up.dev" });
  kbId = await getOrCreatePersonalKb(db, uid);
  token = "grt_upload";
  await db.insert(schema.apiTokens).values({ id: `tok_${randomUUID().slice(0, 8)}`, userId: uid, name: "t", tokenHash: hashToken(token) });
  __setBlobStore(new InMemoryBlobStore());
  __setIngestDeps({ ai: createMockAiClient(), converter: new MockConverter("# PDF\n\nReport about Kyoto."), urlFetcher: async () => ({ kind: "text" as const, mimeType: "text/plain", text: "" }) });
});
afterAll(async () => { __setBlobStore(null); __setIngestDeps(null); await sql.end(); });

describe("POST /api/upload", () => {
  it("401 without auth", async () => { expect((await upload(kbId, pdf(), false)).status).toBe(401); });
  it("400 without a file", async () => { expect((await upload(kbId, null)).status).toBe(400); });
  it("403 for a kb the caller is not a member of", async () => { expect((await upload("kb_other", pdf())).status).toBe(403); });
  it("stores the file and ingests it to ready", async () => {
    delete process.env.APP_URL;
    const res = await upload(kbId, pdf());
    expect(res.status).toBe(202);
    const { documentId } = await res.json() as { documentId: string };
    const doc = await getDocument(db, documentId, kbId);
    expect(doc?.status).toBe("ready");
    expect(doc?.blobKey).toMatch(/^mem:\/\//);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (no route).

- [ ] **Step 3: Implement `apps/web/app/api/upload/route.ts`:**
```ts
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { createDb, schema } from "@gr/db";
import { insertDocument } from "@gr/db/queries";
import type { DocumentKind } from "@gr/core";
import { resolveAuth } from "../../../lib/clerk-auth.js";
import { resolveBlobStore } from "../../../lib/blob.js";
import { resolveIngestDeps, processJob } from "../../../lib/ingest-service.js";

function kindForMime(mime: string): DocumentKind {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  return "document";
}

export async function POST(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const kbId = form.get("kbId");
  const file = form.get("file");
  if (typeof kbId !== "string" || !(file instanceof File)) {
    return NextResponse.json({ error: "kbId and file required" }, { status: 400 });
  }

  const member = await db.select().from(schema.kbMembers)
    .where(and(eq(schema.kbMembers.kbId, kbId), eq(schema.kbMembers.userId, principal.userId)));
  if (!member[0]) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  const blobKey = await resolveBlobStore().put(bytes, mimeType);

  const documentId = await insertDocument(db, {
    kbId, addedBy: principal.userId, kind: kindForMime(mimeType), captureMode: "upload",
    sourceUrl: null, title: file.name, mimeType, blobKey,
  });
  await db.insert(schema.ingestionJobs).values({
    id: `job_${crypto.randomUUID().slice(0, 12)}`, documentId, type: "ingest", status: "queued",
  });

  // Process in-process with the bytes we already have (the converter routes binary → markitdown).
  // Async deployments read the bytes back from the blob store in the worker.
  const { ai, converter, urlFetcher } = resolveIngestDeps();
  await processJob(db, ai, converter, urlFetcher, {
    documentId, kbId, mimeType, bytes, filename: file.name,
  });
  return NextResponse.json({ documentId, status: "pending" }, { status: 202 });
}
```

- [ ] **Step 4: Run — expect PASS (4).** **Step 5: Typecheck `@gr/web`.** **Step 6: Commit** `feat(web): /api/upload (multipart → blob → markitdown ingest)`.

---

## Task 4: Worker reads blob bytes for binary kinds

**Files:** Modify `apps/web/app/api/worker/route.ts`.

The async worker currently only has the text payload from `metadata`. For uploaded binary documents it must read the bytes from the blob store and pass them to `processJob`.

- [ ] **Step 1: Edit `apps/web/app/api/worker/route.ts`** — after loading `doc` and before `processJob`, resolve binary bytes from the blob store when present:
  - Add import: `import { resolveBlobStore } from "../../../lib/blob.js";`
  - Replace the existing `processJob(...)` call block with:
    ```ts
    const text = (doc.metadata as { rawContent?: string } | null)?.rawContent ?? "";
    const bytes = doc.blobKey ? await resolveBlobStore().get(doc.blobKey) : undefined;
    await processJob(db, createAiClient(), new MarkitdownConverter(), fetchUrlContent, {
      documentId, kbId: doc.kbId, mimeType: doc.mimeType,
      text: bytes ? undefined : text, bytes, sourceUrl: doc.sourceUrl, filename: doc.title,
    });
    ```

- [ ] **Step 2: Typecheck `@gr/web`** (the worker's success path is verified via the upload-route test + at deploy; the existing worker-route test only covers the 500/403/404 short-circuits, which are unchanged). Run the worker-route test to confirm no regression:
  `DATABASE_URL=… AI_GATEWAY_API_KEY=test pnpm vitest run apps/web/test/worker-route.test.ts` → 3 pass.

- [ ] **Step 3: Commit** `feat(web): worker reads blob bytes for binary documents`.

---

## Task 5: File-upload UI

**Files:** Modify `apps/web/components/add-content.tsx`.

- [ ] **Step 1: Add a file input + upload handler to `apps/web/components/add-content.tsx`.** Inside the `AddContent` component, add a file-upload section (keep the existing text/URL inputs). Add this handler and markup:
  - Handler (add alongside the existing `submit`):
    ```ts
    async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
      const file = e.target.files?.[0];
      if (!file) return;
      setBusy(true);
      const fd = new FormData();
      fd.set("kbId", kbId);
      fd.set("file", file);
      await fetch("/api/upload", { method: "POST", body: fd });
      setBusy(false);
      location.reload();
    }
    ```
    (Add `import { ... , type ChangeEvent } from "react";` if you prefer typed events; `React.ChangeEvent` also works since React types are available.)
  - Markup (add a third row in the returned JSX, after the URL row):
    ```tsx
      <div className="flex items-center gap-2">
        <label className="text-sm text-neutral-600">Upload a PDF/doc/image:</label>
        <input type="file" disabled={busy} onChange={uploadFile}
          accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg" />
      </div>
    ```

- [ ] **Step 2: Typecheck `@gr/web`** (exit 0). The add-content component has no unit test (it's a thin client form; the upload route is tested in Task 3). 

- [ ] **Step 3: Commit** `feat(web): file upload control in add-content`.

---

## Task 6: Full sweep + README + deferred-work note

**Files:** Modify `README.md`.

- [ ] **Step 1: Run the full runner** `pnpm test` — all node + component tests green (the prior 74 + blob (2) + queries.blob (1) + upload-route (4) = 81).
- [ ] **Step 2: Run repo typecheck** `pnpm -r typecheck` — exit 0.
- [ ] **Step 3: Update `README.md`** "Run the web app" step 3 to mention file upload (PDF/doc/image) now works once the markitdown service is reachable; and add a short "Deploy (TODO)" note listing what remains: provision Vercel + Neon + Clerk + AI Gateway + Blob, deploy `services/convert`, set `BLOB_READ_WRITE_TOKEN` / `MARKITDOWN_URL` / `MARKITDOWN_SECRET`, and the SSRF IP-pinning + Playwright e2e hardening.
- [ ] **Step 4: Commit** `docs: note binary upload + remaining deploy/hardening work`.

---

## Deferred (documented, NOT in this plan)

- **Live PDF→markdown verification:** needs the markitdown service deployed (or local Python 3.10+). The Node orchestration is fully tested with `MockConverter`.
- **SSRF IP-pinning (TOCTOU):** resolve the host once, then fetch pinned to that IP. Approach: build an `undici.Agent({ connect: { lookup: (host, opts, cb) => cb(null, pinnedIp, family) } })` after `assertSafeHttpUrl` returns the validated address, and pass it as `dispatcher` to `fetch`, preserving the `Host` header + TLS servername. Hard to unit-test hermetically — pair with deploy.
- **Deployment:** provision Vercel/Neon/Clerk/AI Gateway/Blob; deploy `services/convert`; wire env. Needs your accounts + interactive logins (and `npm i -g vercel`).
- **Playwright e2e:** sign-in (Clerk test mode) → upload/save → search → chat → delete; needs Clerk dev keys.

---

## Self-Review notes (addressed)

- **Scope coverage:** BlobStore (Task 1), `blobKey` persistence (Task 2), upload route incl. auth/validation/membership + happy path (Task 3), worker blob-read (Task 4), UI (Task 5). Live conversion + deploy + IP-pinning + e2e explicitly deferred and documented.
- **Type consistency:** `BlobStore.put/get/del` (Task 1) used by the upload route (Task 3) and worker (Task 4) and the test seam `__setBlobStore`; `insertDocument`'s new `blobKey?` (Task 2) used by the upload route (Task 3) and asserted in tests; `processJob(db, ai, converter, urlFetcher, args)` (current signature) called with `bytes` in Task 3 and Task 4 — `args.bytes` is already part of `processJob`/`runIngestion`. `resolveIngestDeps()` returns `{ ai, converter, urlFetcher }` (current shape) — used in Task 3.
- **Testability:** the upload route is exercised through the API-token path with `InMemoryBlobStore` + `MockConverter` + injected ingest deps — no Vercel Blob, no live markitdown, no Clerk. `VercelBlobStore` and the worker's live binary path are verified at deploy (same posture as Plan 1's markitdown).
- **Known interim:** uploaded binary documents store bytes in the blob store; the worker reads them back for the async path. The in-memory store is process-local (fine for tests/local dev); production uses Vercel Blob.
