# Chat Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render citation popups as markdown, let users rename conversations from the slideout via a kebab menu, and make the slideout list scroll when it overflows.

**Architecture:** Four independent tasks. Task 1 is a self-contained component change (citation popover). Tasks 2–3 add conversation rename (ownership-scoped query + PATCH route, then the slideout UI). Task 4 is a CSS-only flexbox fix in the same slideout component. Tasks 3 and 4 both edit `chat-history.tsx` and run sequentially.

**Tech Stack:** Next.js 15 App Router, React, base-ui primitives, Drizzle ORM + Postgres, Vitest (node + jsdom), react-markdown + remark-gfm.

## Global Constraints

- base-ui primitives are driven with `render={<X/>}` props — never Radix `asChild`. Reuse existing wrappers: `dropdown-menu.tsx`, `alert-dialog.tsx`, `button.tsx`.
- Ownership checks live in the query layer (`WHERE … user_id = …`), consistent with `deleteConversation` / `getConversationForUser`.
- Tailwind v4 utility classes; `cn` from `@/lib/utils`; `@/` alias → `apps/web`.
- Citation payload stays capped at 500 chars (`snippet()` in `lib/citations.ts`) — do not change the header size.
- Component (jsdom) tests: `pnpm --filter @gr/web exec vitest run components/<file>`. Node/DB tests: `bash scripts/test.sh <path>` (Docker pgvector on :5433).

---

### Task 1: Markdown in the citation popup

**Files:**
- Modify: `apps/web/components/citation.tsx`
- Test: `apps/web/components/citation.test.tsx`

**Interfaces:**
- Consumes: `makeCitation(citations: CitationData[])` (existing export), `CitationData.content: string`.
- Produces: nothing new exported; internal `CitationMarkdown` helper.

- [ ] **Step 1: Add the failing test**

Append to `apps/web/components/citation.test.tsx` (inside the existing `describe("Citation", …)`):

```tsx
it("renders the chunk snippet as markdown", async () => {
  const Md = makeCitation([{ title: "Doc", sourceUrl: null, kind: "text", content: "**bold** then\n\n- item one\n- item two" }]);
  render(<Md node={{ properties: { "data-cite": "1" } }} />);
  fireEvent.click(screen.getByRole("button", { name: /Source: Doc/ }));
  const strong = await screen.findByText("bold");
  expect(strong.tagName).toBe("STRONG");
  expect(screen.getByText("item one").tagName).toBe("LI");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gr/web exec vitest run components/citation.test.tsx`
Expected: FAIL — the markdown is rendered literally (`**bold**` text, no `<strong>`/`<li>`), so `strong.tagName` is not `"STRONG"`.

- [ ] **Step 3: Implement — render content as markdown**

In `apps/web/components/citation.tsx`, add imports near the top (after the existing imports):

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
```

Add this helper above `makeCitation`:

```tsx
/** Render a citation's chunk snippet as markdown (bold, lists, headings, code). No nested citations —
 *  a citation popup must not contain citation markers. */
