# Inline Source-Icon Citations — Design

**Date:** 2026-07-02
**Status:** Approved (design). Ready for implementation plan.

## Goal

Replace the inline `[n]` numeric citation markers + the citation chips below each reply with an inline,
tappable **source-kind icon** that opens a **popover** showing the referenced library item's title and
the exact chunk of text it cites — so the user can find the reference without leaving the conversation.

## Behavior

- Each inline `[n]` in an assistant reply renders as the **kind icon of that source** (web → globe,
  pdf/document → document, image → image, text/other → file) as a small superscript button.
- Tapping/clicking it opens a **popover** anchored to the icon containing: the source **title**, the
  **chunk of text** it references, and — when the source has a URL — an "Open source" link (`safeHref`,
  new tab).
- The **citation chips below the reply are removed.**
- An `[n]` with no matching citation (out of range) falls back to rendering the literal `[n]` text.

## Data (backend)

The chat route already retrieves the cited chunks (`hits`, each with `content` and `documentId`); it
just doesn't ship the icon-kind or the text to the client.

- `Citation` (`apps/web/lib/citations.ts`) gains two fields:
  `{ chunkId, documentId, title, sourceUrl, kind: string, content: string }`.
  - `kind` — the source document's kind (drives the icon).
  - `content` — the referenced chunk, **capped to 500 chars** (append `"…"` when truncated) via a
    `snippet(text, max = 500)` helper.
- New query `getDocumentKinds(db, documentIds: string[]): Promise<Map<string, string>>`
  (`packages/db/src/queries.ts`) — one `SELECT id, kind FROM documents WHERE id IN (...)` for the
  distinct cited document ids.
- Chat route (`apps/web/app/api/chat/route.ts`): after building `hits`, fetch the kinds and set each
  citation's `kind` (fallback `"text"`) and `content = snippet(h.content)`. The `x-citations` header
  encoding is unchanged (`encodeCitations` JSON-encodes the richer objects). The no-hits/REFUSAL branch
  still sends `[]`.
- **Header size:** ≤ 8 citations × ~500 chars ≈ 4 KB before `encodeURIComponent`; acceptable. (Rejected
  alternative: a `GET /api/chunks/[id]` fetch-on-open — avoids header size but adds a round-trip + a new
  endpoint; the snippet keeps the popover instant.)

## Rendering (client)

- The assistant `Turn.citations` keeps the **full ordered** array (so `[n]` → `citations[n-1]`); the
  client stops filtering to `citedOnly` and stops rendering chips. The client `Citation` type gains
  `kind` and `content`.
- **Remark plugin** — `apps/web/lib/remark-citations.ts`, a tiny **no-dependency** transformer: it
  recursively walks the mdast tree and, for every `text` node whose value contains `[\d+]`, splits the
  value into `text` nodes and **citation nodes**. A citation node carries `data: { hName: "cite",
  hProperties: { "data-cite": String(n) } }` so `mdast-util-to-hast` (inside react-markdown) emits a
  `<cite data-cite="n">` element.
- **Citation component** — `apps/web/components/citation.tsx`. react-markdown renders `<cite>` via a
  `components={{ cite: ... }}` override; the component reads the index from the hast node
  (`props.node.properties["dataCite"]`), looks up `citations[index-1]` (passed in via the `Markdown`
  closure), and renders the source's `KindIcon` as a small superscript button that opens a `Popover`
  (title + chunk snippet + optional "Open source" link). Out-of-range → render `[index]` text.
- `Markdown` (`apps/web/components/chat.tsx`) takes an extra `citations` prop, registers
  `remarkCitations` in `remarkPlugins`, and builds the `components={{ cite }}` map with the citations in
  scope. The chip block in `Transcript` is deleted.

## New / refactored components

