"use client";
import { useState, type FormEvent } from "react";
import { safeHref } from "./chat.js";

export interface SearchResult { chunkId: string; documentId: string; content: string; title: string | null; sourceUrl: string | null; }

export function Results({ results, searched }: { results: SearchResult[]; searched: boolean }) {
  if (!searched) return <p className="text-neutral-500">Search your library.</p>;
  if (results.length === 0) return <p className="text-neutral-500">No matches.</p>;
  return (
    <ul className="space-y-3">
      {results.map((r) => {
        const href = safeHref(r.sourceUrl);
        return (
          <li key={r.chunkId} className="rounded border border-neutral-200 p-3">
            {href === "#" ? (
              <span className="text-sm font-medium">{r.title ?? "Untitled"}</span>
            ) : (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm font-medium underline">{r.title ?? r.sourceUrl}</a>
            )}
            <p className="mt-1 text-sm text-neutral-600">{r.content.slice(0, 240)}</p>
          </li>
        );
      })}
    </ul>
  );
}

export function Search({ kbId }: { kbId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  async function run(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    const res = await fetch("/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kbId, query }) });
    const json = await res.json() as { results: SearchResult[] };
    setResults(json.results ?? []); setSearched(true);
  }
  return (
    <div className="space-y-4">
      <form onSubmit={run} className="flex gap-2">
        <input className="flex-1 rounded border p-2" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" />
        <button className="rounded bg-neutral-900 px-3 py-1.5 text-white">Search</button>
      </form>
      <Results results={results} searched={searched} />
    </div>
  );
}
