# Mobile-Friendly UI — Design

**Date:** 2026-07-01
**Status:** Approved (design). Ready for implementation plan.

## Goal

Make the GoldenRetriever web UI render correctly on a phone (~375–430px). Today two elements overflow
the viewport width and force the mobile browser to zoom the whole page out: the header (logo + wordmark
+ 4 nav links + theme toggle + user button in one row) and the 5-column Library table. Fix those and
tidy the remaining surfaces so nothing exceeds the viewport width.

## Approach & conventions

- Mobile-first **Tailwind** responsive utilities. Breakpoint **`sm` (640px)** is the phone/desktop
  divide — an iPhone (375–430px) is below `sm`, so `sm:` variants target tablet/desktop.
- **No new dependencies.** Reuse existing primitives: `Sheet` (`ui/sheet.tsx`), `Card`, `Badge`,
  `Button`, `AlertDialog*`, and `relativeTime` (`lib/relative-time.ts`).
- Don't change desktop rendering — every current layout stays intact at `sm+`.

## 1. Global

- Add an explicit viewport to the root layout (`apps/web/app/layout.tsx`) so mobile scaling is
  guaranteed regardless of framework defaults:
  ```ts
  export const viewport = { width: "device-width", initialScale: 1 };
  ```
- No element may force width > viewport. The app container (`(app)/layout.tsx` `main`,
  `max-w-3xl px-4`) already gutters correctly; the fixes below remove the two overflow sources.

## 2. Header → hamburger menu on mobile

Files: `apps/web/app/(app)/layout.tsx`, new `apps/web/components/mobile-nav.tsx`.

- **`<sm`:** the header shows the **logo mark only** (the "GoldenRetriever" wordmark is
  `hidden sm:inline`), and a right-side cluster of `ThemeToggle` + `UserButton` + a **menu button**
  (lucide `Menu`) that opens a `Sheet`. The Sheet lists the four destinations (Library / Chat / Search /
  Settings) as full-width, large tap targets; tapping a link closes the Sheet (controlled `open` state,
  set false on navigation).
- **`sm+`:** the current inline `nav` (the four `NavLink`s) renders as today (`hidden sm:flex`); the
  mobile menu button is `sm:hidden`.
- `MobileNav` is a new **client** component (it holds the Sheet open state and uses `usePathname` to
  close on route change). It reuses the existing `Sheet`/`SheetContent`/`SheetTrigger` and the nav
  labels/hrefs.

## 3. Library → card list on mobile

File: `apps/web/components/library-list.tsx` (split its render into two presentational pieces).

- Extract two components that consume the same `LibraryDoc[]` and share one delete control:
  - **`DocTable`** — the current `<Table>` (Title / Status / Source / Added / Actions), rendered by
    `LibraryList` inside a `hidden sm:block` wrapper. Unchanged columns.
  - **`DocCards`** — the mobile list (`sm:hidden`): one `Card`/bordered row per doc containing the
    kind icon + title link, a wrapped badge row (**status pill · source label · relative date** via
    `relativeTime`), the tags, and the Delete confirm.
- The delete flow (the `remove` fetch + `AlertDialog` confirm) is shared — extract a small
  `DeleteDoc({ id, label, busy, onDelete })` used by both `DocTable` and `DocCards` so the confirm
  dialog isn't duplicated.
- `LibraryList` keeps its empty-state card, then renders both `<DocTable>` (`hidden sm:block`) and
  `<DocCards>` (`sm:hidden`).
- **Testability note:** jsdom does not apply CSS media queries, so a single component rendering both
  tree branches would duplicate every text node and break `getByText`. Splitting into `DocTable` and
  `DocCards` lets each be tested independently with unambiguous queries.

## 4. Chat — minor

File: `apps/web/components/chat.tsx`.

- Reduce the message-bubble side gutters on mobile so bubbles aren't over-squeezed at 375px:
  `mr-6 sm:mr-9` (assistant) / `ml-6 sm:ml-9` (user) on the content wrapper.
- Card padding `p-3 sm:p-4`. The History `Sheet` is already `w-80 max-w-[85vw]`; the input row and
  header (History / New chat) already fit. No structural change.

## 5. Settings / Memory — minor

File: `apps/web/components/memory-settings.tsx`.

- The toggle header (`flex items-center justify-between`) can crowd on a phone — make it stack:
  `flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`.
- The memory rows already truncate content (`min-w-0 flex-1 truncate`) and fit. `ApiTokens` already
  wraps long tokens/URLs (`break-all`); left functionally as-is (a token-styling refresh is out of
  scope — see below).

## 6. Add-content — minor

File: `apps/web/components/add-content.tsx`.

- Ensure the file `<Input type="file">` is `w-full` (prevents a wide native file control from
  overflowing). Text/URL tabs already use full-width inputs.

## Testing

- **Component (jsdom):**
  - `DocTable` — renders rows, status pills, source labels, timestamps, tags (the current
    `library-list.test.tsx` assertions, retargeted to `DocTable`).
  - `DocCards` — renders each doc's title, status, source, relative date, tags, and a working Delete
    confirm (mock fetch).
  - `MobileNav` — the menu button opens the Sheet and the four destination links are present.
  - `LibraryList` empty state still shows "nothing saved yet".
- Chat / Settings / Add-content changes are class-only; existing tests remain valid.
- Full node + component suite green and `typecheck` clean before merge.

## File structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `apps/web/app/layout.tsx` | `viewport` export |
| Modify | `apps/web/app/(app)/layout.tsx` | logo-mark-only on mobile; inline nav `hidden sm:flex`; render `MobileNav` `sm:hidden` |
| Create | `apps/web/components/mobile-nav.tsx` | hamburger menu button + Sheet with the 4 links |
| Create | `apps/web/components/mobile-nav.test.tsx` | menu opens, links present |
| Modify | `apps/web/components/library-list.tsx` | split into `DocTable` + `DocCards` + shared `DeleteDoc`; responsive wrappers |
| Modify | `apps/web/components/library-list.test.tsx` | retarget to `DocTable`; add `DocCards` tests |
| Modify | `apps/web/components/chat.tsx` | mobile bubble gutters + card padding |
| Modify | `apps/web/components/memory-settings.tsx` | stack toggle header on mobile |
| Modify | `apps/web/components/add-content.tsx` | file input `w-full` |

## Global constraints (inherited)

- UI on **base-ui** (`@base-ui/react`, `render={<X/>}` props — not Radix `asChild`); Tailwind v4 theme
  tokens; `cn` from `@/lib/utils`; `@/` alias → `apps/web` root.
- Desktop (`sm+`) rendering is unchanged; only mobile (`<sm`) behavior is added.
- No new dependencies. Reuse `Sheet`, `Card`, `Badge`, `Button`, `AlertDialog*`, `relativeTime`.
- Tests: component (jsdom) via `pnpm --filter @gr/web exec vitest run components/<file>`; full suite via
  `bash scripts/test.sh`.

## Out of scope (deferred polish)

- Restyling `ApiTokens` from raw HTML/hardcoded neutral colors to the `Button`/`Input` primitives +
  theme tokens (a consistency/dark-mode fix, not a mobile-overflow fix).
- A bottom tab bar (the alternative nav pattern) — the hamburger was chosen.
