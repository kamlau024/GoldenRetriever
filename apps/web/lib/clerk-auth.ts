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

// --- Session-only auth (token management) -------------------------------------
// Token-management endpoints must NOT accept bearer capture tokens — a leaked token
// could otherwise mint or revoke tokens. resolveSessionUser uses the Clerk session
// only and never inspects the Authorization header.
let sessionOverride: string | null | undefined; // undefined = use real Clerk
/** Test seam: force the session user (null = no session). */
export function __setSessionUser(userId: string | null) { sessionOverride = userId; }
/** Test seam: reset to real Clerk resolution. */
export function __clearSessionUser() { sessionOverride = undefined; }

export async function resolveSessionUser(db: Db, _req: Request): Promise<Principal | null> {
  if (sessionOverride !== undefined) return sessionOverride ? { userId: sessionOverride } : null;
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
