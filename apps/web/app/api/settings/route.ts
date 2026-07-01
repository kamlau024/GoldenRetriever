import { NextRequest, NextResponse } from "next/server";
import { createDb } from "@gr/db";
import { setMemoryEnabled } from "@gr/db/queries";
import { resolveSessionUser } from "../../../lib/clerk-auth.js";

export async function PATCH(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveSessionUser(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { memoryEnabled?: boolean };
  if (typeof body.memoryEnabled !== "boolean") return NextResponse.json({ error: "memoryEnabled (boolean) required" }, { status: 400 });
  await setMemoryEnabled(db, principal.userId, body.memoryEnabled);
  return NextResponse.json({ ok: true });
}
