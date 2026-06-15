import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { createDb, schema } from "@gr/db";
import { resolveAuth } from "../../../lib/clerk-auth.js";
import { resolveSearchRetriever } from "../../../lib/search-service.js";

export async function POST(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { kbId, query } = await req.json() as { kbId: string; query: string };
  if (!kbId || !query) return NextResponse.json({ error: "kbId and query required" }, { status: 400 });

  const member = await db.select().from(schema.kbMembers)
    .where(and(eq(schema.kbMembers.kbId, kbId), eq(schema.kbMembers.userId, principal.userId)));
  if (!member[0]) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const hits = await resolveSearchRetriever(db).retrieve(kbId, query);
  const results = hits.map((h) => ({
    chunkId: h.chunkId, documentId: h.documentId, content: h.content,
    title: h.document.title, sourceUrl: h.document.sourceUrl,
  }));
  return NextResponse.json({ results });
}
