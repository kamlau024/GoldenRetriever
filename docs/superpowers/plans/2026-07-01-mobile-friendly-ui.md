# Mobile-Friendly UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web UI render correctly on a phone by removing the two horizontal-overflow sources (the header row and the 5-column Library table) and tidying the remaining surfaces.

**Architecture:** Mobile-first Tailwind at the `sm` (640px) breakpoint. The header gains a hamburger `Sheet` menu below `sm` (inline nav at `sm+`); the Library splits into a desktop `DocTable` (`hidden sm:block`) and a mobile `DocCards` list (`sm:hidden`) sharing one delete control; chat/settings/add-content get small responsive tweaks.

**Tech Stack:** Next.js 15 App Router, base-ui (`@base-ui/react`), Tailwind v4, Vitest (jsdom).

## Global Constraints

- Mobile-first Tailwind; `sm` (640px) is the phone/desktop divide (`sm:` = tablet/desktop). Desktop (`sm+`) rendering must not change.
- No new dependencies. Reuse `Sheet`, `Card`, `Badge`, `Button`, `AlertDialog*`, `relativeTime`, `NavLink`, `ThemeToggle`.
- base-ui uses `render={<X/>}` props (NOT Radix `asChild`); `cn` from `@/lib/utils`; `@/` alias → `apps/web` root.
- Component tests (jsdom) via `pnpm --filter @gr/web exec vitest run components/<file>`; full suite via `bash scripts/test.sh`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- jsdom does not apply CSS media queries — a component that renders both a mobile and desktop tree duplicates every text node. Keep the two Library presentations in separate components so tests query one at a time.

---

### Task 1: Viewport + header hamburger menu

**Files:**
- Modify: `apps/web/app/layout.tsx` (add `viewport` export)
- Modify: `apps/web/components/logo.tsx` (wordmark `hidden sm:inline`)
- Create: `apps/web/components/mobile-nav.tsx`
- Test: `apps/web/components/mobile-nav.test.tsx` (create)
- Modify: `apps/web/app/(app)/layout.tsx` (inline nav `hidden sm:flex`; render `MobileNav`)

**Interfaces:**
- Produces: `MobileNav()` — a mobile-only (`sm:hidden` trigger) hamburger button opening a `Sheet` with the four destination links.

- [ ] **Step 1: Add the viewport export**

In `apps/web/app/layout.tsx`, add below the `metadata` line:

```ts
export const metadata = { title: "GoldenRetriever" };
export const viewport = { width: "device-width", initialScale: 1 };
```

- [ ] **Step 2: Hide the wordmark on mobile**

In `apps/web/components/logo.tsx`, change the wordmark span inside `Logo` so it only shows at `sm+`:

```tsx
      <span className="hidden text-foreground sm:inline">GoldenRetriever</span>
```

(Leave `LogoMark` and everything else unchanged — on mobile the header shows the dog mark only.)

- [ ] **Step 3: Write the failing MobileNav test**

Create `apps/web/components/mobile-nav.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
import { MobileNav } from "./mobile-nav.js";

describe("MobileNav", () => {
  it("opens a menu listing the four destinations", async () => {
    render(<MobileNav />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(await screen.findByText("Library")).toBeTruthy();
    expect(screen.getByText("Chat")).toBeTruthy();
    expect(screen.getByText("Search")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @gr/web exec vitest run components/mobile-nav.test.tsx`
Expected: FAIL — `./mobile-nav.js` does not exist.

- [ ] **Step 5: Implement MobileNav**

