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
import { statusBadgeClass, statusLabel } from "@/lib/status";
import { safeHref } from "@/components/chat";

export interface LibraryDoc {
  id: string; title: string | null; sourceUrl: string | null;
  kind: string; status: string; capturedAt: Date;
}

const fmt = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
});

function KindIcon({ kind }: { kind: string }) {
  const cls = "size-4 text-muted-foreground";
  if (kind === "web") return <Globe className={cls} />;
  if (kind === "image") return <ImageIcon className={cls} />;
  if (kind === "pdf" || kind === "document") return <FileText className={cls} />;
  return <FileIcon className={cls} />;
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
    <Card className="overflow-hidden p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead className="w-32">Status</TableHead>
            <TableHead className="w-48">Added</TableHead>
            <TableHead className="w-16 text-right"><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {docs.map((d) => {
            const href = safeHref(d.sourceUrl);
            const label = d.title ?? "Untitled";
            return (
              <TableRow key={d.id}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    <KindIcon kind={d.kind} />
                    {href === "#" ? <span>{label}</span> : (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">{label}</a>
                    )}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge className={cn("border-transparent", statusBadgeClass(d.status))}>{statusLabel(d.status)}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{fmt.format(d.capturedAt)}</TableCell>
                <TableCell className="text-right">
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button variant="destructive" className="h-7 px-2 text-xs" disabled={busy === d.id}>Delete</Button>
                      }
                    />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this document?</AlertDialogTitle>
                        <AlertDialogDescription>&ldquo;{label}&rdquo; will be removed from your library. This can&apos;t be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(d.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
