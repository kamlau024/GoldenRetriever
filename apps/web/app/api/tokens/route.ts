import { NextRequest, NextResponse } from "next/server";
import { createDb } from "@gr/db";
import { resolveSessionUser } from "../../../lib/clerk-auth.js";
import { createApiToken, listApiTokens } from "../../../lib/tokens.js";

export async function POST(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveSessionUser(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { name?: string };
  const name = (body.name ?? "").trim();
  if (!name || name.length > 64) {
    return NextResponse.json({ error: "name required (1-64 chars)" }, { status: 400 });
  }
  const { id, token } = await createApiToken(db, principal.userId, name);
  return NextResponse.json({ id, name, token }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const { db } = createDb();
  const principal = await resolveSessionUser(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ tokens: await listApiTokens(db, principal.userId) });
}
