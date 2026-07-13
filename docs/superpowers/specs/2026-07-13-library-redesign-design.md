# Library Page Redesign Design (Add modal + FAB, cards everywhere, tag filtering)

**Status:** Approved pending user review
**Date:** 2026-07-13

Four changes to the Library page (`app/(app)/page.tsx`): (1) the "Add to your library" card becomes a modal; (2) a floating **+** button opens it; (3) the document list uses the card layout at every screen size; (4) click-to-filter by tags.

All document data (including `tags: string[]` per doc) is already loaded by the server page via `listDocuments`, so tag filtering is **client-side** — no new endpoint, no refetch.

## 1 + 2. Add modal + floating button

### `components/ui/dialog.tsx` — centered modal primitive (new)

A thin wrapper over `@base-ui/react/dialog` (the same primitive `sheet.tsx` uses), mirroring its export style: `Dialog` (Root), `DialogTrigger`, `DialogClose`, `DialogTitle`, and `DialogContent`. `DialogContent` renders a `Portal` + `Backdrop` (`bg-black/40`) + a centered `Popup` (`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2`, `max-w-lg`, `max-h-[90vh] overflow-y-auto`, rounded, shadow) with an absolutely-positioned **×** `DialogClose` (`aria-label="Close"`) in the top-right. base-ui Dialog dismisses on backdrop click and Escape by default — satisfying "click outside dismisses."

### `components/add-content-modal.tsx` — FAB + modal (new, client)

```tsx
export function AddContentModal({ kbId }: { kbId: string }): JSX.Element;
```

- Renders a `Dialog` whose `DialogTrigger` is a **floating round `+` button** — `Button` with `aria-label="Add to your library"`, fixed to the page bottom-right (`fixed bottom-6 right-6 z-40 size-14 rounded-full shadow-lg`).
- `DialogContent` (`max-w-xl`) contains a `DialogTitle` "Add to your library" followed by `<AddContent kbId={kbId} />`.
- The modal is uncontrolled (open state owned by base-ui); it stays open after a save so several items can be added — the library refreshes behind it via `AddContent`'s existing `router.refresh()`.

### `components/add-content.tsx` — strip the Card wrapper

`AddContent` currently wraps its tabs in `<Card><CardHeader><CardTitle>Add to your library</CardTitle></CardHeader><CardContent>…</CardContent></Card>`. Replace that outer wrapper with a plain `<div>` (keep the `Tabs`/`TabsList`/`TabsContent` body exactly as-is), and remove the now-unused `Card*` imports. The modal supplies the title/container. (No other consumer of `AddContent` exists; its tests assert the tabs, not the card.)

### `app/(app)/page.tsx`

Replace `<AddContent kbId={kbId} />` with `<AddContentModal kbId={kbId} />` (import from `../../components/add-content-modal.js`). `LibraryList` stays.

## 3. Cards at every size

In `library-list.tsx`:
- **Delete `DocTable`** and the `Table*` imports.
- `DocCards` renders at all sizes — remove its `sm:hidden` so the container is just `space-y-2` (the outer `max-w-3xl` page container keeps cards readable on desktop).

## 4. Tag filtering (client-side)

- `LibraryList` gains `selected: Set<string>` state and helpers `addTag`, `removeTag(t)`, `clearTags`.
- **Tags become clickable:** the `Tags` component takes an optional `onClick?: (tag: string) => void`. When provided, each tag renders as a `<button>` (calls `onClick(tag)` — hover-highlighted); otherwise a plain `<span>` (unchanged). `DocCards` accepts and forwards `onTagClick` to each card's `Tags`.
- **Filter rule:** `visible = selected.size === 0 ? docs : docs.filter(d => [...selected].every(t => d.tags.includes(t)))` — AND across all selected tags. Because every selected tag must be present, **untagged docs are hidden once any tag is selected** (requirement met inherently).
- **Filter bar** (rendered above the list only when `selected.size > 0`): a **Clear** button (leftmost) calling `clearTags`, then one pill per selected tag — a `<button>` showing the tag + an `×` (lucide `X`) that calls `removeTag(t)`.
- If `selected.size > 0` and `visible` is empty, show a "No documents match the selected tags." card instead of the list.
- The empty-library state (`docs.length === 0`) is unchanged.

## Testing

- **`components/add-content-modal.test.tsx`** (jsdom, new): the FAB (`getByRole("button", { name: "Add to your library" })`) is present; clicking it opens the dialog (the `Text` tab appears); clicking **Close** (`getByRole("button", { name: "Close" })`) dismisses it. Mock `sonner`/`next/navigation` as the other component tests do.
- **`components/library-list.test.tsx`** (update): drop the `DocTable` describe + import. Keep the `DocCards` test. Add `LibraryList` tests (with a doc set where `d1` has `["travel","kyoto"]`, `d4` has `["travel"]`, and untagged docs): clicking `travel` shows only tagged matches and hides untagged docs + renders the `travel` pill and `Clear`; then clicking `kyoto` AND-narrows to only `d1`; the pill's `×` removes that tag; `Clear` resets to all docs; and `screen.queryByRole("table")` is null (no desktop table).
- **`components/add-content.test.tsx`**: unchanged assertions still pass after the Card strip (verify).

## Out of scope

- OR filtering, a tag search box, or a global "all tags" chip list (only tags visible on cards are clickable).
- Auto-closing the modal after a successful save.
- Server-side filtering / pagination; changing `listDocuments` or any endpoint.
- A responsive multi-column card grid (single column at all sizes, per the request).

## Global constraints

- base-ui primitives via `render={<X/>}` props (never Radix `asChild`); reuse `Button`, `Card`, `Badge`, lucide, `cn`. The new `dialog.tsx` mirrors `sheet.tsx`'s wrapper style.
- No server/DB/endpoint changes — tag filtering and the modal are purely client-side over already-loaded data.
- Tailwind v4; `@/` alias → `apps/web`. Component tests via `pnpm --filter @gr/web exec vitest run components/<file>`.
