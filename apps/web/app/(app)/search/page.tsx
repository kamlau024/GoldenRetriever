import { auth } from "@clerk/nextjs/server";
import { createDb } from "@gr/db";
import { getOrCreatePersonalKb } from "@gr/db/queries";
import { Search } from "../../../components/search.js";

export default async function SearchPage() {
  const { userId } = await auth();
  if (!userId) return null;
  const { db } = createDb();
  const kbId = await getOrCreatePersonalKb(db, userId);
  return <Search kbId={kbId} />;
}
