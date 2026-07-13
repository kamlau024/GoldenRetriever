# Library Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add-to-library becomes a modal opened by a floating **+** button; the document list uses cards at every size; and tags are clickable to filter the library.

**Architecture:** Task 1 delivers the Add modal + FAB (new `dialog.tsx` primitive, `AddContentModal`, strip `AddContent`'s Card, wire the page). Task 2 makes `library-list.tsx` cards-only + client-side tag filtering. No server/DB changes.

**Tech Stack:** Next.js 15, React 19, base-ui, Tailwind v4, Vitest (jsdom), lucide-react.

## Global Constraints

- base-ui primitives via `render={<X/>}` props (never Radix `asChild`); reuse `Button`, `Card`, `Badge`, lucide, `cn`. The new `dialog.tsx` mirrors `sheet.tsx`'s wrapper style (both wrap `@base-ui/react/dialog`).
- No server/DB/endpoint changes — tag filtering + the modal are purely client-side over already-loaded `docs` (each `LibraryDoc` has `tags: string[]`).
- Component tests: `pnpm --filter @gr/web exec vitest run components/<file>`. Typecheck: `pnpm --filter @gr/web typecheck`. `@/` alias → `apps/web`.

---

### Task 1: Add modal + floating button

**Files:**
- Create: `apps/web/components/ui/dialog.tsx`
- Create: `apps/web/components/add-content-modal.tsx`
- Modify: `apps/web/components/add-content.tsx` (strip the Card wrapper)
- Modify: `apps/web/app/(app)/page.tsx` (render the modal)
- Test: `apps/web/components/add-content-modal.test.tsx`

**Interfaces:**
- Produces `Dialog`, `DialogTrigger`, `DialogClose`, `DialogTitle`, `DialogContent` and `AddContentModal({ kbId }: { kbId: string })`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/add-content-modal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { AddContentModal } from "./add-content-modal.js";

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response)));
afterEach(() => vi.unstubAllGlobals());

describe("AddContentModal", () => {
  it("opens the Add dialog from the floating button and closes via the X", async () => {
    render(<AddContentModal kbId="kb1" />);
    expect(screen.queryByRole("tab", { name: /text/i })).toBeNull(); // closed initially
    fireEvent.click(screen.getByRole("button", { name: "Add to your library" }));
    expect(await screen.findByRole("tab", { name: /text/i })).toBeTruthy(); // opened
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: /text/i })).toBeNull()); // closed
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gr/web exec vitest run components/add-content-modal.test.tsx`
Expected: FAIL — `Cannot find module './add-content-modal.js'`.

- [ ] **Step 3: Create the dialog primitive**

Create `apps/web/components/ui/dialog.tsx`:

```tsx
"use client"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn("text-base font-semibold", className)} {...props} />
}

function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: DialogPrimitive.Popup.Props & { showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="dialog-overlay"
        className="fixed inset-0 z-50 bg-black/40 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg max-h-[90vh] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg bg-popover p-5 text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-150 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            aria-label="Close"
            className="absolute right-3 top-3 rounded p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

export { Dialog, DialogTrigger, DialogClose, DialogTitle, DialogContent }
```

- [ ] **Step 4: Create the modal + FAB**

Create `apps/web/components/add-content-modal.tsx`:

```tsx
"use client";
import { Plus } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AddContent } from "@/components/add-content";

/** Floating "+" button that opens the "Add to your library" flow in a modal. */
export function AddContentModal({ kbId }: { kbId: string }) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            size="icon"
            aria-label="Add to your library"
            className="fixed bottom-6 right-6 z-40 size-14 rounded-full shadow-lg"
          >
            <Plus className="size-6" />
          </Button>
        }
      />
      <DialogContent className="max-w-xl">
        <DialogTitle>Add to your library</DialogTitle>
        <AddContent kbId={kbId} />
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Strip the Card wrapper from `add-content.tsx`**

