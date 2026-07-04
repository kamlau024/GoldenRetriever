"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { Plus, Trash2, MessageSquare, MoreVertical, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ConversationSummary | null>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);

  // Re-arm the guard whenever a new edit session starts.
  useEffect(() => { if (editingId) savingRef.current = false; }, [editingId]);

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
  useEffect(() => { if (editingId) { const el = editRef.current; el?.focus(); el?.select(); } }, [editingId]);

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

  async function save(id: string, raw: string) {
    if (savingRef.current) return;
    savingRef.current = true;
    const title = raw.trim().slice(0, 200);
    setEditingId(null);
    const current = items?.find((x) => x.id === id);
    if (!title || !current || title === current.title) return;
    try {
      const res = await fetch(`/api/conversations/${id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error();
      setItems((xs) => (xs ?? []).map((x) => (x.id === id ? { ...x, title } : x)));
    } catch {
      toast.error("Couldn't rename");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">History</span>
        <Button size="sm" variant="outline" onClick={onNew}><Plus className="size-4" /> New chat</Button>
      </div>
      <ScrollArea className="-mx-1 min-h-0 flex-1">
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
                {editingId === c.id ? (
                  <input
                    ref={editRef}
                    defaultValue={c.title ?? ""}
                    aria-label="Conversation name"
                    className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); save(c.id, e.currentTarget.value); }
                      else if (e.key === "Escape") { e.preventDefault(); setEditingId(null); }
                    }}
                    onBlur={(e) => save(c.id, e.target.value)}
                  />
                ) : (
                  <>
                    <button type="button" onClick={() => onSelect(c.id)} className="flex min-w-0 flex-1 items-center gap-2">
                      <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{c.title ?? "Untitled chat"}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(new Date(c.lastActivityAt))}</span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground" aria-label="Conversation actions">
                            <MoreVertical className="size-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditingId(c.id)}><Pencil className="size-4" /> Rename</DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => setPendingDelete(c)}><Trash2 className="size-4" /> Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => { if (!o) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>&ldquo;{pendingDelete?.title ?? "Untitled chat"}&rdquo; will be permanently removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const p = pendingDelete; setPendingDelete(null); if (p) remove(p.id); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
