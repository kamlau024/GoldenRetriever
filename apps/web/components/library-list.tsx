"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Globe, Image as ImageIcon, File as FileIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { statusBadgeClass, statusLabel, sourceLabel } from "@/lib/status";
import { relativeTime } from "@/lib/relative-time";
import { safeHref } from "@/components/chat";

export interface LibraryDoc {
  id: string; title: string | null; sourceUrl: string | null;
  kind: string; captureMode: string; status: string; capturedAt: Date; tags: string[];
}

const fmt = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
});

function KindIcon({ kind }: { kind: string }) {
  const cls = "size-4 shrink-0 text-muted-foreground";
  if (kind === "web") return <Globe className={cls} />;
  if (kind === "image") return <ImageIcon className={cls} />;
  if (kind === "pdf" || kind === "document") return <FileText className={cls} />;
  return <FileIcon className={cls} />;
}

function TitleLink({ doc }: { doc: LibraryDoc }) {
  const href = safeHref(doc.sourceUrl);
  const label = doc.title ?? "Untitled";
  return href === "#"
    ? <span className="truncate">{label}</span>
    : <a href={href} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">{label}</a>;
}

function Tags({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.slice(0, 6).map((t) => (
        <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{t}</span>
      ))}
    </span>
  );
}

/** Delete confirmation shared by the table and the card list. */
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

export function DocTable({ docs, busy, onDelete }: { docs: LibraryDoc[]; busy: string | null; onDelete: (id: string) => void }) {
  return (
    <Card className="hidden overflow-hidden p-0 sm:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead className="w-32">Status</TableHead>
            <TableHead className="w-24">Source</TableHead>
            <TableHead className="w-48">Added</TableHead>
            <TableHead className="w-16 text-right"><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {docs.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="font-medium">
                <span className="flex items-center gap-2"><KindIcon kind={d.kind} /><TitleLink doc={d} /></span>
                {d.tags.length ? <span className="mt-1 block"><Tags tags={d.tags} /></span> : null}
              </TableCell>
              <TableCell><Badge className={cn("border-transparent", statusBadgeClass(d.status))}>{statusLabel(d.status)}</Badge></TableCell>
              <TableCell><Badge variant="secondary">{sourceLabel(d.captureMode)}</Badge></TableCell>
              <TableCell className="text-sm text-muted-foreground">{fmt.format(d.capturedAt)}</TableCell>
              <TableCell className="text-right"><DeleteDoc label={d.title ?? "Untitled"} disabled={busy === d.id} onConfirm={() => onDelete(d.id)} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

export function DocCards({ docs, busy, onDelete }: { docs: LibraryDoc[]; busy: string | null; onDelete: (id: string) => void }) {
  return (
    <div className="space-y-2 sm:hidden">
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
          {d.tags.length ? <div className="mt-2"><Tags tags={d.tags} /></div> : null}
        </Card>
      ))}
    </div>
  );
}

export function LibraryList({ docs }: { docs: LibraryDoc[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function remove(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
      if (res.ok) { toast.success("Deleted"); router.refresh(); } else { toast.error("Couldn't delete"); }
    } finally { setBusy(null); }
  }

  if (docs.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 p-10 text-center">
        <FileText className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Nothing saved yet — add a page to get started.</p>
      </Card>
    );
  }

  return (
    <>
      <DocTable docs={docs} busy={busy} onDelete={remove} />
      <DocCards docs={docs} busy={busy} onDelete={remove} />
    </>
  );
}