In `apps/web/components/add-content.tsx`, remove the Card import line:
```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
```
and replace the outer wrapper — change:
```tsx
  return (
    <Card>
      <CardHeader><CardTitle>Add to your library</CardTitle></CardHeader>
      <CardContent>
        <Tabs defaultValue="text">
```
…keeping the whole `<Tabs>…</Tabs>` body unchanged… and the closing:
```tsx
        </Tabs>
      </CardContent>
    </Card>
  );
```
to:
```tsx
  return (
    <div>
      <Tabs defaultValue="text">
        …unchanged…
      </Tabs>
    </div>
  );
```
(Only the outer `<Card>/<CardHeader>/<CardContent>` become a single `<div>`; the `<Tabs>` and all `<TabsContent>` stay exactly as they are.)

- [ ] **Step 6: Wire the modal into the page**

In `apps/web/app/(app)/page.tsx`, replace the `AddContent` import + usage with the modal:
```tsx
import { AddContentModal } from "../../components/add-content-modal.js";
```
and in the JSX:
```tsx
    <div className="space-y-6">
      <AddContentModal kbId={kbId} />
      <LibraryList docs={docs} />
    </div>
```
(Remove the `import { AddContent } … ` line — it's now used only by the modal.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @gr/web exec vitest run components/add-content-modal.test.tsx components/add-content.test.tsx`
Expected: PASS — the modal test, and the existing `add-content.test.tsx` (its assertions target the tabs, which are unchanged by the Card strip).

- [ ] **Step 8: Typecheck & commit**

```bash
pnpm --filter @gr/web typecheck
git add apps/web/components/ui/dialog.tsx apps/web/components/add-content-modal.tsx apps/web/components/add-content.tsx "apps/web/app/(app)/page.tsx" apps/web/components/add-content-modal.test.tsx
git commit -m "feat(web): Add-to-library modal opened by a floating + button"
```

---

### Task 2: Cards everywhere + tag filtering

**Files:**
- Modify: `apps/web/components/library-list.tsx` (full replacement below)
- Test: `apps/web/components/library-list.test.tsx`

**Interfaces:**
- `DocCards` gains an optional `onTagClick?: (tag: string) => void`; `DocTable` is removed.

- [ ] **Step 1: Update the tests**

Replace `apps/web/components/library-list.test.tsx` with (drops the `DocTable` describe + import; keeps `DocCards`; adds tag-filter tests):

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { LibraryList, DocCards } from "./library-list.js";

const docs = [
  { id: "d1", title: "Kyoto guide", sourceUrl: "https://x.dev", kind: "web", captureMode: "url_fetch", status: "ready", capturedAt: new Date("2026-06-28T13:42:00Z"), tags: ["travel", "kyoto"] },
  { id: "d2", title: null, sourceUrl: null, kind: "text", captureMode: "selection", status: "failed", capturedAt: new Date("2026-06-27T09:00:00Z"), tags: [] },
  { id: "d3", title: "report.pdf", sourceUrl: null, kind: "pdf", captureMode: "upload", status: "ready", capturedAt: new Date("2026-06-26T09:00:00Z"), tags: [] },
];

describe("DocCards", () => {
  it("renders a card per doc and confirms delete via onDelete", async () => {
    const onDelete = vi.fn();
    render(<DocCards docs={docs} busy={null} onDelete={onDelete} />);
    expect(screen.getByText("Kyoto guide")).toBeTruthy();
    expect(screen.getAllByText("READY").length).toBe(2);
    expect(screen.getByText("URL")).toBeTruthy();
    expect(screen.getByText("travel")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("d1");
  });
});

describe("LibraryList", () => {
  it("shows an empty state when there are no docs", () => {
    render(<LibraryList docs={[]} />);
    expect(screen.getByText(/nothing saved yet/i)).toBeTruthy();
  });

  it("renders cards (no desktop table)", () => {
    render(<LibraryList docs={docs} />);
    expect(screen.getByText("Kyoto guide")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("LibraryList tag filtering", () => {
  const tagged = [
    { id: "d1", title: "Kyoto guide", sourceUrl: null, kind: "web", captureMode: "url_fetch", status: "ready", capturedAt: new Date(), tags: ["travel", "kyoto"] },
    { id: "d4", title: "Osaka food", sourceUrl: null, kind: "web", captureMode: "url_fetch", status: "ready", capturedAt: new Date(), tags: ["travel"] },
    { id: "d2", title: "Untagged note", sourceUrl: null, kind: "text", captureMode: "selection", status: "ready", capturedAt: new Date(), tags: [] },
  ];

  it("filters by a clicked tag, hides untagged docs, and shows Clear + a pill", () => {
    render(<LibraryList docs={tagged} />);
    expect(screen.getByText("Untagged note")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "kyoto" }));
    expect(screen.getByText("Kyoto guide")).toBeTruthy();
    expect(screen.queryByText("Osaka food")).toBeNull();     // lacks 'kyoto'
    expect(screen.queryByText("Untagged note")).toBeNull();  // untagged hidden
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove kyoto" })).toBeTruthy();
  });

  it("ANDs multiple selected tags", () => {
    render(<LibraryList docs={tagged} />);
    fireEvent.click(screen.getAllByRole("button", { name: "travel" })[0]);
    expect(screen.getByText("Kyoto guide")).toBeTruthy();
    expect(screen.getByText("Osaka food")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "kyoto" }));
    expect(screen.getByText("Kyoto guide")).toBeTruthy();
    expect(screen.queryByText("Osaka food")).toBeNull();     // lacks 'kyoto'
  });

  it("removes a tag via its × and Clear resets the filter", () => {
    render(<LibraryList docs={tagged} />);
    fireEvent.click(screen.getByRole("button", { name: "kyoto" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove kyoto" }));
    expect(screen.getByText("Untagged note")).toBeTruthy(); // filter cleared
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @gr/web exec vitest run components/library-list.test.tsx`
Expected: FAIL — the current `LibraryList` renders a `DocTable` (so `queryByRole("table")` is non-null) and tags aren't clickable buttons (no tag-button / Clear / Remove roles).

- [ ] **Step 3: Replace `library-list.tsx`**

Replace the entire file `apps/web/components/library-list.tsx` with:

```tsx
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

function Tags({ tags, onClick }: { tags: string[]; onClick?: (tag: string) => void }) {
  if (!tags.length) return null;
  const cls = "rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground";
  return (
    <span className="flex flex-wrap gap-1">
      {tags.slice(0, 6).map((t) => onClick ? (
        <button key={t} type="button" onClick={() => onClick(t)} className={cn(cls, "hover:bg-amber-100 hover:text-amber-900 dark:hover:bg-amber-950/60 dark:hover:text-amber-100")}>{t}</button>
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

export function DocCards({ docs, busy, onDelete, onTagClick }: {
  docs: LibraryDoc[]; busy: string | null; onDelete: (id: string) => void; onTagClick?: (tag: string) => void;
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
          {d.tags.length ? <div className="mt-2"><Tags tags={d.tags} onClick={onTagClick} /></div> : null}
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
        <DocCards docs={visible} busy={busy} onDelete={remove} onTagClick={addTag} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @gr/web exec vitest run components/library-list.test.tsx`
Expected: PASS (all describes).

- [ ] **Step 5: Typecheck & commit**

```bash
pnpm --filter @gr/web typecheck
git add apps/web/components/library-list.tsx apps/web/components/library-list.test.tsx
git commit -m "feat(web): cards at all sizes + click-to-filter by tags"
```

---

## Final verification (before finishing the branch)

- [ ] Full component suite: `pnpm --filter @gr/web exec vitest run` — all green.
- [ ] Full node/DB suite: `bash scripts/test.sh` — all green (no server change; confirm nothing broke).
- [ ] Typecheck: `pnpm --filter @gr/web typecheck` — clean.
- [ ] Manual: the Library page shows only cards; a floating **+** (bottom-right) opens the Add modal; clicking outside or the × closes it; clicking a tag filters to matching docs (untagged hidden), a second tag narrows further, the pill × removes one tag, and **Clear** resets.
```
