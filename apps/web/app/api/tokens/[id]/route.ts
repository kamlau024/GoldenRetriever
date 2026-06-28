import { NextRequest, NextResponse } from "next/server";
import { createDb } from "@gr/db";
import { resolveSessionUser } from "../../../../lib/clerk-auth.js";
import { revokeApiToken } from "../../../../lib/tokens.js";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { db } = createDb();
  const principal = await resolveSessionUser(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const ok = await revokeApiToken(db, principal.userId, id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
