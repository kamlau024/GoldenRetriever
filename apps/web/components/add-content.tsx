"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { BookmarkImport } from "@/components/bookmark-import";
import { FileDropzone } from "@/components/ui/file-dropzone";

export function AddContent({ kbId }: { kbId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState<Set<string>>(new Set());

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

  async function uploadEach(added: File[]) {
    for (const file of added) {
      setUploading((s) => new Set(s).add(file.name));
      const fd = new FormData(); fd.set("kbId", kbId); fd.set("file", file);
      try {
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        if (!res.ok) throw new Error();
        setFiles((fs) => fs.filter((f) => f !== file));
        toast.success("Saved — processing…");
        router.refresh();
      } catch {
        toast.error("Couldn't upload that file. Please try again.");
      } finally {
        setUploading((s) => { const n = new Set(s); n.delete(file.name); return n; });
      }
    }
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
            <TabsTrigger value="import">Import</TabsTrigger>
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
            <FileDropzone
              value={files} onValueChange={setFiles} onAdd={uploadEach}
              accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg"
              maxSize={25 * 1024 * 1024} maxFileCount={10} uploading={uploading} ariaLabel="Upload files"
            />
          </TabsContent>

          <TabsContent value="import" className="space-y-3">
            <BookmarkImport kbId={kbId} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
