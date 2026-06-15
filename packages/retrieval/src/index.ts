import type { RankedChunk } from "@gr/core";

export { HybridRetriever } from "./hybrid.js";
export { fuseRrf } from "./rrf.js";
export type { RankedChunk };

/** A retrieval strategy. HybridRetriever now; GraphRetriever (LazyGraphRAG) at Stage 2. */
export interface Retriever {
  retrieve(kbId: string, query: string): Promise<RankedChunk[]>;
}
