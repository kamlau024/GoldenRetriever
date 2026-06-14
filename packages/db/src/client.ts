import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@gr/config";
import * as schema from "./schema.js";

export function createDb(url: string = env.DATABASE_URL) {
  const sql = postgres(url, { max: 5 });
  return { db: drizzle(sql, { schema }), sql };
}

export * as schema from "./schema.js";
export type { Document, NewDocument, Chunk, NewChunk } from "./schema.js";
