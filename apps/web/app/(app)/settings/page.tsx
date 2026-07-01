import { headers } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { createDb } from "@gr/db";
import { getMemoryState, listMemories } from "@gr/db/queries";
import { ApiTokens } from "../../../components/api-tokens.js";
import { MemorySettings } from "../../../components/memory-settings.js";

export default async function SettingsPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const baseUrl = process.env.APP_URL ?? (host ? `${proto}://${host}` : "");

  const { userId } = await auth();
  const { db } = createDb();
  const enabled = userId ? (await getMemoryState(db, userId)).enabled : true;
  const rows = userId ? await listMemories(db, userId) : [];
  const initialMemories = rows.map((m) => ({ id: m.id, content: m.content, createdAt: m.createdAt.toISOString() }));

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Settings</h1>
      <section className="space-y-2">
        <h2 className="font-medium">Memory</h2>
        <MemorySettings enabled={enabled} initialMemories={initialMemories} />
      </section>
      <section className="space-y-2">
        <h2 className="font-medium">API tokens</h2>
        <p className="text-sm text-neutral-600">
          Create a token for the iOS "Save to GoldenRetriever" Shortcut so you can capture links,
          text, and files from your phone&apos;s Share Sheet.
        </p>
        <ApiTokens baseUrl={baseUrl} />
      </section>
    </div>
  );
}
