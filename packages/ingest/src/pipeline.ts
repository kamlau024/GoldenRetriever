import type { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import type { AiClient } from "@gr/ai";
import { schema, type NewChunk } from "@gr/db";
import { insertChunks, setDocumentReady, setDocumentFailed } from "@gr/db/queries";
import { convertToMarkdown } from "./router.js";
import type { Converter } from "./converter.js";
import { chunkText } from "./chunk.js";
import { fetchUrlContent, type UrlFetcher } from "./fetch-url.js";

type Db = ReturnType<typeof drizzle>;

export interface IngestionWork {
  documentId: string;
  kbId: string;
  mimeType: string | null;
  /** Text-ish sources (HTML / plain text). */
  text?: string;
  /** Binary sources (PDF / Office / images). */
  bytes?: Uint8Array;
  sourceUrl?: string | null;
  filename?: string | null;
}

export async function runIngestion(
  db: Db, ai: AiClient, converter: Converter, work: IngestionWork,
  urlFetcher: UrlFetcher = fetchUrlContent,
): Promise<void> {
  try {
    await db.update(schema.documents).set({ status: "processing" })
      .where(eq(schema.documents.id, work.documentId));

    let { text, bytes, mimeType } = work;
    // A URL ingest arrives with no inline content. The web form/route sends text:"" (an
    // empty string), not undefined — so guard on falsy text, else the URL is never fetched.
    if (!text && bytes === undefined && work.sourceUrl) {
      const fetched = await urlFetcher(work.sourceUrl);
      mimeType = fetched.mimeType;
      if (fetched.kind === "text") text = fetched.text;
      else throw new Error("binary URL content is not supported yet (Plan 2c)");
    }

    // Route by format: HTML → Readability, text → passthrough, binary → markitdown.
    const extracted = await convertToMarkdown({
      mimeType, text, bytes,
      sourceUrl: work.sourceUrl, filename: work.filename,
    }, converter);

    const pieces = chunkText(extracted.markdown, { maxTokens: 800, overlapTokens: 100 });
    if (pieces.length === 0) throw new Error("no content to ingest");

    const embeddings = await ai.embed(pieces.map((p) => p.content));
    const rows: Omit<NewChunk, "id">[] = pieces.map((p, i) => ({
      documentId: work.documentId, kbId: work.kbId, ordinal: p.ordinal,
      content: p.content, tokenCount: p.tokenCount,
      embedding: embeddings[i], embeddingModel: "configured",
    }));
    await insertChunks(db, rows);

    // Best-effort tagging — failure here must not fail ingestion.
    try { await ai.tag(extracted.markdown); } catch { /* ignore in Stage 0 */ }

    // Set title if the document didn't have one.
    if (extracted.title) {
      await db.update(schema.documents).set({ title: extracted.title })
        .where(eq(schema.documents.id, work.documentId));
    }
    await setDocumentReady(db, work.documentId, {
      wordCount: extracted.wordCount, lang: "en",
    });
  } catch (err) {
    await setDocumentFailed(db, work.documentId);
    throw err;
  }
}
