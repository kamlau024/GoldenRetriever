import { NextRequest, NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import { createDb, schema } from "@gr/db";
import { insertDocument, getOrCreatePersonalKb } from "@gr/db/queries";
import type { DocumentKind, IngestInput } from "@gr/core";
import { resolveAuth } from "../../../lib/clerk-auth.js";
import { resolveBlobStore } from "../../../lib/blob.js";
import { resolveIngestDeps, enqueueIngestion, processJob } from "../../../lib/ingest-service.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

function kindForMime(mime: string): DocumentKind {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  return "document";
}

/**
 * Reply 202 immediately and finish ingestion AFTER the response. The iOS Share Sheet drops the
 * connection if a request runs long, so the heavy work (fetch / convert / embed) must not block
 * the reply. On Vercel it runs via `after()`; locally/in tests it runs inline so results are
 * observable synchronously.
 */
async function accept(documentId: string, work: () => Promise<void>) {
  if (process.env.VERCEL) after(work);
  else await work();
  return NextResponse.json({ documentId, status: "pending" }, { status: 202 });
}

/** Route a captured string — a bare http(s) link is fetched as a page, anything else is a note. */
async function captureString(db: ReturnType<typeof createDb>["db"], userId: string, s: string) {
  const kbId = await getOrCreatePersonalKb(db, userId);
  const deps = resolveIngestDeps();
  const isUrl = /^https?:\/\/\S+$/i.test(s);
  const input: IngestInput = isUrl
    ? { kbId, addedBy: userId, captureMode: "url_fetch", kind: "web",
        mimeType: null, sourceUrl: s, title: null, rawContent: "" }
    : { kbId, addedBy: userId, captureMode: "selection", kind: "text",
        mimeType: "text/plain", sourceUrl: null, title: null, rawContent: s };
  const { documentId } = await enqueueIngestion(db, input);
  return accept(documentId, () => processJob(db, deps.ai, deps.converter, deps.urlFetcher, {
    documentId, kbId, mimeType: input.mimeType, text: input.rawContent,
    sourceUrl: input.sourceUrl, filename: input.title,
  }));
}

/**
 * GET serves two purposes:
 *  - no `content` param → a no-auth liveness probe (lets a Shortcut confirm reachability).
 *  - `?content=…` + `Authorization: Bearer <token>` → capture via GET. iOS URLSession can fail to
 *    upload a POST body over HTTP/2 ("network connection was lost"), but plain GETs (headers
 *    included) work — so the Shortcut sends the content in the query string.
 *
 * A `?token=` query param is always rejected, even alongside a valid header: API tokens grant
 * full library access (read, chat, delete), and URLs are written to server logs.
 */
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  if (params.has("token")) {
    return NextResponse.json(
      { error: "tokens in the URL are not accepted; send an 'Authorization: Bearer <token>' header instead" },
      { status: 401 },
    );
  }
  const content = params.get("content");
  if (!content || !content.trim()) {
    return NextResponse.json({ ok: true, service: "capture" });
  }
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return captureString(db, principal.userId, content.trim());
}

/**
 * POST accepts a JSON `{ content }` body or a multipart `content` field (the latter can carry a
 * real file/image). Always targets the caller's personal library.
 */
export async function POST(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") ?? "";
  let content: FormDataEntryValue | null;
  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as { content?: unknown } | null;
    content = typeof body?.content === "string" ? body.content : null;
  } else {
    const form = await req.formData().catch(() => null);
    content = form?.get("content") ?? null;
  }

  if (content instanceof File) {
    const mimeType = content.type || "application/octet-stream";
    if (mimeType.startsWith("text/")) {
      const text = new TextDecoder().decode(new Uint8Array(await content.arrayBuffer())).trim();
      if (text) return captureString(db, principal.userId, text);
    }
    if (content.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "file too large (max 25 MB)" }, { status: 413 });
    }
    const bytes = new Uint8Array(await content.arrayBuffer());
    const kbId = await getOrCreatePersonalKb(db, principal.userId);
    const deps = resolveIngestDeps();
    const blobKey = await resolveBlobStore().put(bytes, mimeType);
    const documentId = await insertDocument(db, {
      kbId, addedBy: principal.userId, kind: kindForMime(mimeType), captureMode: "upload",
      sourceUrl: null, title: content.name, mimeType, blobKey,
    });
    await db.insert(schema.ingestionJobs).values({
      id: `job_${randomUUID().slice(0, 12)}`, documentId, type: "ingest", status: "queued",
    });
    return accept(documentId, () => processJob(db, deps.ai, deps.converter, deps.urlFetcher, {
      documentId, kbId, mimeType, bytes, filename: content.name,
    }));
  }

  if (typeof content === "string" && content.trim()) {
    return captureString(db, principal.userId, content.trim());
  }

  return NextResponse.json({ error: "content required" }, { status: 400 });
}
