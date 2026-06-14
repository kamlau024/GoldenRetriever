import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { createDb, schema } from "@gr/db";
import { verifyApiToken } from "../../../lib/auth.js";
import { enqueueIngestion, processJob, resolveIngestDeps } from "../../../lib/ingest-service.js";
import type { CaptureMode, DocumentKind } from "@gr/core";

export async function POST(req: NextRequest) {
  const { db } = createDb();
  const auth = await verifyApiToken(db, req.headers.get("authorization")?.replace(/^Bearer /, ""));
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json() as {
    kbId: string; url?: string; title?: string; text?: string; html?: string;
    captureMode?: CaptureMode;
  };
  if (!body.kbId || (!body.text && !body.html && !body.url)) {
    return NextResponse.json({ error: "kbId and one of {text, html, url} required" }, { status: 400 });
  }

  // Authorization: the caller must be an owner/editor of the target KB (prevents IDOR —
  // writing into a knowledge base they don't belong to).
  const membership = await db.select().from(schema.kbMembers)
    .where(and(eq(schema.kbMembers.kbId, body.kbId), eq(schema.kbMembers.userId, auth.userId)));
  const role = membership[0]?.role;
  if (role !== "owner" && role !== "editor") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const captureMode: CaptureMode = body.captureMode ?? (body.html ? "full_dom" : body.text ? "selection" : "url_fetch");
  const kind: DocumentKind = body.html || body.url ? "web" : "text";
  // Plan 1 accepts text/html payloads. A bare `url` pointing at a binary doc
  // (PDF/Office/image) is fetched + typed server-side in Plan 2; mimeType stays null here.
  const mimeType: string | null = body.html ? "text/html" : body.text ? "text/plain" : null;

  const { documentId, jobId } = await enqueueIngestion(db, {
    kbId: body.kbId, addedBy: auth.userId, captureMode, kind, mimeType,
    sourceUrl: body.url ?? null, title: body.title ?? null,
    rawContent: body.html ?? body.text ?? "",
  });

  // Trigger processing. We never derive the worker URL from the request (host-header
  // SSRF / worker-secret leak). When a CONFIGURED absolute base URL exists we hand off
  // asynchronously; otherwise (local/dev) we run the pipeline in-process. Vercel Queues
  // replace this hand-off in Plan 2.
  const base = process.env.APP_URL?.replace(/\/$/, "");
  if (base) {
    void fetch(`${base}/api/worker`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-secret": process.env.WORKER_SECRET ?? "" },
      body: JSON.stringify({ jobId, documentId }),
    });
  } else {
    const { ai, converter } = resolveIngestDeps();
    await processJob(db, ai, converter, {
      documentId, kbId: body.kbId, mimeType,
      text: body.html ?? body.text ?? "", sourceUrl: body.url ?? null, filename: body.title ?? null,
    });
  }
  return NextResponse.json({ documentId, jobId, status: "pending" }, { status: 202 });
}
