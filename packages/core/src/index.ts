export type CaptureMode = "full_dom" | "selection" | "url_fetch" | "upload";
export type DocumentKind = "web" | "pdf" | "document" | "image" | "text";
export type DocumentStatus = "pending" | "processing" | "ready" | "failed";

/** Result of converting any source format to markdown. */
export interface ConvertedContent {
  title: string | null;
  markdown: string;
  wordCount: number;
}

/** Input accepted by the ingest API, normalized for the pipeline. */
export interface IngestInput {
  kbId: string;
  addedBy: string;
  captureMode: CaptureMode;
  kind: DocumentKind;
  /** Detected source MIME (e.g. text/html, text/plain, application/pdf); null when unknown. */
  mimeType: string | null;
  sourceUrl: string | null;
  title: string | null;
  /** Raw HTML (full_dom/url_fetch), plain text (selection/text), or unused (binary upload). */
  rawContent: string;
}

/** A chunk returned by a Retriever, with enough document context to render a citation. */
export interface RankedChunk {
  chunkId: string;
  documentId: string;
  content: string;
  score: number;
  document: {
    title: string | null;
    sourceUrl: string | null;
    addedBy: string;
    capturedAt: Date;
  };
}
