import { NextRequest, NextResponse } from "next/server";
import { createDb } from "@gr/db";
import { getOrCreatePersonalKb, listConversations } from "@gr/db/queries";
import { resolveAuth } from "../../../lib/clerk-auth.js";

export async function GET(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const kbId = await getOrCreatePersonalKb(db, principal.userId);
  const conversations = await listConversations(db, principal.userId, kbId);
  return NextResponse.json({ conversations });
}
