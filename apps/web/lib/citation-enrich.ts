import type { drizzle } from "drizzle-orm/postgres-js";
import { getDocumentKinds, getChunkContents } from "@gr/db/queries";
import { snippet } from "./citations.js";

type Db = ReturnType<typeof drizzle>;

interface StoredCitation {
  chunkId?: string; documentId?: string;
  title: string | null; sourceUrl: string | null;
  kind?: string; content?: string;
}

const needsKind = (c: StoredCitation) => c.kind == null && c.documentId != null;
const needsContent = (c: StoredCitation) => (c.content == null || c.content === "") && c.chunkId != null;

/**
 * Backfill `kind` + `content` on stored citations that predate those fields. Messages saved before the
 * citation-popover feature stored only `{ chunkId, documentId, title, sourceUrl }`; on resume that left
 * the popover with the generic file icon (kind → "text") and no snippet (content → ""). Here we
 * reconstruct the missing fields from the authoritative sources — `documents.kind` (by documentId) and
 * `chunks.content` (by chunkId) — so old conversations render identically to fresh ones. Citations that
 * already carry both fields are returned untouched (their stored snapshot is preserved). Best-effort: if
 * the source document/chunk was since deleted, the field falls back to "text" / "".
 */
export async function enrichStoredCitations<M extends { citations: unknown }>(
  db: Db, messages: M[],
): Promise<M[]> {
  const docIds = new Set<string>();
  const chunkIds = new Set<string>();
  for (const m of messages) {
    if (!Array.isArray(m.citations)) continue;
    for (const c of m.citations as StoredCitation[]) {
      if (needsKind(c)) docIds.add(c.documentId!);
      if (needsContent(c)) chunkIds.add(c.chunkId!);
    }
  }
  if (docIds.size === 0 && chunkIds.size === 0) return messages;

  const [kinds, contents] = await Promise.all([
    getDocumentKinds(db, [...docIds]),
    getChunkContents(db, [...chunkIds]),
  ]);

  return messages.map((m) => {
    if (!Array.isArray(m.citations)) return m;
    const citations = (m.citations as StoredCitation[]).map((c) => ({
      ...c,
      kind: needsKind(c) ? (kinds.get(c.documentId!) ?? "text") : c.kind,
      content: needsContent(c) ? snippet(contents.get(c.chunkId!) ?? "") : c.content,
    }));
    return { ...m, citations };
  });
}
