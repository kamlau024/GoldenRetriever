import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { schema } from "@gr/db";

type Db = ReturnType<typeof drizzle>;

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface AuthedUser { userId: string; tokenId: string; }

export async function verifyApiToken(db: Db, raw: string | null | undefined): Promise<AuthedUser | null> {
  if (!raw) return null;
  const rows = await db.select().from(schema.apiTokens)
    .where(and(eq(schema.apiTokens.tokenHash, hashToken(raw)), isNull(schema.apiTokens.revokedAt)));
  const tok = rows[0];
  if (!tok) return null;
  await db.update(schema.apiTokens).set({ lastUsedAt: new Date() })
    .where(eq(schema.apiTokens.id, tok.id));
  return { userId: tok.userId, tokenId: tok.id };
}
