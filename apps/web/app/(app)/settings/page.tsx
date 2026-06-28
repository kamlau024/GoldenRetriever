import { headers } from "next/headers";
import { ApiTokens } from "../../../components/api-tokens.js";

export default async function SettingsPage() {
  // Base URL for the iOS Shortcut: prefer APP_URL, else infer from the request host.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const baseUrl = process.env.APP_URL ?? (host ? `${proto}://${host}` : "");

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Settings</h1>
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
