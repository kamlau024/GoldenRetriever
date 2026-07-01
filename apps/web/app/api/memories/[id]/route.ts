import { NextRequest, NextResponse } from "next/server";
import { createDb } from "@gr/db";
import { updateMemory, deleteMemory } from "@gr/db/queries";
import { resolveSessionUser } from "../../../../lib/clerk-auth.js";
import { resolveIngestDeps } from "../../../../lib/ingest-service.js";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { db } = createDb();
  const principal = await resolveSessionUser(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { content?: string };
  const content = (body.content ?? "").trim();
  if (!content || content.length > 500) return NextResponse.json({ error: "content required (1-500 chars)" }, { status: 400 });
  const [embedding] = await resolveIngestDeps().ai.embed([content]);
  const ok = await updateMemory(db, id, principal.userId, content, embedding);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { db } = createDb();
  const principal = await resolveSessionUser(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const ok = await deleteMemory(db, id, principal.userId);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
