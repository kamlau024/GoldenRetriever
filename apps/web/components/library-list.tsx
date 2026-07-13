"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { KindIcon } from "@/components/kind-icon";
import { statusBadgeClass, statusLabel, sourceLabel } from "@/lib/status";
import { relativeTime } from "@/lib/relative-time";
import { safeHref } from "@/components/chat";

export interface LibraryDoc {
  id: string; title: string | null; sourceUrl: string | null;
  kind: string; captureMode: string; status: string; capturedAt: Date; tags: string[];
}

function TitleLink({ doc }: { doc: LibraryDoc }) {
  const href = safeHref(doc.sourceUrl);
  const label = doc.title ?? "Untitled";
  return href === "#"
    ? <span className="truncate">{label}</span>
    : <a href={href} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">{label}</a>;
}

function Tags({ tags, onClick, isSelected }: { tags: string[]; onClick?: (tag: string) => void; isSelected?: (tag: string) => boolean }) {
  if (!tags.length) return null;
  const cls = "rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground";
  return (
    <span className="flex flex-wrap gap-1">
      {tags.slice(0, 6).map((t) => onClick ? (
        <button key={t} type="button" onClick={() => onClick(t)} aria-pressed={isSelected?.(t) ?? false} className={cn(cls, "hover:bg-amber-100 hover:text-amber-900 dark:hover:bg-amber-950/60 dark:hover:text-amber-100", isSelected?.(t) && "bg-amber-100 text-amber-900 ring-1 ring-amber-400 dark:bg-amber-950/60 dark:text-amber-100")}>{t}</button>
      ) : (
        <span key={t} className={cls}>{t}</span>
      ))}
    </span>
  );
}

/** Delete confirmation shared by the cards. */
function DeleteDoc({ label, disabled, onConfirm }: { label: string; disabled: boolean; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="destructive" className="h-7 shrink-0 px-2 text-xs" disabled={disabled}>Delete</Button>} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this document?</AlertDialogTitle>
          <AlertDialogDescription>&ldquo;{label}&rdquo; will be removed from your library. This can&apos;t be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DocCards({ docs, busy, onDelete, onTagClick, isTagSelected }: {
  docs: LibraryDoc[]; busy: string | null; onDelete: (id: string) => void; onTagClick?: (tag: string) => void; isTagSelected?: (tag: string) => boolean;
}) {
  return (
    <div className="space-y-2">
      {docs.map((d) => (
        <Card key={d.id} className="p-3">
          <div className="flex items-start justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2 font-medium"><KindIcon kind={d.kind} /><TitleLink doc={d} /></span>
            <DeleteDoc label={d.title ?? "Untitled"} disabled={busy === d.id} onConfirm={() => onDelete(d.id)} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge className={cn("border-transparent", statusBadgeClass(d.status))}>{statusLabel(d.status)}</Badge>
            <Badge variant="secondary">{sourceLabel(d.captureMode)}</Badge>
            <span>{relativeTime(d.capturedAt)}</span>
          </div>
          {d.tags.length ? <div className="mt-2"><Tags tags={d.tags} onClick={onTagClick} isSelected={isTagSelected} /></div> : null}
        </Card>
      ))}
    </div>
  );
}

export function LibraryList({ docs }: { docs: LibraryDoc[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function remove(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
      if (res.ok) { toast.success("Deleted"); router.refresh(); } else { toast.error("Couldn't delete"); }
    } finally { setBusy(null); }
  }

  const addTag = (t: string) => setSelected((s) => new Set(s).add(t));
  const removeTag = (t: string) => setSelected((s) => { const n = new Set(s); n.delete(t); return n; });
  const clearTags = () => setSelected(new Set());

  if (docs.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 p-10 text-center">
        <FileText className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Nothing saved yet — add a page to get started.</p>
      </Card>
    );
  }

  const selectedArr = [...selected];
  const visible = selectedArr.length === 0 ? docs : docs.filter((d) => selectedArr.every((t) => d.tags.includes(t)));

  return (
    <div className="space-y-3">
      {selectedArr.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={clearTags}>Clear</Button>
          {selectedArr.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
              {t}
              <button type="button" onClick={() => removeTag(t)} aria-label={`Remove ${t}`} className="rounded-full p-0.5 outline-none hover:bg-amber-200/70 focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-amber-900">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">No documents match the selected tags.</Card>
      ) : (
        <DocCards docs={visible} busy={busy} onDelete={remove} onTagClick={addTag} isTagSelected={(t) => selected.has(t)} />
      )}
    </div>
  );
}