function CitationMarkdown({ children }: { children: string }) {
  return (
    <div className="mt-1 space-y-1 text-sm text-muted-foreground [&_a]:underline [&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] dark:[&_code]:bg-white/15 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-0 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-black/10 [&_pre]:p-2 dark:[&_pre]:bg-white/10 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
```

Replace the plain-text content line inside `PopoverContent`:

```tsx
{c.content ? <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{c.content}</p> : null}
```

with:

```tsx
{c.content ? <CitationMarkdown>{c.content}</CitationMarkdown> : null}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @gr/web exec vitest run components/citation.test.tsx`
Expected: PASS — all cases, including the existing "renders a source icon and opens a popover" test (plain text `Tawaraya is a ryokan.` still renders inside a `<p>`, so its `getByText` still matches).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/citation.tsx apps/web/components/citation.test.tsx
git commit -m "feat(web): render citation popup content as markdown"
```

---

### Task 2: Rename backend — `renameConversation` query + `PATCH` route

**Files:**
- Modify: `packages/db/src/queries.ts` (add `renameConversation` after `setConversationTitle`)
- Modify: `apps/web/app/api/conversations/[id]/route.ts` (add `PATCH`)
- Test: `apps/web/test/conversations-route.test.ts`

**Interfaces:**
- Consumes: `conversations` table (`id`, `userId`, `title`), `and`, `eq` (already imported in `queries.ts`); `resolveAuth`, `createDb` (already imported in the route).
- Produces:
  - `renameConversation(db: Db, conversationId: string, userId: string, title: string): Promise<boolean>`
  - `PATCH(req, { params }): Response` on `/api/conversations/[id]` — 401 / 400 / 404 / 200 `{ ok: true, title }`.

- [ ] **Step 1: Add the failing tests**

In `apps/web/test/conversations-route.test.ts`, update the route import to include `PATCH`:

```ts
import { GET as detailGet, DELETE as detailDelete, PATCH as detailPatch } from "../app/api/conversations/[id]/route.js";
```

Add `renameConversation` to the queries import at the top of the file:

```ts
import { createUser, getOrCreatePersonalKb, createConversation, appendMessage, renameConversation } from "@gr/db/queries";
```

Add a JSON-body request helper next to the existing `req` helper:

```ts
const reqJson = (url: string, tok: string, method: string, body: unknown) =>
  new NextRequest(url, { method, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify(body) });
```

Add these two tests inside `describe("conversations endpoints", …)`:

```ts
it("renameConversation only renames the owner's conversation", async () => {
  const c = await createConversation(db, { kbId, userId: uid, title: "Q" });
  expect(await renameConversation(db, c, "u_conv_route_other", "nope")).toBe(false);
  expect(await renameConversation(db, c, uid, "yep")).toBe(true);
});

it("PATCH renames only the caller's conversation and validates input", async () => {
  const c = await createConversation(db, { kbId, userId: uid, title: "Old" });
  expect((await detailPatch(req(`http://localhost/api/conversations/${c}`, undefined, "PATCH"), ctx(c))).status).toBe(401);
  expect((await detailPatch(reqJson(`http://localhost/api/conversations/${c}`, token, "PATCH", { title: "   " }), ctx(c))).status).toBe(400);
  expect((await detailPatch(reqJson(`http://localhost/api/conversations/${c}`, otherToken, "PATCH", { title: "Hacked" }), ctx(c))).status).toBe(404);
  const ok = await detailPatch(reqJson(`http://localhost/api/conversations/${c}`, token, "PATCH", { title: "  New name  " }), ctx(c));
  expect(ok.status).toBe(200);
  expect((await ok.json()).title).toBe("New name");
  const detail = await detailGet(req(`http://localhost/api/conversations/${c}`, token), ctx(c));
  expect((await detail.json()).title).toBe("New name");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bash scripts/test.sh apps/web/test/conversations-route.test.ts`
Expected: FAIL — `renameConversation` is not exported and `PATCH` is undefined.

- [ ] **Step 3: Implement the query**

In `packages/db/src/queries.ts`, add after `setConversationTitle`:

```ts
/** Rename a conversation — only if `userId` owns it. Returns whether a row changed (no info leak). */
export async function renameConversation(db: Db, conversationId: string, userId: string, title: string): Promise<boolean> {
  const rows = await db.update(conversations).set({ title })
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .returning({ id: conversations.id });
  return rows.length > 0;
}
```

- [ ] **Step 4: Implement the route**

In `apps/web/app/api/conversations/[id]/route.ts`, add `renameConversation` to the queries import:

```ts
import { getConversationForUser, deleteConversation, renameConversation } from "@gr/db/queries";
```

Add the `PATCH` handler (after `GET`, before `DELETE`):

```ts
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { db } = createDb();
  const principal = await resolveAuth(db, req);
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { title?: unknown };
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  const ok = await renameConversation(db, id, principal.userId, title);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, title });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bash scripts/test.sh apps/web/test/conversations-route.test.ts`
Expected: PASS — all conversation-endpoint tests, including the two new ones.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/queries.ts apps/web/app/api/conversations/[id]/route.ts apps/web/test/conversations-route.test.ts
git commit -m "feat(web): rename conversation endpoint (ownership-scoped PATCH)"
```

---

### Task 3: Rename UI — kebab menu + inline edit in the slideout

**Files:**
- Modify: `apps/web/components/chat-history.tsx`
- Test: `apps/web/components/chat-history.test.tsx`

**Interfaces:**
- Consumes: `PATCH /api/conversations/{id}` with `{ title }` → `{ ok, title }` (Task 2); `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem` from `@/components/ui/dropdown-menu`.
- Produces: no new exports; changes the row's action affordance from an always-present trash icon to a `⋮` menu (Rename + Delete) plus an inline-edit input.

- [ ] **Step 1: Update the existing delete test to the kebab flow + add a rename test**

In `apps/web/components/chat-history.test.tsx`:

Extend the fetch mock to handle `PATCH` — replace `makeFetch`:

```tsx
function makeFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/conversations") return { ok: true, json: async () => ({ conversations }) } as Response;
    if (init?.method === "DELETE") return { ok: true, json: async () => ({ ok: true }) } as Response;
    if (init?.method === "PATCH") return { ok: true, json: async () => ({ ok: true, title: JSON.parse(String(init.body)).title }) } as Response;
    return { ok: false } as Response;
  });
}
```

Replace the existing `it("deletes a conversation after confirming …")` test body's action clicks so it opens the kebab first:

```tsx
it("deletes a conversation after confirming and reports when the active one is removed", async () => {
  const onDeletedActive = vi.fn();
  render(<ChatHistory open activeId="c1" onSelect={noop} onNew={noop} onDeletedActive={onDeletedActive} />);
  await screen.findByText("Kyoto trip");
  fireEvent.click(screen.getAllByLabelText("Conversation actions")[0]);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
  fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.queryByText("Kyoto trip")).toBeNull());
  expect(onDeletedActive).toHaveBeenCalled();
});
```

Add a rename test:

```tsx
it("renames a conversation via the kebab menu", async () => {
  render(<ChatHistory open activeId={null} onSelect={noop} onNew={noop} onDeletedActive={noop} />);
  await screen.findByText("Kyoto trip");
  fireEvent.click(screen.getAllByLabelText("Conversation actions")[0]);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
  const input = await screen.findByLabelText("Conversation name");
  fireEvent.change(input, { target: { value: "Kyoto 2026" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(screen.getByText("Kyoto 2026")).toBeTruthy());
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @gr/web exec vitest run components/chat-history.test.tsx`
Expected: FAIL — there is no "Conversation actions" label / kebab menu yet.

- [ ] **Step 3: Rewrite `chat-history.tsx` with the kebab menu + inline edit**

Replace the entire file `apps/web/components/chat-history.tsx` with:

```tsx
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @gr/web exec vitest run components/chat-history.test.tsx`
Expected: PASS — list/select/new tests unchanged, delete test via the kebab, and the new rename test.

If the `AlertDialog` wrapper does not accept controlled `open`/`onOpenChange` props (verify against `apps/web/components/ui/alert-dialog.tsx`: its `AlertDialog` should forward to `DialogPrimitive.Root`, which takes `open`/`onOpenChange`), stop and report — do not work around it; that is the intended base-ui API.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @gr/web typecheck`
Expected: clean (no errors).

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/chat-history.tsx apps/web/components/chat-history.test.tsx
git commit -m "feat(web): rename conversations via kebab menu with inline edit"
```

---

### Task 4: Scroll the slideout list when it overflows

**Files:**
- Modify: `apps/web/components/chat-history.tsx` (two className strings)

**Note:** This CSS-only fix has no automated test (asserting utility-class strings would test the implementation, not behavior). The deliverable is verified by the component suite still passing plus visual confirmation. If Task 3 already applied these exact classes (the file listing in Task 3 already includes `min-h-0`), this task is a no-op verification — confirm the classes are present and skip to Step 3.

- [ ] **Step 1: Ensure the flex chain sets `min-h-0`**

In `apps/web/components/chat-history.tsx`, confirm these two classNames (already present in Task 3's file):

- Root div: `className="flex h-full min-h-0 flex-col gap-3"`
- `ScrollArea`: `className="-mx-1 min-h-0 flex-1"`

The outer `SheetContent` (in `chat.tsx`) is already `flex h-full flex-col`, so with `min-h-0` on the `ChatHistory` root and the `ScrollArea`, the list bounds to the leftover height and scrolls; the "History / New chat" header stays fixed.

- [ ] **Step 2: Run the component suite to confirm nothing regressed**

Run: `pnpm --filter @gr/web exec vitest run components/chat-history.test.tsx`
Expected: PASS.

- [ ] **Step 3: Commit (only if this task changed anything beyond Task 3)**

If Task 3's committed file already contains both `min-h-0` classes, there is nothing to commit — note that and move on. Otherwise:

```bash
git add apps/web/components/chat-history.tsx
git commit -m "fix(web): scroll the conversations slideout when it overflows (min-h-0)"
```

---

## Final verification (before finishing the branch)

- [ ] Full node/DB suite: `bash scripts/test.sh` — all green.
- [ ] Full component suite: `pnpm --filter @gr/web exec vitest run` — all green.
- [ ] Typecheck: `pnpm --filter @gr/web typecheck` and `pnpm --filter @gr/db typecheck` — clean.
- [ ] Manual: open the slideout with many conversations → it scrolls; rename via `⋮` → Rename → edit → Enter persists (and after reopening History); a citation popup shows formatted markdown.
```