Create `apps/web/components/mobile-nav.tsx`:

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Library" },
  { href: "/chat", label: "Chat" },
  { href: "/search", label: "Search" },
  { href: "/settings", label: "Settings" },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon" className="sm:hidden" aria-label="Open menu"><Menu className="size-5" /></Button>} />
      <SheetContent side="right">
        <SheetTitle>Menu</SheetTitle>
        <nav className="mt-2 flex flex-col gap-1">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "rounded-md px-3 py-2 text-base font-medium hover:bg-muted",
                  active ? "bg-muted text-foreground" : "text-muted-foreground",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `pnpm --filter @gr/web exec vitest run components/mobile-nav.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 7: Wire the header**

In `apps/web/app/(app)/layout.tsx`: add the import, make the inline nav desktop-only, tighten the gap, and add `MobileNav` to the right cluster. Replace the import block and the header `<div>`:

Add to imports:

```tsx
import { MobileNav } from "@/components/mobile-nav";
```

Change the inner header container + nav + controls to:

```tsx
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3">
          <Link href="/" aria-label="GoldenRetriever home"><Logo /></Link>
          <nav className="hidden items-center gap-5 sm:flex">
            <NavLink href="/" label="Library" />
            <NavLink href="/chat" label="Chat" />
            <NavLink href="/search" label="Search" />
            <NavLink href="/settings" label="Settings" />
          </nav>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <UserButton />
            <MobileNav />
          </div>
        </div>
```

- [ ] **Step 8: Typecheck + commit**

Run: `pnpm --filter @gr/web typecheck`
Expected: clean.

```bash
git add apps/web/app/layout.tsx apps/web/components/logo.tsx apps/web/components/mobile-nav.tsx apps/web/components/mobile-nav.test.tsx "apps/web/app/(app)/layout.tsx"
git commit -m "feat(web): responsive header — hamburger nav on mobile

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Library — desktop table + mobile card list

**Files:**
- Modify: `apps/web/components/library-list.tsx` (split into `DocTable` + `DocCards` + shared `DeleteDoc`)
- Modify: `apps/web/components/library-list.test.tsx` (retarget to `DocTable`; add `DocCards` test)

**Interfaces:**
- Consumes: `relativeTime` (`@/lib/relative-time`); existing `statusBadgeClass`/`statusLabel`/`sourceLabel`, `safeHref`, `KindIcon`.
- Produces: `LibraryList({ docs })` (unchanged public shape); plus exported `DocTable({ docs, busy, onDelete })` and `DocCards({ docs, busy, onDelete })` where `onDelete: (id: string) => void` and `busy: string | null`.

- [ ] **Step 1: Write the failing/retargeted test**

Replace `apps/web/components/library-list.test.tsx` with:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { LibraryList, DocTable, DocCards } from "./library-list.js";

const docs = [
  { id: "d1", title: "Kyoto guide", sourceUrl: "https://x.dev", kind: "web", captureMode: "url_fetch", status: "ready", capturedAt: new Date("2026-06-28T13:42:00Z"), tags: ["travel", "kyoto"] },
  { id: "d2", title: null, sourceUrl: null, kind: "text", captureMode: "selection", status: "failed", capturedAt: new Date("2026-06-27T09:00:00Z"), tags: [] },
  { id: "d3", title: "report.pdf", sourceUrl: null, kind: "pdf", captureMode: "upload", status: "ready", capturedAt: new Date("2026-06-26T09:00:00Z"), tags: [] },
];

describe("DocTable (desktop)", () => {
  it("renders rows with status pills, source labels, timestamps, and tags", () => {
    render(<DocTable docs={docs} busy={null} onDelete={vi.fn()} />);
    expect(screen.getByText("Kyoto guide")).toBeTruthy();
    expect(screen.getAllByText("READY").length).toBe(2);
    expect(screen.getByText("FAILED")).toBeTruthy();
    expect(screen.getByText("Untitled")).toBeTruthy();
    expect(screen.getByText("URL")).toBeTruthy();
    expect(screen.getByText("Text")).toBeTruthy();
    expect(screen.getByText("File")).toBeTruthy();
    expect(screen.getByText("travel")).toBeTruthy();
    expect(screen.getByText("kyoto")).toBeTruthy();
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
  });
});

