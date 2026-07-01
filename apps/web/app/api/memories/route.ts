import { NextRequest, NextResponse } from "next/server";
import { createDb } from "@gr/db";
import { listMemories, clearMemories } from "@gr/db/queries";
import { resolveSessionUser } from "../../../lib/clerk-auth.js";

export async function GET(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveSessionUser(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ memories: await listMemories(db, principal.userId) });
}

export async function DELETE(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveSessionUser(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await clearMemories(db, principal.userId);
  return NextResponse.json({ ok: true });
}
