import { NextRequest, NextResponse } from "next/server";
import { createDb } from "@gr/db";
import { verifyApiToken } from "../../../lib/auth.js";
import { enqueueIngestion } from "../../../lib/ingest-service.js";
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
  // Fire-and-forget the worker (Vercel Queues replace this in infra setup).
  void fetch(new URL("/api/worker", req.url), {
    method: "POST",
    headers: { "content-type": "application/json", "x-worker-secret": process.env.WORKER_SECRET ?? "dev" },
    body: JSON.stringify({ jobId, documentId }),
  });
  return NextResponse.json({ documentId, jobId, status: "pending" }, { status: 202 });
}
