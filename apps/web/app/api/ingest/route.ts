import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { createDb, schema } from "@gr/db";
import { getOrCreatePersonalKb } from "@gr/db/queries";
import { resolveAuth } from "../../../lib/clerk-auth.js";
import { enqueueIngestion, processJob, resolveIngestDeps } from "../../../lib/ingest-service.js";
import { isSafeHttpUrl } from "@gr/ingest";
import type { CaptureMode, DocumentKind } from "@gr/core";

export async function POST(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json() as {
    kbId?: string; url?: string; title?: string; text?: string; html?: string;
    captureMode?: CaptureMode;
  };
  if (!body.text && !body.html && !body.url) {
    return NextResponse.json({ error: "one of {text, html, url} required" }, { status: 400 });
  }

  if (body.url && !(await isSafeHttpUrl(body.url))) {
    return NextResponse.json({ error: "url must be a public http(s) URL" }, { status: 400 });
  }

  // kbId is optional: capture clients (iOS Shortcut) send only a token → use the
  // caller's personal KB. When a kbId is supplied, the membership check below applies.
  const kbId = body.kbId ?? (await getOrCreatePersonalKb(db, principal.userId));

  // Authorization: the caller must be an owner/editor of the target KB (prevents IDOR —
  // writing into a knowledge base they don't belong to).
  const membership = await db.select().from(schema.kbMembers)
    .where(and(eq(schema.kbMembers.kbId, kbId), eq(schema.kbMembers.userId, principal.userId)));
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
    kbId, addedBy: principal.userId, captureMode, kind, mimeType,
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
    const { ai, converter, urlFetcher } = resolveIngestDeps();
    await processJob(db, ai, converter, urlFetcher, {
      documentId, kbId, mimeType,
      text: body.html ?? body.text ?? "", sourceUrl: body.url ?? null, filename: body.title ?? null,
    });
  }
  return NextResponse.json({ documentId, jobId, status: "pending" }, { status: 202 });
}
