# GoldenRetriever UI Redesign — Design

**Date:** 2026-06-28
**Status:** Approved (design)
**Scope:** `apps/web` only — visual/UX redesign, no backend/API changes.

## Overview

Replace the plain, raw-Tailwind UI with a polished, professional look built on the shadcn
design system that's already installed (`components.json`, `components/ui/*`, theme tokens in
`globals.css`). Direction (chosen): **warm & golden, on-brand**; **light + dark with a toggle**;
a **minimal golden-retriever logo mark**.

## Goals

- A cohesive warm-gold theme (light + dark) via shadcn CSS-variable tokens.
- A real brand mark (golden-retriever SVG) + wordmark + favicon/app icon.
- Add-content card split into **Text / URL / File** tabs.
- Library list rendered as a **data table** with **status badge pills** and an **added timestamp**.
- Consistent styling across Chat and Search (no logic changes).

## Non-goals

- No changes to API routes, ingestion, auth, or data model.
- No new product features; delete/confirm and per-row actions stay as today (delete only).
- No i18n, no responsive redesign beyond "works on a phone-width column" (current max-w-3xl stays).

## Design tokens (`apps/web/app/globals.css`)

Define the palette as oklch CSS variables under `:root` (light) and `.dark`. Representative
values (tuned for WCAG AA contrast during implementation):

**Light**
- `--background: oklch(0.985 0.004 85)` (warm paper), `--foreground: oklch(0.22 0.012 60)`
- `--card / --popover: oklch(1 0 0)`, `*-foreground: oklch(0.22 0.012 60)`
- `--primary: oklch(0.66 0.14 70)` (warm gold), `--primary-foreground: oklch(0.99 0.01 85)`
- `--secondary / --muted / --accent: oklch(0.96 0.008 80)`, `--muted-foreground: oklch(0.50 0.012 60)`
- `--accent: oklch(0.94 0.03 82)` (soft gold tint), `--accent-foreground: oklch(0.28 0.02 60)`
- `--destructive: oklch(0.58 0.20 25)`, `--border / --input: oklch(0.90 0.008 80)`
- `--ring: oklch(0.66 0.14 70)`, `--radius: 0.625rem`

**Dark**
- `--background: oklch(0.20 0.008 60)` (warm charcoal), `--foreground: oklch(0.96 0.006 85)`
- `--card / --popover: oklch(0.24 0.008 60)`
- `--primary: oklch(0.78 0.14 78)` (brighter gold), `--primary-foreground: oklch(0.22 0.02 60)`
- `--muted: oklch(0.27 0.008 60)`, `--muted-foreground: oklch(0.72 0.01 78)`
- `--border: oklch(1 0 0 / 10%)`, `--input: oklch(1 0 0 / 12%)`, `--ring: oklch(0.78 0.14 78)`

**Status colors** (not shadcn tokens) — applied via a `statusBadge(status)` helper returning
Tailwind classes, both modes:
- `ready` → emerald (`bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300`)
- `processing` → amber, `failed` → red, `queued`/default → slate.

## Typography

Add the `geist` package and apply **Geist Sans** as `--font-sans` via the root layout
(`import { GeistSans } from "geist/font/sans"` → `className={GeistSans.variable}`). Headings use
the same family at tighter tracking/weight. (Geist falls back to system/Inter.)

## Branding

- `apps/web/components/logo.tsx` — an inline **SVG golden-retriever mark** (flat, geometric, uses
  `currentColor`/`--primary` so it themes) + a "GoldenRetriever" wordmark. Exports `<Logo />`
  (mark+wordmark) and `<LogoMark />` (mark only).
- `apps/web/app/icon.svg` — favicon from the same mark on a gold/transparent ground (Next.js
  serves this as the favicon automatically). A PNG `apple-icon` is a follow-up, not required here.

## Navigation (`apps/web/app/(app)/layout.tsx`)

Rebuild the header: `<Logo>` left; nav links **Library / Chat / Search / Settings** with an
**active state** (a small client `NavLink` using `usePathname`, gold underline/!text for active);
right side **`<ThemeToggle/>`** + Clerk `<UserButton/>`. Sticky top, `border-b`, `bg-background/80`
backdrop blur. Content stays in `mx-auto max-w-3xl px-4`.

