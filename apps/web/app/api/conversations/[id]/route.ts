import { NextRequest, NextResponse } from "next/server";
import { createDb } from "@gr/db";
import { getConversationForUser, deleteConversation } from "@gr/db/queries";
import { resolveAuth } from "../../../../lib/clerk-auth.js";
import { enrichStoredCitations } from "../../../../lib/citation-enrich.js";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const detail = await getConversationForUser(db, id, principal.userId);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Backfill kind/content on citations stored before those fields existed, so old threads
  // render the correct source icon + snippet on resume.
  const messages = await enrichStoredCitations(db, detail.messages);
  return NextResponse.json({ ...detail, messages });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const ok = await deleteConversation(db, id, principal.userId);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
