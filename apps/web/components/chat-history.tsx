"use client";
import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { relativeTime } from "@/lib/relative-time";

export interface ConversationSummary {
  id: string;
  title: string | null;
  lastActivityAt: string;
  messageCount: number;
}

export function ChatHistory({ open, activeId, onSelect, onNew, onDeletedActive }: {
  open: boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDeletedActive: () => void;
}) {
  const [items, setItems] = useState<ConversationSummary[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) throw new Error();
      setItems((await res.json()).conversations);
    } catch {
      setItems([]);
      toast.error("Couldn't load history");
    }
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setItems((xs) => (xs ?? []).filter((x) => x.id !== id));
      if (id === activeId) onDeletedActive();
    } catch {
      toast.error("Couldn't delete");
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">History</span>
        <Button size="sm" variant="outline" onClick={onNew}><Plus className="size-4" /> New chat</Button>
      </div>
      <ScrollArea className="-mx-1 flex-1">
        <div className="flex flex-col gap-1 px-1">
          {items === null ? (
            <>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </>
          ) : items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">No conversations yet.</p>
          ) : (
            items.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "group flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted",
                  c.id === activeId && "bg-muted",
                )}
              >
                <button type="button" onClick={() => onSelect(c.id)} className="flex min-w-0 flex-1 items-center gap-2">
                  <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{c.title ?? "Untitled chat"}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(new Date(c.lastActivityAt))}</span>
                </button>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button variant="ghost" size="icon" className="size-7 shrink-0 opacity-0 group-hover:opacity-100" aria-label="Delete conversation">
                        <Trash2 className="size-4" />
                      </Button>
                    }
                  />
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
                      <AlertDialogDescription>&ldquo;{c.title ?? "Untitled chat"}&rdquo; will be permanently removed.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => remove(c.id)}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