- **`apps/web/components/ui/popover.tsx`** — base-ui `@base-ui/react/popover` wrapper (Root / Trigger /
  Portal / Positioner / Popup), mirroring the `ui/sheet.tsx` + `ui/alert-dialog.tsx` conventions
  (`data-slot`, `cn`, `render={<X/>}` props). Exposes `Popover`, `PopoverTrigger`, `PopoverContent`.
- **`apps/web/components/kind-icon.tsx`** — extract the existing `KindIcon` (currently private in
  `library-list.tsx`) so the Library and the citation marker share one mapping. `library-list.tsx`
  imports it instead of defining it.

## Error / edge cases

- No `[n]` in the reply → no icons, no chips (unchanged text).
- Chunk with empty `content` → popover shows title only.
- Long chunk → snippet truncated with `"…"`.
- `sourceUrl` null / unsafe → no "Open source" link (`safeHref` guards, as today).
- The chunk text is rendered as **plain text** (not HTML) inside the popover — no XSS surface; the link
  uses the existing `safeHref`.
- Popover positioning near screen edges is handled by base-ui's collision-aware positioner (works on
  mobile tap).

## Testing

- **Unit** (`apps/web/lib`): `remarkCitations` — a paragraph `"a [1] b [2]"` produces text + two
  citation nodes with the right `data-cite`; a value with no marker is untouched; `"[9]"` still becomes
  a citation node (resolution/out-of-range handled in the component). `snippet()` — caps + ellipsis.
- **Component** (jsdom): a reply with `content: "Stay at Tawaraya [1]."` + a citation
  `{ kind: "web", title: "Kyoto", content: "Tawaraya is a ryokan.", sourceUrl: "https://x" }` renders an
  inline icon (not the text `[1]`) and **no** chips; clicking the icon opens a popover showing the title
  and the chunk text. An out-of-range `[2]` renders as text.
- **Route/integration**: the `x-citations` payload includes `kind` and a capped `content` for each hit.

## File structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `apps/web/lib/citations.ts` | `Citation` + `kind`/`content`; `snippet()`; remove `citedOnly` (dead once chips go) |
| Modify | `packages/db/src/queries.ts` | `getDocumentKinds` |
| Modify | `apps/web/app/api/chat/route.ts` | attach `kind` + `content` snippet to citations |
| Create | `apps/web/lib/remark-citations.ts` | no-dep `[n]` → citation-node plugin |
| Create | `apps/web/lib/remark-citations.test.ts` | plugin + snippet tests |
| Create | `apps/web/components/ui/popover.tsx` | base-ui Popover primitive |
| Create | `apps/web/components/kind-icon.tsx` | shared `KindIcon` (extracted) |
| Create | `apps/web/components/citation.tsx` | icon marker + popover |
| Create | `apps/web/components/citation.test.tsx` | inline icon + popover behavior |
| Modify | `apps/web/components/chat.tsx` | `Markdown` uses the plugin + `Citation`; delete the chip block; `send()` keeps full citations |
| Modify | `apps/web/components/chat.test.tsx` | drop chip assertions; keep markdown/safeHref |
| Modify | `apps/web/components/library-list.tsx` | import shared `KindIcon` |

## Global constraints (inherited)

- UI on **base-ui** (`@base-ui/react`, `render={<X/>}` props — not Radix `asChild`); Tailwind v4 tokens;
  `cn` from `@/lib/utils`.
- **No new dependencies** — the remark plugin is hand-written (no `unist-util-visit`); Popover is the
  already-present `@base-ui/react`.
- Keep the citation link XSS guard (`safeHref`); render chunk text as plain text.
- Retrieval is KB-scoped, so cited chunks are the caller's own content — no cross-user exposure.
- Tests: component (jsdom) via `pnpm --filter @gr/web exec vitest run components/<file>`; pure/lib +
  node via `pnpm exec vitest run <path>` or `bash scripts/test.sh`.

## Out of scope

- Changing how the model is prompted or how `[n]` markers are produced (still the grounded `[n]` format).
- A fetch-on-open chunk endpoint (snippet-in-payload chosen).
