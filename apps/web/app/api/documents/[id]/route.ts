import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { createDb, schema } from "@gr/db";
import { deleteDocument } from "@gr/db/queries";
import { resolveAuth } from "../../../../lib/clerk-auth.js";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  // Resolve the document's kb and require the caller to be a member of it.
  const docRows = await db.select({ kbId: schema.documents.kbId })
    .from(schema.documents).where(eq(schema.documents.id, id));
  const doc = docRows[0];
  if (doc) {
    const member = await db.select().from(schema.kbMembers)
      .where(and(eq(schema.kbMembers.kbId, doc.kbId), eq(schema.kbMembers.userId, principal.userId)));
    if (member[0]) {
      await deleteDocument(db, id, doc.kbId);
      return NextResponse.json({ ok: true });
    }
  }
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
