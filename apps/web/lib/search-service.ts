import type { drizzle } from "drizzle-orm/postgres-js";
import { HybridRetriever, type Retriever } from "@gr/retrieval";
import { createAiClient } from "@gr/ai";

type Db = ReturnType<typeof drizzle>;
let override: Retriever | null = null;
export function __setSearchRetriever(r: Retriever | null) { override = r; }
export function resolveSearchRetriever(db: Db): Retriever {
  return override ?? new HybridRetriever(db, createAiClient());
}