describe("DocCards (mobile)", () => {
  it("renders a card per doc and confirms delete via onDelete", async () => {
    const onDelete = vi.fn();
    render(<DocCards docs={docs} busy={null} onDelete={onDelete} />);
    expect(screen.getByText("Kyoto guide")).toBeTruthy();
    expect(screen.getAllByText("READY").length).toBe(2);
    expect(screen.getByText("URL")).toBeTruthy();
    expect(screen.getByText("travel")).toBeTruthy();
    // open the first card's delete dialog, then confirm inside it
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
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gr/web exec vitest run components/library-list.test.tsx`
Expected: FAIL — `DocTable`/`DocCards` are not exported.

- [ ] **Step 3: Rewrite the component with the split**

Replace `apps/web/components/library-list.tsx` with:

```tsx
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
                <span className="mt-1 block"><Tags tags={d.tags} /></span>
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @gr/web exec vitest run components/library-list.test.tsx`
Expected: PASS (3 tests). If `findByRole("alertdialog")` fails because base-ui names the popup differently, scope the confirm instead with `within(screen.getByText("Delete this document?").closest("[role]")!)` — but base-ui `AlertDialog.Popup` sets `role="alertdialog"`, so the query above should work.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/library-list.tsx apps/web/components/library-list.test.tsx
git commit -m "feat(web): Library card list on mobile (table on desktop)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Minor responsive polish (chat, settings, add-content)

**Files:**
- Modify: `apps/web/components/chat.tsx`
- Modify: `apps/web/components/memory-settings.tsx`
- Modify: `apps/web/components/add-content.tsx`

**Interfaces:** none new — class-only changes.

- [ ] **Step 1: Tighten the chat bubble gutters + card padding on mobile**

In `apps/web/components/chat.tsx`:

Change the message content wrapper className from:

```tsx
            <div className={cn("min-w-0 flex-1", isUser ? "ml-9 text-right" : "mr-9 text-left")}>
```

to:

```tsx
            <div className={cn("min-w-0 flex-1", isUser ? "ml-6 text-right sm:ml-9" : "mr-6 text-left sm:mr-9")}>
```

And change the Chat `Card` from `<Card className="p-4">` to:

```tsx
    <Card className="p-3 sm:p-4">
```

- [ ] **Step 2: Stack the Memory toggle header on mobile**

In `apps/web/components/memory-settings.tsx`, change the toggle-header div from:

```tsx
      <div className="flex items-center justify-between">
```

to:

```tsx
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
```

- [ ] **Step 3: Make the file input full width**

In `apps/web/components/add-content.tsx`, change the file input to add `w-full`:

```tsx
            <Input type="file" disabled={busy} className="w-full" onChange={uploadFile}
              accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg" />
```

- [ ] **Step 4: Typecheck + full suite (nothing should regress)**

Run: `pnpm --filter @gr/web typecheck && bash scripts/test.sh`
Expected: typecheck clean; entire node + component suite green (these are class-only changes; existing `chat.test.tsx` / `memory-settings.test.tsx` assert behavior/text, not layout classes, so they still pass).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/chat.tsx apps/web/components/memory-settings.tsx apps/web/components/add-content.tsx
git commit -m "feat(web): mobile polish for chat, memory settings, and add-content

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Plan Self-Review

**Spec coverage:**
- Viewport export → Task 1 Step 1. ✓
- Header hamburger (MobileNav + Sheet, logo-mark-only, inline nav `hidden sm:flex`) → Task 1. ✓
- Library split `DocTable` (`hidden sm:block`) + `DocCards` (`sm:hidden`) sharing `DeleteDoc` → Task 2. ✓
- Chat gutters + padding; memory toggle stack; add-content file `w-full` → Task 3. ✓
- Component tests for `DocTable`/`DocCards`/`MobileNav` + retargeted library test → Tasks 1–2. ✓
- Desktop unchanged; no new deps → all tasks use `sm:` variants + existing primitives. ✓

**Placeholder scan:** No TBD/TODO/"handle errors"/"similar to" — every step has complete code. ✓

**Type consistency:** `DocTable`/`DocCards` share the `{ docs, busy, onDelete }` signature between definition (Task 2) and the test (Task 2); `MobileNav()` takes no props (Task 1). `relativeTime(date: Date)` is called with `d.capturedAt` (a `Date`) — matches its signature. `safeHref`, `statusBadgeClass`/`statusLabel`/`sourceLabel` reused with their existing signatures. ✓
