# Chat Refinements Design (Citations markdown · Rename · Scrollable slideout)

**Status:** Approved pending user review
**Date:** 2026-07-03

Three independent refinements to the shipped Ask/chat surface. Each is small and testable on its own; they share no state, so they can be built and reviewed in any order.

---

## Feature 1 — Markdown in the citation popup

**Problem:** The citation popover renders the referenced chunk as plain text
([citation.tsx:36](../../../apps/web/components/citation.tsx)), so markdown in the
source (headings, bold, lists — chunks are markdown produced by the markitdown
ingest) shows as raw `**…**`, `- …`, `#`, etc.

**Change:** Render `c.content` through `react-markdown` + `remarkGfm`, the same
renderer the reply uses — but **without** `rehypeCitations` and without the
`cite` component (a citation popup must not contain nested citations).

- Add a small presentational `CitationMarkdown({ children }: { children: string })`
  helper (in `citation.tsx`) that wraps `<ReactMarkdown remarkPlugins={[remarkGfm]}>`
  in a `div` carrying the same prose utility classes the reply's `Markdown` uses
  (list/heading/code styling), sized for the popover (`text-sm text-muted-foreground`).
- Replace the `<p className="… whitespace-pre-wrap …">{c.content}</p>` line with
  `<CitationMarkdown>{c.content}</CitationMarkdown>` (still guarded by `c.content ?`).
- **Payload unchanged:** the snippet stays capped at 500 chars
  (`snippet()` in `lib/citations.ts`). react-markdown degrades gracefully when the
  cap truncates markdown mid-syntax (e.g. an unclosed `**`) — it renders the text
  rather than throwing.

**Testing (component, jsdom):** a test in `components/citation.test.tsx` that
`makeCitation([{…, content: "**bold** and a\n- list item"}])`, opened, renders a
`<strong>` and an `<li>` (asserts markdown is parsed, not shown literally).

---

## Feature 2 — Rename a conversation (kebab menu)

**UX (chosen):** Replace the per-row inline trash icon with a **kebab (`⋮`) menu**
holding **Rename** and **Delete**. Selecting **Rename** turns the row title into an
inline text field (Enter = save, Esc = cancel, blur = save). **Delete** opens the
existing confirm dialog. The `⋮` button is always visible (one unobtrusive icon,
reliably tappable on touch — unlike today's `opacity-0 group-hover` trash, which
touch can't reveal).

### Backend

- **New query** `renameConversation(db, id, userId, title): Promise<boolean>` in
  `packages/db/src/queries.ts` — ownership-scoped `UPDATE … SET title WHERE id AND
  user_id`, returning whether a row changed (mirrors `deleteConversation`'s authz
  so a caller can never rename another user's conversation).
- **New route** `PATCH /api/conversations/[id]` in
  `apps/web/app/api/conversations/[id]/route.ts`:
  - 401 if unauthenticated.
  - Parse `{ title }`; `clean = title.trim().slice(0, 200)`; 400 if `clean` empty
    or `title` not a string.
  - `renameConversation(db, id, principal.userId, clean)` → 404 if it returns
    false (not owned / missing), else `{ ok: true, title: clean }`.

### Frontend (`apps/web/components/chat-history.tsx`)

- Component-level state: `editingId: string | null` and `pendingDelete: string | null`
  (a single controlled `AlertDialog` lifted out of the row map, opened by
  `pendingDelete`).
- Per row:
  - Not editing → title button (select) + `⋮` `DropdownMenu`
    (`DropdownMenuItem` **Rename** → `setEditingId(c.id)`;
    `DropdownMenuItem variant="destructive"` **Delete** → `setPendingDelete(c.id)`).
  - Editing → an `<input>` (autofocus, defaultValue = title) in place of the title;
    **Enter**/blur calls `save(id, value)`, **Esc** cancels (`setEditingId(null)`).
- `save(id, value)`: trim; if empty or unchanged → just exit edit mode; else
  `PATCH /api/conversations/{id}` with `{ title }`, on success update the local
  `items` title, on failure `toast.error("Couldn't rename")`. Always exit edit mode.
- The active conversation's title is owned by the list here; renaming the currently
  open thread only needs the list updated (the transcript header does not show the
  title today), so no cross-component sync is required.

**Testing:**
- **DB (integration)** `renameConversation`: renames own conversation (returns true,
  title changed); returns false and leaves the row unchanged for a non-owner.
- **Route (integration)** `PATCH /api/conversations/[id]`: 401 (no auth),
  400 (empty title), 404 (not owned), 200 + persisted title (owned). Reuses the
  existing conversation-route test harness.

---

## Feature 3 — Scrollable slideout list

**Root cause (not a missing scroller):** the list is already wrapped in
`ScrollArea flex-1` ([chat-history.tsx:61](../../../apps/web/components/chat-history.tsx)),
but the flex chain never sets `min-h-0`. `SheetContent` is `flex h-full flex-col`;
`ChatHistory`'s root is `flex h-full flex-col`; the `ScrollArea` is `flex-1`. Without
`min-h-0`, a flex item refuses to shrink below its content's height, so the area grows
to fit every row and pushes the sheet past the viewport instead of scrolling.

**Change (CSS only):**
- `ChatHistory` root: `flex h-full flex-col gap-3` → `flex h-full min-h-0 flex-col gap-3`.
- The `ScrollArea`: `-mx-1 flex-1` → `-mx-1 min-h-0 flex-1`.

This bounds the scroll area to the leftover height under the "History / New chat"
header, so a long list scrolls within the fixed-height sheet. No primitive changes.

**Testing:** CSS-only layout fix — verified visually (seed enough conversations to
overflow the viewport, confirm the list scrolls and the header stays put). No unit
test (asserting utility-class strings would test the implementation, not behavior).

---

## Out of scope

- Renaming from anywhere other than the slideout (no title UI in the transcript).
- Editing message content or citations.
- Full mobile-nav a11y pass (tracked in `backlog.md`); this only makes the row's
  own action affordance touch-reachable.

## Global constraints

- base-ui primitives via `render={<X/>}` props (never Radix `asChild`); reuse the
  existing `dropdown-menu.tsx`, `alert-dialog.tsx`, `input.tsx`, `button.tsx`.
- Ownership checks live in the query layer (`WHERE … user_id = …`), consistent with
  `deleteConversation` / `getConversationForUser`.
- Tailwind v4 utility classes; `cn` from `@/lib/utils`.
