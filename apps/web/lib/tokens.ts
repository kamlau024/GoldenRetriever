import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { schema } from "@gr/db";
import { hashToken } from "./auth.js";

type Db = ReturnType<typeof drizzle>;

export interface TokenSummary {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revoked: boolean;
}

/** Mint a capture token. Returns the raw secret ONCE — only its sha256 hash is stored. */
export async function createApiToken(db: Db, userId: string, name: string): Promise<{ id: string; token: string }> {
  const token = "grt_" + randomBytes(32).toString("base64url");
  const id = `tok_${randomUUID().slice(0, 12)}`;
  await db.insert(schema.apiTokens).values({ id, userId, name, tokenHash: hashToken(token) });
  return { id, token };
}

export async function listApiTokens(db: Db, userId: string): Promise<TokenSummary[]> {
  const rows = await db.select().from(schema.apiTokens)
    .where(eq(schema.apiTokens.userId, userId))
    .orderBy(desc(schema.apiTokens.createdAt));
  return rows.map((r) => ({
    id: r.id, name: r.name, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, revoked: r.revokedAt != null,
  }));
}

/** Revoke one of the caller's tokens. Returns false when it isn't theirs (IDOR-safe). */
export async function revokeApiToken(db: Db, userId: string, id: string): Promise<boolean> {
  const res = await db.update(schema.apiTokens).set({ revokedAt: new Date() })
    .where(and(eq(schema.apiTokens.id, id), eq(schema.apiTokens.userId, userId)))
    .returning({ id: schema.apiTokens.id });
  return res.length > 0;
}
