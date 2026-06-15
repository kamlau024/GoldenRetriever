import { auth, currentUser } from "@clerk/nextjs/server";
import { createDb } from "@gr/db";
import { upsertUser, getOrCreatePersonalKb, listDocuments } from "@gr/db/queries";
import { LibraryList } from "../../components/library-list.js";
import { AddContent } from "../../components/add-content.js";

export default async function LibraryPage() {
  const { userId } = await auth();
  if (!userId) return null; // middleware protects this route
  const { db } = createDb();
  const u = await currentUser();
  await upsertUser(db, { id: userId, email: u?.primaryEmailAddress?.emailAddress ?? `${userId}@clerk.local`, name: u?.fullName ?? undefined, imageUrl: u?.imageUrl });
  const kbId = await getOrCreatePersonalKb(db, userId);
  const docs = await listDocuments(db, kbId);
  return (
    <div className="space-y-6">
      <AddContent kbId={kbId} />
      <LibraryList docs={docs} />
    </div>
  );
}
