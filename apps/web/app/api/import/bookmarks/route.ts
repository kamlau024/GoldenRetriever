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

  let body: { kbId?: string; items?: { url?: unknown; title?: unknown }[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
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
  let failed = 0;
  for (const item of items) {
    const url = typeof item?.url === "string" ? item.url.trim() : "";
    if (!url || !(await isSafeHttpUrl(url))) { skipped++; continue; }
    const title = typeof item?.title === "string" && item.title.trim() ? item.title.trim().slice(0, 300) : null;
    try {
      const { documentId, jobId } = await enqueueIngestion(db, {
        kbId, addedBy: principal.userId, captureMode: "url_fetch", kind: "web", mimeType: null,
        sourceUrl: url, title, rawContent: "",
      });
      if (base) {
        void fetch(`${base}/api/worker`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-worker-secret": process.env.WORKER_SECRET ?? "" },
          body: JSON.stringify({ jobId, documentId }),
        });
      } else {
        // In-process (no worker configured): fetch/convert/embed here. A single page that blocks
        // bots, times out, or yields no text must NOT fail the whole import — count it and move on.
        await processJob(db, deps!.ai, deps!.converter, deps!.urlFetcher, {
          documentId, kbId, mimeType: null, text: "", sourceUrl: url, filename: title,
        });
      }
      queued++;
    } catch {
      failed++;
    }
  }
  return NextResponse.json({ queued, skipped, failed }, { status: 202 });
}
