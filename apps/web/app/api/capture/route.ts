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
 * connection ("network connection was lost") if a request runs long, so the heavy work (fetch /
 * convert / embed) must not block the reply. On Vercel it runs via `after()`; locally and in
 * tests (no serverless request scope) it runs inline so the result is observable synchronously.
 */
async function accept(documentId: string, work: () => Promise<void>) {
  if (process.env.VERCEL) after(work);
  else await work();
  return NextResponse.json({ documentId, status: "pending" }, { status: 202 });
}

/**
 * One-shot capture endpoint for the iOS Shortcut: accepts a single `content` form field — a
 * file, a bare http(s) URL, or plain text — and routes it server-side so the Shortcut needs no
 * type detection. Always targets the caller's personal library.
 */
export async function POST(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Accept a JSON body { content } (simplest request for the Shortcut — no multipart) OR a
  // multipart form field `content` (needed to carry a real file/image).
  const contentType = req.headers.get("content-type") ?? "";
  let content: FormDataEntryValue | null;
  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as { content?: unknown } | null;
    content = typeof body?.content === "string" ? body.content : null;
  } else {
    const form = await req.formData().catch(() => null);
    content = form?.get("content") ?? null;
  }
  const kbId = await getOrCreatePersonalKb(db, principal.userId);
  const deps = resolveIngestDeps();

  // A bare http(s) link is fetched as a page; any other string is a text note. Used for both a
  // plain string field and a text file (the Shortcut may send either), so field type doesn't matter.
  const ingestString = async (s: string) => {
    const isUrl = /^https?:\/\/\S+$/i.test(s);
    const input: IngestInput = isUrl
      ? { kbId, addedBy: principal.userId, captureMode: "url_fetch", kind: "web",
          mimeType: null, sourceUrl: s, title: null, rawContent: "" }
      : { kbId, addedBy: principal.userId, captureMode: "selection", kind: "text",
          mimeType: "text/plain", sourceUrl: null, title: null, rawContent: s };
    const { documentId } = await enqueueIngestion(db, input);
    return accept(documentId, () => processJob(db, deps.ai, deps.converter, deps.urlFetcher, {
      documentId, kbId, mimeType: input.mimeType, text: input.rawContent,
      sourceUrl: input.sourceUrl, filename: input.title,
    }));
  };

  if (content instanceof File) {
    const mimeType = content.type || "application/octet-stream";
    // A text share wrapped as a file (Shortcuts commonly does this for links/selections):
    // decode and route it as a string, so links are still fetched and notes stay notes.
    if (mimeType.startsWith("text/")) {
      const text = new TextDecoder().decode(new Uint8Array(await content.arrayBuffer())).trim();
      if (text) return ingestString(text);
    }
    // A real binary document → blob + converter.
    if (content.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "file too large (max 25 MB)" }, { status: 413 });
    }
    const bytes = new Uint8Array(await content.arrayBuffer());
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
    return ingestString(content.trim());
  }

  return NextResponse.json({ error: "content required" }, { status: 400 });
}
