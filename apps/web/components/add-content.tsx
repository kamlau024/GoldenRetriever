"use client";
import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export function AddContent({ kbId }: { kbId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function done(res: Response) {
    setBusy(false);
    if (res.ok) {
      setText(""); setUrl("");
      toast.success("Saved — processing…");
      router.refresh();
    } else {
      toast.error("Couldn't save that. Please try again.");
    }
  }

  async function submitJson(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await done(await fetch("/api/ingest", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kbId, ...body }),
      }));
    } catch { setBusy(false); toast.error("Network error."); }
  }

  async function uploadFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const fd = new FormData(); fd.set("kbId", kbId); fd.set("file", file);
    try { await done(await fetch("/api/upload", { method: "POST", body: fd })); }
    catch { setBusy(false); toast.error("Network error."); }
    e.target.value = "";
  }

  return (
    <Card>
      <CardHeader><CardTitle>Add to your library</CardTitle></CardHeader>
      <CardContent>
        <Tabs defaultValue="text">
          <TabsList>
            <TabsTrigger value="text">Text</TabsTrigger>
            <TabsTrigger value="url">URL</TabsTrigger>
            <TabsTrigger value="file">File</TabsTrigger>
          </TabsList>

          <TabsContent value="text" className="space-y-3">
            <Textarea rows={4} placeholder="Paste text to save…" value={text}
              onChange={(e) => setText(e.target.value)} />
            <Button disabled={busy || !text.trim()} onClick={() => submitJson({ text })}>Save text</Button>
          </TabsContent>

          <TabsContent value="url" className="space-y-3">
            <Input type="url" placeholder="https://… (saves the page)" value={url}
              onChange={(e) => setUrl(e.target.value)} />
            <Button disabled={busy || !url.trim()} onClick={() => submitJson({ url })}>Save page</Button>
          </TabsContent>

          <TabsContent value="file" className="space-y-3">
            <Label className="text-sm text-muted-foreground">PDF, Word, PowerPoint, Excel, or an image</Label>
            <Input type="file" disabled={busy} className="w-full" onChange={uploadFile}
              accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg" />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
