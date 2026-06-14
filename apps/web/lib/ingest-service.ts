import { randomUUID } from "node:crypto";
import type { drizzle } from "drizzle-orm/postgres-js";
import type { AiClient } from "@gr/ai";
import type { IngestInput } from "@gr/core";
import { schema } from "@gr/db";
import { insertDocument } from "@gr/db/queries";
import { runIngestion, type Converter } from "@gr/ingest";

type Db = ReturnType<typeof drizzle>;

/** Create the document + job row. Returns ids for async processing. */
export async function enqueueIngestion(db: Db, input: IngestInput) {
  const documentId = await insertDocument(db, {
    kbId: input.kbId, addedBy: input.addedBy, kind: input.kind,
    captureMode: input.captureMode, sourceUrl: input.sourceUrl, title: input.title,
    mimeType: input.mimeType,
    // Interim: stash text payload until the Blob round-trip lands in Plan 2.
    metadata: input.rawContent ? { rawContent: input.rawContent } : null,
  });
  const jobId = `job_${randomUUID().slice(0, 12)}`;
  await db.insert(schema.ingestionJobs).values({ id: jobId, documentId, type: "ingest", status: "queued" });
  return { documentId, jobId };
}

/** Run the pipeline for a queued job (called by the worker). */
export async function processJob(db: Db, ai: AiClient, converter: Converter, args: {
  documentId: string; kbId: string; mimeType: string | null;
  text?: string; bytes?: Uint8Array; sourceUrl?: string | null; filename?: string | null;
}) {
  await runIngestion(db, ai, converter, args);
}

/** Convenience for tests / synchronous flows: enqueue + process inline. */
export async function ingestAndProcess(db: Db, ai: AiClient, converter: Converter, input: IngestInput) {
  const { documentId } = await enqueueIngestion(db, input);
  await processJob(db, ai, converter, {
    documentId, kbId: input.kbId, mimeType: input.mimeType,
    text: input.rawContent, sourceUrl: input.sourceUrl, filename: input.title,
  });
  return { documentId };
}
