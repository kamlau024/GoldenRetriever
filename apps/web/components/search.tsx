"use client";
import { useState, type FormEvent } from "react";
import { safeHref } from "./chat.js";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface SearchResult { chunkId: string; documentId: string; content: string; title: string | null; sourceUrl: string | null; }

export function Results({ results, searched }: { results: SearchResult[]; searched: boolean }) {
  if (!searched) return <p className="text-muted-foreground">Search your library.</p>;
  if (results.length === 0) return <p className="text-muted-foreground">No matches.</p>;
  return (
    <ul className="space-y-3">
      {results.map((r) => {
        const href = safeHref(r.sourceUrl);
        return (
          <li key={r.chunkId} className="rounded border border-border p-3">
            {href === "#" ? (
              <span className="text-sm font-medium">{r.title ?? "Untitled"}</span>
            ) : (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm font-medium underline">{r.title ?? r.sourceUrl}</a>
            )}
            <p className="mt-1 text-sm text-muted-foreground">{r.content.slice(0, 240)}</p>
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
    <Card className="p-4">
      <div className="space-y-4">
        <form onSubmit={run} className="flex gap-2">
          <Input className="flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" />
          <Button type="submit">Search</Button>
        </form>
        <Results results={results} searched={searched} />
      </div>
    </Card>
  );
}
