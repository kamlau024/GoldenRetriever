import { NextRequest, NextResponse } from "next/server";
import { createDb } from "@gr/db";
import { getConversationForUser, deleteConversation, renameConversation } from "@gr/db/queries";
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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { title?: unknown };
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  const ok = await renameConversation(db, id, principal.userId, title);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, title });
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
