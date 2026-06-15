"use client";
import { useState, type FormEvent } from "react";

export interface Citation { title: string | null; sourceUrl: string | null; }
export interface Turn { id: string; role: string; content: string; citations?: Citation[]; }

export function Transcript({ messages }: { messages: Turn[] }) {
  return (
    <div className="space-y-4">
      {messages.map((m) => (
        <div key={m.id} className={m.role === "user" ? "text-right" : "text-left"}>
          <p className="inline-block rounded-lg bg-neutral-100 px-3 py-2">{m.content}</p>
          {m.citations?.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {m.citations.map((c, i) => (
                <a key={i} href={c.sourceUrl ?? "#"} className="rounded bg-amber-100 px-2 py-0.5 text-xs">{c.title ?? "source"}</a>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function Chat({ kbId }: { kbId: string }) {
  const [messages, setMessages] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e: FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    const userTurn: Turn = { id: crypto.randomUUID(), role: "user", content: message };
    const assistantId = crypto.randomUUID();
    setMessages((m) => [...m, userTurn, { id: assistantId, role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kbId, message }),
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => m.map((t) => (t.id === assistantId ? { ...t, content: acc } : t)));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Transcript messages={messages} />
      <form onSubmit={send} className="flex gap-2">
        <input className="flex-1 rounded border p-2" value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="Ask your library…" />
        <button disabled={busy} className="rounded bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-50">Ask</button>
      </form>
    </div>
  );
}