## Theme plumbing

- `apps/web/components/theme-provider.tsx` — wraps `next-themes` `ThemeProvider`
  (`attribute="class" defaultTheme="system" enableSystem`).
- `apps/web/components/theme-toggle.tsx` — sun/moon button (lucide icons) toggling light/dark.
- Root layout (`app/layout.tsx`): add `suppressHydrationWarning` to `<html>`, set the font
  variable on `<body>`, wrap children in `ThemeProvider`, and render shadcn `sonner` `<Toaster/>`.

## Add-content → Tabs (`apps/web/components/add-content.tsx`)

A `Card` titled "Add to your library" containing shadcn `Tabs` with three triggers — **Text**,
**URL**, **File**:
- **Text:** `Textarea` + "Save text" `Button`.
- **URL:** `Input` (type=url) + "Save page" `Button`.
- **File:** a click/drop area (`Input type=file`, accept `.pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg`)
  + helper text and a busy state.
- On success: `toast.success("Saved — processing…")` then `router.refresh()` (replace
  `location.reload()`); on failure: `toast.error(...)`. Buttons show a spinner while `busy`.

## Library → Data table (`apps/web/components/library-list.tsx`)

A shadcn `Table` (wrapped in a `Card`):
- **Columns:** Title (kind icon from lucide — FileText/Link/Image/etc. + clickable `safeHref`
  source link, or "Untitled"); Status (`Badge` via `statusBadge`, label uppercased, e.g. READY);
  Added (`capturedAt` formatted `"Jun 28, 2026, 1:42 PM"` via `Intl.DateTimeFormat`); Actions
  (a destructive delete with an `AlertDialog` confirm).
- **Empty state:** a centered muted message + icon inside the card ("Nothing saved yet — add a
  page to get started.").
- Delete calls `DELETE /api/documents/:id` then `router.refresh()` + toast.

## Consistency pass (Chat, Search)

Restyle only (no logic): wrap Chat and Search in `Card`s; use shadcn `Input`/`Button`; render
chat citation chips and search result status with the shared `Badge`/tokens. Keep the existing
`safeHref` non-link behavior for sourceless items.

## Components to add

shadcn CLI: `tabs table badge label sonner dropdown-menu separator skeleton alert-dialog`.
npm deps: `next-themes`, `geist`. (button/card/input/textarea/scroll-area already present.)

## File structure

- **Create:** `components/logo.tsx`, `components/theme-provider.tsx`, `components/theme-toggle.tsx`,
  `components/nav-link.tsx`, `lib/status.ts` (the `statusBadge` + status label helpers),
  `app/icon.svg`, `components/ui/{tabs,table,badge,label,sonner,
  dropdown-menu,separator,skeleton,alert-dialog}.tsx` (CLI-generated).
- **Modify:** `app/globals.css` (tokens + font var), `app/layout.tsx` (font, ThemeProvider,
  Toaster), `app/(app)/layout.tsx` (nav), `components/add-content.tsx` (tabs),
  `components/library-list.tsx` (table), `components/chat.tsx` + `components/search.tsx`
  (token/component restyle), `package.json` (deps).

## Testing (jsdom component tests)

- `add-content.test.tsx`: renders three tabs; switching to URL/File shows that tab's control;
  submitting Text posts to `/api/ingest` (mock fetch) and shows a success toast.
- `library-list.test.tsx`: renders a row per doc; a `ready` doc shows a "READY" badge, a `failed`
  doc a "FAILED" badge; the formatted `Added` timestamp is present; delete calls the DELETE
  endpoint after confirm.
- `theme-toggle.test.tsx`: toggling flips the theme (mock `next-themes` `useTheme`).
- Update `chat.test.tsx` / `search.test.tsx` only if selectors change; keep the full Vitest suite
  (node + component) green via `scripts/test.sh`.

## Out of scope / follow-ups

- Live status auto-refresh (polling/streaming) for "processing → ready" without a manual refresh.
- Responsive multi-column / sidebar layout.
- A full brand style guide.
