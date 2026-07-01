"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { relativeTime } from "@/lib/relative-time";

interface Fact { id: string; content: string; createdAt: string }

export function MemorySettings({ enabled: initialEnabled, initialMemories }: { enabled: boolean; initialMemories: Fact[] }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [items, setItems] = useState<Fact[]>(initialMemories);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    const res = await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ memoryEnabled: next }) });
    if (!res.ok) { setEnabled(!next); toast.error("Couldn't update memory setting"); }
  }

  async function saveEdit(id: string) {
    const content = draft.trim();
    if (!content) return;
    const res = await fetch(`/api/memories/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ content }) });
    if (res.ok) { setItems((xs) => xs.map((x) => (x.id === id ? { ...x, content } : x))); setEditing(null); }
    else toast.error("Couldn't save");
  }

  async function remove(id: string) {
    const res = await fetch(`/api/memories/${id}`, { method: "DELETE" });
    if (res.ok) setItems((xs) => xs.filter((x) => x.id !== id));
    else toast.error("Couldn't delete");
  }

  async function clearAll() {
    const res = await fetch("/api/memories", { method: "DELETE" });
    if (res.ok) { setItems([]); router.refresh(); }
    else toast.error("Couldn't clear memory");
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {enabled ? "GoldenRetriever remembers durable facts about you to personalize answers." : "Memory is off — no facts are used or added."}
        </p>
        <Button variant={enabled ? "outline" : "default"} size="sm" onClick={toggle}>
          {enabled ? "Disable memory" : "Enable memory"}
        </Button>
      </div>

      {items.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">No memories yet.</Card>
      ) : (
        <Card className="divide-y p-0">
          {items.map((m) => (
            <div key={m.id} className="flex items-center gap-2 px-3 py-2">
              {editing === m.id ? (
                <>
                  <Input className="flex-1" value={draft} onChange={(e) => setDraft(e.target.value)} />
                  <Button size="icon" variant="ghost" className="size-7" aria-label="Save memory" onClick={() => saveEdit(m.id)}><Check className="size-4" /></Button>
                  <Button size="icon" variant="ghost" className="size-7" aria-label="Cancel edit" onClick={() => setEditing(null)}><X className="size-4" /></Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm">{m.content}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(new Date(m.createdAt))}</span>
                  <Button size="icon" variant="ghost" className="size-7" aria-label="Edit memory" onClick={() => { setEditing(m.id); setDraft(m.content); }}><Pencil className="size-4" /></Button>
                  <AlertDialog>
                    <AlertDialogTrigger render={<Button size="icon" variant="ghost" className="size-7" aria-label="Delete memory"><Trash2 className="size-4" /></Button>} />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this memory?</AlertDialogTitle>
                        <AlertDialogDescription>&ldquo;{m.content}&rdquo; will be removed.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(m.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </div>
          ))}
        </Card>
      )}

      {items.length > 0 && (
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="destructive" size="sm">Clear all memory</Button>} />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all memory?</AlertDialogTitle>
              <AlertDialogDescription>Every remembered fact will be permanently removed. This can&apos;t be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={clearAll}>Clear all</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
