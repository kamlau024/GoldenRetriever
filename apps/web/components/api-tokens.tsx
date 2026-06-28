"use client";
import { useEffect, useState, type FormEvent } from "react";

interface TokenSummary { id: string; name: string; createdAt: string; lastUsedAt: string | null; revoked: boolean; }

export function ApiTokens({ baseUrl }: { baseUrl: string }) {
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/tokens");
    if (res.ok) setTokens(((await res.json()) as { tokens: TokenSummary[] }).tokens);
  }
  useEffect(() => { void load(); }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: n }),
      });
      if (res.ok) {
        const d = (await res.json()) as { name: string; token: string };
        setCreated({ name: d.name, token: d.token });
        setName("");
        await load();
      }
    } finally { setBusy(false); }
  }

  async function revoke(id: string) {
    setBusy(true);
    try { await fetch(`/api/tokens/${id}`, { method: "DELETE" }); await load(); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={create} className="flex gap-2">
        <input className="flex-1 rounded border p-2" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Token name (e.g. iPhone)" />
        <button disabled={busy} className="rounded bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-50">Create token</button>
      </form>

      {created ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium">Copy your token now — you won&apos;t see it again:</p>
          <code className="mt-1 block break-all rounded bg-white px-2 py-1">{created.token}</code>
        </div>
      ) : null}

      <ul className="divide-y rounded border">
        {tokens.length === 0 ? (
          <li className="p-3 text-sm text-neutral-500">No tokens yet.</li>
        ) : tokens.map((t) => (
          <li key={t.id} className="flex items-center justify-between p-3 text-sm">
            <span>
              {t.name}{t.revoked ? <span className="ml-2 text-neutral-400">(revoked)</span> : null}
              <span className="ml-2 text-neutral-400">last used {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleDateString() : "never"}</span>
            </span>
            {t.revoked ? null : (
              <button onClick={() => revoke(t.id)} disabled={busy} className="rounded border px-2 py-1 text-xs disabled:opacity-50">Revoke</button>
            )}
          </li>
        ))}
      </ul>

      <details className="rounded border p-3 text-sm">
        <summary className="cursor-pointer font-medium">iOS Shortcut setup</summary>
        <p className="mt-2">In the "Save to GoldenRetriever" Shortcut, set:</p>
        <ul className="mt-1 list-disc pl-5">
          <li>Base URL: <code className="break-all">{baseUrl}</code></li>
          <li>Authorization header: <code>Bearer &lt;your token above&gt;</code></li>
        </ul>
        <p className="mt-2 text-neutral-600">Full step-by-step recipe: see <code>docs/ios-shortcut.md</code>.</p>
      </details>
    </div>
  );
}
