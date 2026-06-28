import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createDb, schema } from "@gr/db";
import { insertDocument, getOrCreatePersonalKb } from "@gr/db/queries";
import type { DocumentKind } from "@gr/core";
import { resolveAuth } from "../../../lib/clerk-auth.js";
import { resolveBlobStore } from "../../../lib/blob.js";
import { resolveIngestDeps, processJob, ingestAndProcess } from "../../../lib/ingest-service.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

function kindForMime(mime: string): DocumentKind {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  return "document";
}

/**
 * One-shot capture endpoint for the iOS Shortcut: accepts a single `content` form field —
 * a file, a bare http(s) URL, or plain text — and routes it server-side so the Shortcut needs
 * no type detection. Always targets the caller's personal library (token maps to a user).
 * SSRF for the URL path is enforced downstream by the ingest pipeline's guarded fetch.
 */
export async function POST(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const content = form.get("content");
  const kbId = await getOrCreatePersonalKb(db, principal.userId);
  const deps = resolveIngestDeps();

  // A bare http(s) link is fetched as a page; any other string is a text note. Used for both
  // a plain string field and a text file (the Shortcut may send either, depending on how the
  // "content" form field is typed — this makes that choice not matter).
  const ingestString = async (s: string) => {
    const isUrl = /^https?:\/\/\S+$/i.test(s);
    const { documentId } = await ingestAndProcess(db, deps.ai, deps.converter, deps.urlFetcher,
      isUrl
        ? { kbId, addedBy: principal.userId, captureMode: "url_fetch", kind: "web",
            mimeType: null, sourceUrl: s, title: null, rawContent: "" }
        : { kbId, addedBy: principal.userId, captureMode: "selection", kind: "text",
            mimeType: "text/plain", sourceUrl: null, title: null, rawContent: s },
    );
    return documentId;
  };

  if (content instanceof File) {
    const mimeType = content.type || "application/octet-stream";
    // A text share wrapped as a file (Shortcuts commonly does this for links/selections):
    // decode and route it as a string, so links are still fetched and notes stay notes.
    if (mimeType.startsWith("text/")) {
      const text = new TextDecoder().decode(new Uint8Array(await content.arrayBuffer())).trim();
      if (text) {
        return NextResponse.json({ documentId: await ingestString(text), status: "pending" }, { status: 202 });
      }
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
    await processJob(db, deps.ai, deps.converter, deps.urlFetcher, { documentId, kbId, mimeType, bytes, filename: content.name });
    return NextResponse.json({ documentId, status: "pending" }, { status: 202 });
  }

  if (typeof content === "string" && content.trim()) {
    return NextResponse.json({ documentId: await ingestString(content.trim()), status: "pending" }, { status: 202 });
  }

  return NextResponse.json({ error: "content required" }, { status: 400 });
}
