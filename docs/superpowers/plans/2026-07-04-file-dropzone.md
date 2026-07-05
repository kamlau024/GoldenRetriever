# File Dropzone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare file inputs in the File and Import tabs with a shared drag-and-drop `FileDropzone` (sadmann7 look, native HTML5 drag — no react-dropzone).

**Architecture:** Task 1 builds the shared presentational `FileDropzone` (dropzone + file cards, controlled `value`/`onValueChange`/`onAdd`, accept/size/count validation). Task 2 wires the File tab to multi-file upload (loops `/api/upload`). Task 3 wires the Import tab to single-file local parse.

**Tech Stack:** Next.js 15, React 19, base-ui, Tailwind v4, Vitest (jsdom), lucide-react, sonner.

## Global Constraints

- Native HTML5 drag-and-drop + a hidden `<input type="file">` for click/keyboard access (`role="button"`, `tabIndex=0`, Enter/Space). NO `react-dropzone`.
- The hidden input keeps a caller-provided `ariaLabel` (default `"Upload files"`) so tests can drive it via `getByLabelText`.
- Server stays the security boundary: `/api/upload` already enforces auth + KB membership + 25 MB; client `maxSize`/`accept` are UX only. No endpoint changes.
- base-ui primitives via `render`/props (never `asChild`); reuse `scroll-area.tsx`, `cn`, `sonner`, `lucide-react`. `@/` alias → `apps/web`.
- Component (jsdom) tests: `pnpm --filter @gr/web exec vitest run components/<file>`. Typecheck: `pnpm --filter @gr/web typecheck`.

---

### Task 1: Shared `FileDropzone` component

**Files:**
- Create: `apps/web/components/ui/file-dropzone.tsx`
- Test: `apps/web/components/file-dropzone.test.tsx`

**Interfaces:**
- Produces `FileDropzone(props: FileDropzoneProps)` with the exact `FileDropzoneProps` below (consumed by Tasks 2 & 3).

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/file-dropzone.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
import { FileDropzone, type FileDropzoneProps } from "./ui/file-dropzone.js";

function Harness(props: Partial<FileDropzoneProps>) {
  const [files, setFiles] = useState<File[]>([]);
  return <FileDropzone value={files} onValueChange={setFiles} accept=".pdf" maxFileCount={3} {...props} />;
}
const pdf = (name = "doc.pdf", bytes = "x") => new File([bytes], name, { type: "application/pdf" });

beforeEach(() => { toast.error.mockClear(); });

