import { auth } from "@clerk/nextjs/server";
import { createDb } from "@gr/db";
import { getOrCreatePersonalKb } from "@gr/db/queries";
import { Chat } from "../../../components/chat.js";

export default async function ChatPage() {
  const { userId } = await auth();
  if (!userId) return null;
  const { db } = createDb();
  const kbId = await getOrCreatePersonalKb(db, userId);
  return <Chat kbId={kbId} />;
}
