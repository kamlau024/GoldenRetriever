"use client";
import { useState } from "react";

export function AddContent({ kbId }: { kbId: string }) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(body: Record<string, unknown>) {
    setBusy(true);
    await fetch("/api/ingest", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kbId, ...body }),
    });
    setBusy(false);
    setText(""); setUrl("");
    location.reload();
  }

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 p-4">
      <textarea className="w-full rounded border p-2" rows={3} placeholder="Paste text to save…"
        value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex gap-2">
        <button disabled={busy || !text.trim()} onClick={() => submit({ text })}
          className="rounded bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-50">Save text</button>
      </div>
      <div className="flex gap-2">
        <input className="flex-1 rounded border p-2" placeholder="https://… (saves the page)"
          value={url} onChange={(e) => setUrl(e.target.value)} />
        <button disabled={busy || !url.trim()} onClick={() => submit({ url })}
          className="rounded border px-3 py-1.5 disabled:opacity-50">Save URL</button>
      </div>
    </div>
  );
}
