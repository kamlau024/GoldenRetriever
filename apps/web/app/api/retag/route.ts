import { NextRequest, NextResponse } from "next/server";
import { createDb } from "@gr/db";
import { getOrCreatePersonalKb, untaggedDocsContent, setDocumentTags } from "@gr/db/queries";
import { resolveAuth } from "../../../lib/clerk-auth.js";
import { resolveIngestDeps } from "../../../lib/ingest-service.js";

/**
 * Maintenance: (re)compute auto-tags for the caller's documents that have none yet — e.g.
 * documents saved before tagging stored its results. Bounded to the caller's personal KB and
 * only untagged docs, so it's safe to run repeatedly (idempotent / no-op once tagged).
 */
export async function POST(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const kbId = await getOrCreatePersonalKb(db, principal.userId);
  const docs = await untaggedDocsContent(db, kbId);
  const { ai } = resolveIngestDeps();

  let tagged = 0;
  for (const d of docs) {
    try {
      const slugs = await ai.tag(d.content.slice(0, 6000));
      if (slugs.length) {
        await setDocumentTags(db, kbId, d.id, slugs);
        tagged++;
      }
    } catch { /* skip this doc, keep going */ }
  }
  return NextResponse.json({ scanned: docs.length, tagged });
}