describe("FileDropzone", () => {
  it("adds a valid file (onAdd fired) and shows a card", () => {
    const onAdd = vi.fn();
    render(<Harness onAdd={onAdd} />);
    fireEvent.change(screen.getByLabelText("Upload files"), { target: { files: [pdf()] } });
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(screen.getByText("doc.pdf")).toBeTruthy();
  });

  it("rejects an oversize file with a toast and no card", () => {
    render(<Harness maxSize={10} />);
    fireEvent.change(screen.getByLabelText("Upload files"), { target: { files: [pdf("big.pdf", "12345678901234567890")] } });
    expect(toast.error).toHaveBeenCalled();
    expect(screen.queryByText("big.pdf")).toBeNull();
  });

  it("rejects a file whose type is not accepted", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Upload files"), { target: { files: [new File(["x"], "note.txt", { type: "text/plain" })] } });
    expect(toast.error).toHaveBeenCalled();
    expect(screen.queryByText("note.txt")).toBeNull();
  });

  it("removes a file via the ✕", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Upload files"), { target: { files: [pdf()] } });
    fireEvent.click(screen.getByLabelText("Remove doc.pdf"));
    expect(screen.queryByText("doc.pdf")).toBeNull();
  });

  it("hides the dropzone once maxFileCount is reached", () => {
    render(<Harness maxFileCount={1} />);
    fireEvent.change(screen.getByLabelText("Upload files"), { target: { files: [pdf("a.pdf")] } });
    expect(screen.getByText("a.pdf")).toBeTruthy();
    expect(screen.queryByLabelText("Upload files")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gr/web exec vitest run components/file-dropzone.test.tsx`
Expected: FAIL — `Cannot find module './ui/file-dropzone.js'`.

- [ ] **Step 3: Implement the component**

Create `apps/web/components/ui/file-dropzone.tsx`:

```tsx
"use client";
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { FileText, Upload, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface FileDropzoneProps {
  value: File[];
  onValueChange: (files: File[]) => void;
  onAdd?: (added: File[]) => void;
  accept?: string;
  maxSize?: number;
  maxFileCount?: number;
  disabled?: boolean;
  uploading?: Set<string>;
  ariaLabel?: string;
  className?: string;
}

const MB = 1024 * 1024;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / MB).toFixed(1)} MB`;
}

/** True if `file` satisfies an <input accept> string (".pdf" extensions and "image/*" / "type/subtype" MIME). */
function matchesAccept(file: File, accept?: string): boolean {
  if (!accept) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).some((token) => {
    if (token.startsWith(".")) return name.endsWith(token);
    if (token.endsWith("/*")) return type.startsWith(token.slice(0, -1));
    return type === token;
  });
}

function FileCard({ file, uploading, onRemove }: { file: File; uploading: boolean; onRemove?: () => void }) {
  const isImage = file.type.startsWith("image/");
  const url = useMemo(() => (isImage ? URL.createObjectURL(file) : null), [file, isImage]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return (
    <div className="flex items-center gap-2 rounded-md border p-2">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={file.name} className="size-9 shrink-0 rounded object-cover" />
      ) : (
        <span className="flex size-9 shrink-0 items-center justify-center rounded bg-muted"><FileText className="size-4 text-muted-foreground" /></span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{file.name}</p>
        <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
        {uploading && (
          <span className="mt-1 block h-1 w-full overflow-hidden rounded bg-muted" aria-label="Uploading">
            <span className="block h-full w-1/2 animate-pulse rounded bg-amber-600" />
          </span>
        )}
      </div>
      {!uploading && onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${file.name}`} className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function FileDropzone({
  value, onValueChange, onAdd, accept, maxSize = 25 * MB, maxFileCount = 1, disabled = false,
  uploading, ariaLabel = "Upload files", className,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  const dragCount = useRef(0);

  function addFiles(incoming: File[]) {
    if (disabled) return;
    const room = maxFileCount - value.length;
    if (room <= 0) return;
    const accepted: File[] = [];
    for (const f of incoming) {
      if (!matchesAccept(f, accept)) { toast.error(`${f.name}: unsupported file type`); continue; }
      if (f.size > maxSize) { toast.error(`${f.name} is too large (max ${Math.round(maxSize / MB)} MB)`); continue; }
      accepted.push(f);
    }
    if (accepted.length === 0) return;
    let take = accepted;
    if (accepted.length > room) { toast.error(`You can add up to ${maxFileCount} file${maxFileCount === 1 ? "" : "s"}`); take = accepted.slice(0, room); }
    onValueChange([...value, ...take]);
    onAdd?.(take);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragCount.current = 0; setActive(false);
    if (disabled) return;
    addFiles(Array.from(e.dataTransfer.files));
  }
  const onDragEnter = (e: DragEvent) => { e.preventDefault(); dragCount.current++; setActive(true); };
  const onDragLeave = (e: DragEvent) => { e.preventDefault(); dragCount.current--; if (dragCount.current <= 0) setActive(false); };
  const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } };

  const full = value.length >= maxFileCount;

  return (
    <div className={cn("space-y-2", className)}>
      {!full && (
        <div
          role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled}
          onClick={() => !disabled && inputRef.current?.click()}
          onKeyDown={onKeyDown}
          onDrop={onDrop} onDragOver={(e) => e.preventDefault()} onDragEnter={onDragEnter} onDragLeave={onDragLeave}
          className={cn(
            "flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-6 text-center outline-none transition-colors",
            active ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30" : "border-input hover:bg-muted/50",
            disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <Upload className="size-6 text-muted-foreground" />
          <span className="text-sm font-medium">Drag &amp; drop, or click to browse</span>
          <input
            ref={inputRef} type="file" className="sr-only" aria-label={ariaLabel}
            accept={accept} multiple={maxFileCount > 1} disabled={disabled}
            onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
          />
        </div>
      )}

      {value.length > 0 && (
        <ScrollArea className="max-h-52">
          <div className="space-y-1.5">
            {value.map((f) => (
              <FileCard
                key={`${f.name}-${f.size}-${f.lastModified}`}
                file={f}
                uploading={!!uploading?.has(f.name)}
                onRemove={disabled ? undefined : () => onValueChange(value.filter((x) => x !== f))}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @gr/web exec vitest run components/file-dropzone.test.tsx`
Expected: PASS (5 tests). If jsdom rejects setting `.files` on the input via `fireEvent.change`, use `Object.defineProperty(input, "files", { value: [file] })` then `fireEvent.change(input)` — but the `target: { files }` form generally works in this project's jsdom.

- [ ] **Step 5: Typecheck & commit**

```bash
pnpm --filter @gr/web typecheck
git add apps/web/components/ui/file-dropzone.tsx apps/web/components/file-dropzone.test.tsx
git commit -m "feat(web): shared drag-and-drop FileDropzone component"
```

---

### Task 2: File tab — multi-file upload via the dropzone

**Files:**
- Modify: `apps/web/components/add-content.tsx`
- Test: `apps/web/components/add-content.test.tsx` (add one test)

**Interfaces:**
- Consumes `FileDropzone` from `@/components/ui/file-dropzone` (Task 1). No change to `/api/upload`.

- [ ] **Step 1: Add the failing test**

In `apps/web/components/add-content.test.tsx`, add inside `describe("AddContent", …)`:

```tsx
it("uploads a dropped file via the File tab", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
  render(<AddContent kbId="kb1" />);
  fireEvent.click(screen.getByRole("tab", { name: /file/i }));
  const file = new File(["x"], "doc.pdf", { type: "application/pdf" });
  fireEvent.change(await screen.findByLabelText("Upload files"), { target: { files: [file] } });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/upload", expect.objectContaining({ method: "POST" })));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gr/web exec vitest run components/add-content.test.tsx`
Expected: FAIL — no element labeled "Upload files" (the File tab still renders the old `<Input type="file">`).

- [ ] **Step 3: Wire the dropzone into the File tab**

In `apps/web/components/add-content.tsx`:

Add the import (after the existing `BookmarkImport` import):
```tsx
import { FileDropzone } from "@/components/ui/file-dropzone";
```

Add state inside `AddContent` (next to the existing `useState`s):
```tsx
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState<Set<string>>(new Set());
```

Replace the `uploadFile` function entirely with:
```tsx
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
```

Replace the File `TabsContent` body (the `<Label>` + `<Input type="file" …>`) with:
```tsx
          <TabsContent value="file" className="space-y-3">
            <Label className="text-sm text-muted-foreground">PDF, Word, PowerPoint, Excel, or an image</Label>
            <FileDropzone
              value={files} onValueChange={setFiles} onAdd={uploadEach}
              accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg"
              maxSize={25 * 1024 * 1024} maxFileCount={10} uploading={uploading} ariaLabel="Upload files"
            />
          </TabsContent>
```

Leave the Text and URL tabs, `done`, and `submitJson` unchanged. If the `ChangeEvent` type import is now unused, remove it; keep `Input` (still used by the URL tab).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @gr/web exec vitest run components/add-content.test.tsx`
Expected: PASS — the three existing assertions plus the new File-tab upload test.

- [ ] **Step 5: Typecheck & commit**

```bash
pnpm --filter @gr/web typecheck
git add apps/web/components/add-content.tsx apps/web/components/add-content.test.tsx
git commit -m "feat(web): File tab uses the dropzone (multi-file upload)"
```

---

### Task 3: Import tab — dropzone for the bookmarks file

**Files:**
- Modify: `apps/web/components/bookmark-import.tsx`
- Test: `apps/web/components/bookmark-import.test.tsx` (verify; adjust only if needed)

**Interfaces:**
- Consumes `FileDropzone` from `@/components/ui/file-dropzone` (Task 1). Keeps the input `ariaLabel="Bookmarks file"` so the existing tests' `getByLabelText("Bookmarks file")` still drives it.

- [ ] **Step 1: Confirm the existing test is the spec**

The existing `bookmark-import.test.tsx` uploads via `screen.getByLabelText("Bookmarks file")`. Because the dropzone keeps that aria-label on its hidden input, these tests should pass unchanged after wiring. Run them first to see them still pass against the OLD input (baseline), then again after Step 2.

Run: `pnpm --filter @gr/web exec vitest run components/bookmark-import.test.tsx`
Expected: PASS (2 tests) — baseline.

- [ ] **Step 2: Wire the dropzone into `bookmark-import.tsx`**

In `apps/web/components/bookmark-import.tsx`:

Replace the `Input` import with the dropzone:
```tsx
import { FileDropzone } from "@/components/ui/file-dropzone";
```
(remove `import { Input } from "@/components/ui/input";` — it is no longer used here.)

Add a `file` state (next to the other `useState`s):
```tsx
  const [file, setFile] = useState<File | null>(null);
```

Replace the `onFile` function with:
```tsx
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
```

Replace the `<label>` + `<Input type="file" … onChange={onFile} />` block with:
```tsx
      <label className="text-sm text-muted-foreground">Upload your browser&apos;s exported bookmarks file (.html)</label>
      <FileDropzone
        value={file ? [file] : []} onValueChange={onValueChange} onAdd={([f]) => { if (f) loadFile(f); }}
        accept=".html,.htm" maxFileCount={1} ariaLabel="Bookmarks file"
      />
```

In `doImport`'s success branch, also clear the file — change `setEntries(null); setSelected(new Set());` to:
```tsx
      setEntries(null); setSelected(new Set()); setFile(null);
```

(`ChangeEvent` import may now be unused — remove it if so. Keep `readText`.)

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm --filter @gr/web exec vitest run components/bookmark-import.test.tsx`
Expected: PASS (2 tests). If a test can no longer find the file input, it is because the dropzone hides once a file is added — the tests only upload once before asserting, so this should not occur; if it does, split the upload/assert so the change fires while the input is present.

- [ ] **Step 4: Typecheck & commit**

```bash
pnpm --filter @gr/web typecheck
git add apps/web/components/bookmark-import.tsx apps/web/components/bookmark-import.test.tsx
git commit -m "feat(web): Import tab uses the dropzone for the bookmarks file"
```

---

## Final verification (before finishing the branch)

- [ ] Full component suite: `pnpm --filter @gr/web exec vitest run` — all green.
- [ ] Full node/DB suite: `bash scripts/test.sh` — all green (no server changes, but confirm nothing broke).
- [ ] Typecheck: `pnpm --filter @gr/web typecheck` — clean.
- [ ] Manual: File tab → drag 2–3 docs → each shows a card with an uploading bar, then appears in the Library; oversize/wrong-type files toast an error. Import tab → drag your bookmarks `.html` → folder preview appears; remove ✕ clears it.
```
