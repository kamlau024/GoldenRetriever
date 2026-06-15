import { auth, currentUser } from "@clerk/nextjs/server";
import type { drizzle } from "drizzle-orm/postgres-js";
import { upsertUser } from "@gr/db/queries";
import { verifyApiToken } from "./auth.js";

type Db = ReturnType<typeof drizzle>;
export interface Principal { userId: string; }

export async function resolveAuth(db: Db, req: Request): Promise<Principal | null> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (bearer) {
    const tok = await verifyApiToken(db, bearer);
    return tok ? { userId: tok.userId } : null;
  }
  // Clerk session (web UI). Ensure the local user row exists; production uses a Clerk webhook.
  // `auth()` throws outside a clerkMiddleware request context (e.g. unit tests); treat that —
  // and a signed-out session — as unauthenticated.
  let userId: string | null;
  try {
    ({ userId } = await auth());
  } catch {
    return null;
  }
  if (!userId) return null;
  const u = await currentUser();
  await upsertUser(db, {
    id: userId,
    email: u?.primaryEmailAddress?.emailAddress ?? `${userId}@clerk.local`,
    name: u?.fullName ?? undefined,
    imageUrl: u?.imageUrl,
  });
  return { userId };
}
