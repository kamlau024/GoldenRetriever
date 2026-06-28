import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createDb, schema } from "@gr/db";
import { insertDocument, getOrCreatePersonalKb } from "@gr/db/queries";
import type { DocumentKind } from "@gr/core";
import { resolveAuth } from "../../../lib/clerk-auth.js";
import { resolveBlobStore } from "../../../lib/blob.js";
import { resolveIngestDeps, processJob } from "../../../lib/ingest-service.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

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
  const kbIdRaw = form.get("kbId");
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  const kbId = typeof kbIdRaw === "string" && kbIdRaw
    ? kbIdRaw
    : await getOrCreatePersonalKb(db, principal.userId);
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "file too large (max 25 MB)" }, { status: 413 });
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
    id: `job_${randomUUID().slice(0, 12)}`, documentId, type: "ingest", status: "queued",
  });

  // Process in-process with the bytes we already have (the converter routes binary → markitdown).
  // Async deployments read the bytes back from the blob store in the worker.
  const { ai, converter, urlFetcher } = resolveIngestDeps();
  await processJob(db, ai, converter, urlFetcher, {
    documentId, kbId, mimeType, bytes, filename: file.name,
  });
  return NextResponse.json({ documentId, status: "pending" }, { status: 202 });
}
