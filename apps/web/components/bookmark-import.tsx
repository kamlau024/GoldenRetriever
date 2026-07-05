"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Check, X, Clock, Loader2, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { cn } from "@/lib/utils";
import { runPool } from "@/lib/pool";
import { parseBookmarksHtml, MAX_BOOKMARK_IMPORT, type BookmarkEntry } from "@/lib/bookmarks";

const IMPORT_CONCURRENCY = 4;
type ItemStatus = "pending" | "importing" | "done" | "failed" | "skipped";
type ImportItem = { url: string; title: string };

/** Read a File as text via FileReader (works across browsers + jsdom, unlike Blob.text()). */
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function StatusIcon({ status }: { status: ItemStatus }) {
  const Icon = status === "done" ? Check : status === "failed" ? X : status === "skipped" ? Minus : status === "importing" ? Loader2 : Clock;
  const color = status === "done" ? "text-green-600" : status === "failed" ? "text-destructive" : status === "importing" ? "text-amber-600" : "text-muted-foreground";
  // role="img" + aria-label gives the icon an accessible name that tests query via getByRole("img", { name }).
  return (
    <span role="img" aria-label={status} className="shrink-0">
      <Icon aria-hidden className={cn("size-4", status === "importing" && "animate-spin", color)} />
    </span>
  );
}

