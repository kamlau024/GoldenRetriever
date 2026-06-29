import type { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, isNull } from "drizzle-orm";
import type { AiClient } from "@gr/ai";
import { schema, type NewChunk } from "@gr/db";
import { insertChunks, setDocumentReady, setDocumentFailed } from "@gr/db/queries";
import { convertToMarkdown } from "./router.js";
import type { Converter } from "./converter.js";
import { chunkText } from "./chunk.js";
import { fetchUrlContent, type UrlFetcher } from "./fetch-url.js";

type Db = ReturnType<typeof drizzle>;

/** A short title derived from the body when a document has no real title (e.g. pasted text),
 *  so the library shows a preview instead of "Untitled". */
export function snippetTitle(markdown: string, max = 70): string | null {
  const s = markdown.replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max).trimEnd() + "…" : s;
}

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

    // Fill in a title only when the document doesn't already have one: an extracted title
    // (page <title>, filename) if present, else a snippet of the content (e.g. pasted text).
    const newTitle = extracted.title ?? snippetTitle(extracted.markdown);
    if (newTitle) {
      await db.update(schema.documents).set({ title: newTitle })
        .where(and(eq(schema.documents.id, work.documentId), isNull(schema.documents.title)));
    }
    await setDocumentReady(db, work.documentId, {
      wordCount: extracted.wordCount, lang: "en",
    });
  } catch (err) {
    await setDocumentFailed(db, work.documentId);
    throw err;
  }
}
