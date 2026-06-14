import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@gr/db";
import { createAiClient } from "@gr/ai";
import { MarkitdownConverter } from "@gr/ingest";
import { processJob } from "../../../lib/ingest-service.js";

export async function POST(req: NextRequest) {
  if (req.headers.get("x-worker-secret") !== (process.env.WORKER_SECRET ?? "dev")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { documentId } = await req.json() as { jobId: string; documentId: string };
  const { db } = createDb();

  const docRows = await db.select().from(schema.documents).where(eq(schema.documents.id, documentId));
  const doc = docRows[0];
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Interim: text payload comes from metadata; Plan 2 reads bytes from Blob for binary kinds.
  const text = (doc.metadata as { rawContent?: string } | null)?.rawContent ?? "";
  await processJob(db, createAiClient(), new MarkitdownConverter(), {
    documentId, kbId: doc.kbId, mimeType: doc.mimeType,
    text, sourceUrl: doc.sourceUrl, filename: doc.title,
  });
  return NextResponse.json({ ok: true });
}