export function BookmarkImport({ kbId }: { kbId: string }) {
  const router = useRouter();
  const [entries, setEntries] = useState<BookmarkEntry[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<"select" | "running" | "finished">("select");
  const [importItems, setImportItems] = useState<ImportItem[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ItemStatus>>({});
  const [completed, setCompleted] = useState(0);

  const folders = useMemo(() => {
    const map = new Map<string, BookmarkEntry[]>();
    for (const e of entries ?? []) (map.get(e.folder) ?? map.set(e.folder, []).get(e.folder)!).push(e);
    return [...map.entries()];
  }, [entries]);

  async function loadFile(f: File) {
    const parsed = parseBookmarksHtml(await readText(f));
    setEntries(parsed);
    setSelected(new Set(parsed.map((p) => p.url)));
    setOpen(new Set());
  }
  function onValueChange(fs: File[]) {
    setFile(fs[0] ?? null);
    if (fs.length === 0) { setEntries(null); setSelected(new Set()); }
  }

  function toggle(url: string) {
    setSelected((s) => { const n = new Set(s); n.has(url) ? n.delete(url) : n.add(url); return n; });
  }
  function toggleFolder(items: BookmarkEntry[]) {
    setSelected((s) => {
      const n = new Set(s);
      const allOn = items.every((i) => n.has(i.url));
      for (const i of items) allOn ? n.delete(i.url) : n.add(i.url);
      return n;
    });
  }
  function toggleAll() {
    setSelected((s) => (s.size === (entries?.length ?? 0) ? new Set() : new Set((entries ?? []).map((e) => e.url))));
  }
  function toggleOpen(folder: string) {
    setOpen((o) => { const n = new Set(o); n.has(folder) ? n.delete(folder) : n.add(folder); return n; });
  }

  const count = selected.size;
  const overCap = count > MAX_BOOKMARK_IMPORT;
  const canImport = count > 0 && !overCap;

  async function doImport() {
    if (!entries) return;
    const items: ImportItem[] = entries.filter((e) => selected.has(e.url)).map((e) => ({ url: e.url, title: e.title }));
    if (items.length === 0) return;
    setImportItems(items);
    setStatuses(Object.fromEntries(items.map((i) => [i.url, "pending" as ItemStatus])));
    setCompleted(0);
    setPhase("running");

    const setStatus = (url: string, s: ItemStatus) => setStatuses((m) => ({ ...m, [url]: s }));
    await runPool(items, IMPORT_CONCURRENCY, async (item) => {
      setStatus(item.url, "importing");
      try {
        const res = await fetch("/api/import/bookmarks", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ kbId, items: [item] }),
        });
        if (!res.ok) throw new Error();
        const { queued, skipped } = await res.json() as { queued: number; skipped: number; failed: number };
        setStatus(item.url, queued > 0 ? "done" : skipped > 0 ? "skipped" : "failed");
      } catch {
        setStatus(item.url, "failed");
      } finally {
        setCompleted((c) => c + 1);
      }
    });

    setPhase("finished");
    router.refresh();
  }

  function reset() {
    setPhase("select"); setEntries(null); setSelected(new Set()); setFile(null);
    setImportItems([]); setStatuses({}); setCompleted(0);
  }

  const total = importItems.length;
  const doneCount = importItems.filter((i) => statuses[i.url] === "done").length;
  const failedCount = importItems.filter((i) => statuses[i.url] === "failed").length;
  const skippedCount = importItems.filter((i) => statuses[i.url] === "skipped").length;

  return (
    <div className="space-y-3">
      <label className="text-sm text-muted-foreground">Upload your browser&apos;s exported bookmarks file (.html)</label>
      <FileDropzone
        value={file ? [file] : []} onValueChange={onValueChange} onAdd={([f]) => { if (f) loadFile(f); }}
        accept=".html,.htm" maxFileCount={1} ariaLabel="Bookmarks file" disabled={phase !== "select"}
      />

      {phase === "select" && entries && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>Found {entries.length} bookmark{entries.length === 1 ? "" : "s"} in {folders.length} folder{folders.length === 1 ? "" : "s"}</span>
            <button type="button" className="underline" onClick={toggleAll}>
              {selected.size === entries.length ? "Deselect all" : "Select all"}
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto rounded-md border">
            <div className="p-1">
              {folders.map(([folder, items]) => {
                const allOn = items.every((i) => selected.has(i.url));
                const isOpen = open.has(folder);
                return (
                  <div key={folder}>
                    <div className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
                      <input type="checkbox" className="size-4 accent-amber-600" checked={allOn} onChange={() => toggleFolder(items)} aria-label={`Select folder ${folder}`} />
                      <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left text-sm font-medium" onClick={() => toggleOpen(folder)}>
                        <ChevronRight className={cn("size-4 shrink-0 transition-transform", isOpen && "rotate-90")} />
                        <span className="truncate">{folder}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">({items.length})</span>
                      </button>
                    </div>
                    {isOpen && items.map((i) => (
                      <label key={i.url} className="flex items-center gap-2 rounded px-2 py-1 pl-8 text-sm hover:bg-muted">
                        <input type="checkbox" className="size-4 accent-amber-600" checked={selected.has(i.url)} onChange={() => toggle(i.url)} />
                        <span className="min-w-0 flex-1 truncate">{i.title}</span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className={cn("text-xs", overCap ? "text-destructive" : "text-muted-foreground")}>
              {count} selected{overCap ? ` — Select up to ${MAX_BOOKMARK_IMPORT} pages per import` : ""}
            </span>
            <Button disabled={!canImport} onClick={doImport}>Import {count} page{count === 1 ? "" : "s"}</Button>
          </div>
        </div>
      )}

      {phase !== "select" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>
              {phase === "running"
                ? `Importing ${completed} / ${total}…`
                : `Imported ${doneCount} page${doneCount === 1 ? "" : "s"}${failedCount ? ` · ${failedCount} failed` : ""}${skippedCount ? ` · ${skippedCount} skipped` : ""}`}
            </span>
            {phase === "finished" && <Button size="sm" variant="outline" onClick={reset}>Done</Button>}
          </div>

          <div className="h-2 w-full overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={total}>
            <div className="h-full rounded bg-amber-600 transition-all" style={{ width: `${total ? Math.round((completed / total) * 100) : 0}%` }} />
          </div>

          <div className="max-h-72 overflow-y-auto rounded-md border">
            <div className="p-1">
              {importItems.map((i) => (
                <div key={i.url} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm">
                  <StatusIcon status={statuses[i.url] ?? "pending"} />
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
