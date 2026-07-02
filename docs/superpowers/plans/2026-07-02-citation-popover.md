# Inline Source-Icon Citations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace inline `[n]` markers + the citation chips with an inline source-kind icon that opens a popover showing the referenced item's title and the chunk of text it cites.

**Architecture:** The chat route ships each citation's `kind` + a capped chunk `content` in the `x-citations` payload. On the client, a tiny no-dep **rehype** plugin turns `[n]` text into `<cite data-cite="n">` hast elements; react-markdown renders those via a `Citation` component (the source's `KindIcon` in a base-ui `Popover`). The chips below the reply are removed.

**Tech Stack:** Next.js 15, react-markdown 10 (+ rehype), base-ui `@base-ui/react` (Popover), Drizzle, Vitest.

## Global Constraints

- base-ui `render={<X/>}` props (NOT Radix `asChild`); Tailwind v4 tokens; `cn` from `@/lib/utils`.
- **No new dependencies** — the rehype plugin is hand-written (no `unist-util-visit`); Popover is the already-present `@base-ui/react/popover`.
- Chunk `content` is capped to **500 chars** (append `"…"` if truncated) and rendered as **plain text** (no HTML → no XSS); the source link uses the existing `safeHref`.
- `[n]` with no matching citation renders the literal `[n]` text.
- Desktop + mobile both use the Popover (base-ui positioner is collision-aware).
- Test runners: pure/lib via `pnpm exec vitest run <path>`; DB/route via `bash scripts/test.sh <path>`; component (jsdom) via `pnpm --filter @gr/web exec vitest run components/<file>`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Ship `kind` + chunk `content` in the citations payload

**Files:**
- Modify: `apps/web/lib/citations.ts` (Citation + `snippet`)
- Modify: `apps/web/lib/citations.test.ts` (add `snippet` tests)
- Modify: `packages/db/src/queries.ts` (`getDocumentKinds`)
- Test: `packages/db/src/queries.tags.test.ts` (add a `getDocumentKinds` test — it already has a KB + docs fixture)
- Modify: `apps/web/app/api/chat/route.ts` (attach `kind` + `content`)
- Modify: `apps/web/test/chat-route.test.ts` (assert payload carries `content` + `kind`)

**Interfaces:**
- Produces: `Citation { chunkId; documentId; title: string | null; sourceUrl: string | null; kind: string; content: string }`; `snippet(text: string, max?: number): string`; `getDocumentKinds(db, documentIds: string[]): Promise<Map<string, string>>`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/lib/citations.test.ts` (keep the existing tests):

```ts
import { snippet } from "./citations.js";

describe("snippet", () => {
  it("trims and passes through short text", () => {
    expect(snippet("  hello  ")).toBe("hello");
  });
  it("caps long text with an ellipsis", () => {
    const out = snippet("x".repeat(600), 500);
    expect(out.length).toBe(501); // 500 chars + "…"
    expect(out.endsWith("…")).toBe(true);
  });
});
```

Add to `packages/db/src/queries.tags.test.ts` (it already creates `kbId`/`uid` and inserts docs):

```ts
import { getDocumentKinds } from "./queries.js";

describe("getDocumentKinds", () => {
  it("maps document ids to their kind", async () => {
    const docId = await insertDocument(db, {
      kbId, addedBy: uid, kind: "web", captureMode: "url_fetch",
      sourceUrl: "https://x.dev", title: "K", mimeType: "text/html",
    });
    const kinds = await getDocumentKinds(db, [docId, "nope"]);
    expect(kinds.get(docId)).toBe("web");
    expect(kinds.has("nope")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec vitest run apps/web/lib/citations.test.ts` (FAIL — `snippet` missing) and
`bash scripts/test.sh packages/db/src/queries.tags.test.ts` (FAIL — `getDocumentKinds` missing).

- [ ] **Step 3: Implement the data helpers**

In `apps/web/lib/citations.ts`, extend `Citation` and add `snippet` (keep `encodeCitations`,
`parseCitations`, and `citedOnly` unchanged for now — `citedOnly` is removed in Task 5):

```ts
export interface Citation {
  chunkId: string; documentId: string;
  title: string | null; sourceUrl: string | null;
  kind: string; content: string;
}

/** Trim + cap chunk text for the citation popover. */
export function snippet(text: string, max = 500): string {
  const t = text.trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}
```

In `packages/db/src/queries.ts` (`documents` and `inArray` are already imported), add:

```ts
/** Map the given document ids to their `kind` (for the citation source icon). */
export async function getDocumentKinds(db: Db, documentIds: string[]): Promise<Map<string, string>> {
  if (documentIds.length === 0) return new Map();
  const rows = await db.select({ id: documents.id, kind: documents.kind })
    .from(documents).where(inArray(documents.id, documentIds));
  return new Map(rows.map((r) => [r.id, r.kind]));
}
```

- [ ] **Step 4: Attach `kind` + `content` in the chat route**

In `apps/web/app/api/chat/route.ts`:

Add `getDocumentKinds` to the queries import and `snippet` to the citations import:

```ts
import { createConversation, appendMessage, setConversationTitle, getConversationForUser, getMemoryState, getDocumentKinds } from "@gr/db/queries";
import { encodeCitations, snippet } from "../../../lib/citations.js";
```

Replace the `citations` construction (the `const citations = hits.map(...)` block) with:

```ts
  const kinds = await getDocumentKinds(db, [...new Set(hits.map((h) => h.documentId))]);
  const citations = hits.map((h) => ({
    chunkId: h.chunkId, documentId: h.documentId,
    title: h.document.title, sourceUrl: h.document.sourceUrl,
    kind: kinds.get(h.documentId) ?? "text", content: snippet(h.content),
  }));
```

(If `encodeCitations` was previously imported alone, the combined import above replaces that line.)

- [ ] **Step 5: Assert the richer payload in the route test**

In `apps/web/test/chat-route.test.ts`, in the "streams a grounded answer and persists the exchange" test, after the existing `expect(cites[0]?.documentId).toBe("d1");` add:

```ts
    expect(cites[0]?.content).toContain("Tawaraya"); // capped chunk snippet
    expect(cites[0]?.kind).toBe("text");             // fallback: no document row for the mock chunk
```

- [ ] **Step 6: Run all three suites**

Run: `pnpm exec vitest run apps/web/lib/citations.test.ts && bash scripts/test.sh packages/db/src/queries.tags.test.ts && bash scripts/test.sh apps/web/test/chat-route.test.ts`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/citations.ts apps/web/lib/citations.test.ts packages/db/src/queries.ts packages/db/src/queries.tags.test.ts apps/web/app/api/chat/route.ts apps/web/test/chat-route.test.ts
git commit -m "feat(web): ship citation kind + chunk snippet in the payload

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `rehype-citations` plugin

**Files:**
- Create: `apps/web/lib/rehype-citations.ts`
- Test: `apps/web/lib/rehype-citations.test.ts`

**Interfaces:**
- Produces: `rehypeCitations()` — a rehype (hast) transform replacing `[n]` text with
  `<cite data-cite="n">` elements.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/rehype-citations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { rehypeCitations } from "./rehype-citations.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (tree: any) => { rehypeCitations()(tree); return tree; };

describe("rehypeCitations", () => {
  it("splits [n] text into cite elements with data-cite", () => {
    const tree = { type: "root", children: [{ type: "element", tagName: "p", children: [{ type: "text", value: "Stay at Tawaraya [1] or [2]." }] }] };
    const p = run(tree).children[0];
    expect(p.children.map((c: { tagName?: string; type: string }) => c.tagName ?? c.type)).toEqual(["text", "cite", "text", "cite", "text"]);
    expect(p.children[1].properties["data-cite"]).toBe("1");
    expect(p.children[3].properties["data-cite"]).toBe("2");
  });
  it("leaves text without markers untouched and recurses into nested elements", () => {
    const tree = { type: "root", children: [{ type: "element", tagName: "p", children: [
      { type: "element", tagName: "strong", children: [{ type: "text", value: "bold [1]" }] },
    ] }] };
    const strong = run(tree).children[0].children[0];
    expect(strong.children.map((c: { tagName?: string; type: string }) => c.tagName ?? c.type)).toEqual(["text", "cite"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run apps/web/lib/rehype-citations.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the plugin**

Create `apps/web/lib/rehype-citations.ts`:

```ts
interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** rehype transform: replace `[n]` text with `<cite data-cite="n">` elements so a custom
 *  react-markdown component can render an inline citation marker. No dependencies. */
export function rehypeCitations() {
  return (tree: HastNode) => walk(tree);
}

function walk(node: HastNode): void {
  if (!node.children) return;
  const out: HastNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value && /\[\d+\]/.test(child.value)) {
      for (const part of child.value.split(/(\[\d+\])/)) {
        if (!part) continue;
        const m = part.match(/^\[(\d+)\]$/);
        if (m) out.push({ type: "element", tagName: "cite", properties: { "data-cite": m[1] }, children: [] });
        else out.push({ type: "text", value: part });
      }
    } else {
      walk(child);
      out.push(child);
    }
  }
  node.children = out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run apps/web/lib/rehype-citations.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/rehype-citations.ts apps/web/lib/rehype-citations.test.ts
git commit -m "feat(web): rehype plugin turning [n] into <cite> citation elements

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Popover primitive + shared `KindIcon`

**Files:**
- Create: `apps/web/components/ui/popover.tsx`
- Create: `apps/web/components/kind-icon.tsx`
- Modify: `apps/web/components/library-list.tsx` (use the shared `KindIcon`)

**Interfaces:**
- Produces: `Popover`, `PopoverTrigger`, `PopoverContent` (base-ui popover wrappers); `KindIcon({ kind: string; className?: string })`.

- [ ] **Step 1: Create the Popover primitive**

Create `apps/web/components/ui/popover.tsx` (base-ui `@base-ui/react/popover`, mirroring `ui/sheet.tsx`
conventions — if a part's `.Props` type name differs, check `@base-ui/react/popover`'s exports, which
are `Root/Trigger/Portal/Positioner/Popup/Arrow/...`):

```tsx
"use client"

import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  sideOffset = 6,
  ...props
}: PopoverPrimitive.Popup.Props & { sideOffset?: number }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner sideOffset={sideOffset} className="z-50">
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "z-50 max-h-[60vh] w-72 max-w-[90vw] overflow-y-auto rounded-lg bg-popover p-3 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverContent }
```

- [ ] **Step 2: Extract `KindIcon`**

Create `apps/web/components/kind-icon.tsx`:

```tsx
import { FileText, Globe, Image as ImageIcon, File as FileIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** The icon representing a saved item's kind (web/pdf/image/text) — shared by the Library and citations. */
export function KindIcon({ kind, className }: { kind: string; className?: string }) {
  const cls = cn("size-4 shrink-0 text-muted-foreground", className);
  if (kind === "web") return <Globe className={cls} />;
  if (kind === "image") return <ImageIcon className={cls} />;
  if (kind === "pdf" || kind === "document") return <FileText className={cls} />;
  return <FileIcon className={cls} />;
}
```

- [ ] **Step 3: Point `library-list.tsx` at the shared `KindIcon`**

In `apps/web/components/library-list.tsx`:

Delete the local `KindIcon` function (the `function KindIcon(...) { ... }` block). Change the lucide
import (which currently imports `FileText, Globe, Image as ImageIcon, File as FileIcon`) to keep only
what remains used — `FileText` is still used by the empty state, the others are not:

```tsx
import { FileText } from "lucide-react";
```

Add the shared import (next to the other `@/components/...` imports):

```tsx
import { KindIcon } from "@/components/kind-icon";
```

(`<KindIcon kind={d.kind} />` call sites are unchanged — `className` is optional.)

- [ ] **Step 4: Verify library still renders + typecheck**

Run: `pnpm --filter @gr/web exec vitest run components/library-list.test.tsx && pnpm --filter @gr/web typecheck`
Expected: PASS (3 tests) + typecheck clean (the `DocTable`/`DocCards` still show kind icons via the shared component).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ui/popover.tsx apps/web/components/kind-icon.tsx apps/web/components/library-list.tsx
git commit -m "feat(web): Popover primitive + shared KindIcon

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `Citation` marker component

**Files:**
- Create: `apps/web/components/citation.tsx`
- Test: `apps/web/components/citation.test.tsx`

**Interfaces:**
- Consumes: `KindIcon` (Task 3), `Popover`/`PopoverTrigger`/`PopoverContent` (Task 3), `safeHref` (exported from `@/components/chat`).
- Produces: `interface CitationData { title: string | null; sourceUrl: string | null; kind: string; content: string }`; `makeCitation(citations: CitationData[])` → a react-markdown component for `<cite>`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/citation.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { makeCitation } from "./citation.js";

const cites = [{ title: "Kyoto", sourceUrl: "https://x", kind: "web", content: "Tawaraya is a ryokan." }];
const Cite = makeCitation(cites);

describe("Citation", () => {
  it("renders a source icon and opens a popover with the title + chunk", async () => {
    render(<Cite node={{ properties: { "data-cite": "1" } }} />);
    fireEvent.click(screen.getByRole("button", { name: /Source: Kyoto/ }));
    expect(await screen.findByText("Kyoto")).toBeTruthy();
    expect(screen.getByText("Tawaraya is a ryokan.")).toBeTruthy();
  });
  it("renders [n] text for an out-of-range citation", () => {
    render(<Cite node={{ properties: { "data-cite": "9" } }} />);
    expect(screen.getByText("[9]")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gr/web exec vitest run components/citation.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the component**

Create `apps/web/components/citation.tsx`:

```tsx
"use client";
import type { ComponentPropsWithoutRef } from "react";
import { KindIcon } from "@/components/kind-icon";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { safeHref } from "@/components/chat";

export interface CitationData {
  title: string | null; sourceUrl: string | null; kind: string; content: string;
}

type CiteProps = ComponentPropsWithoutRef<"cite"> & { node?: { properties?: Record<string, unknown> } };

/** Build the react-markdown component for `<cite data-cite="n">`, closed over this reply's citations. */
export function makeCitation(citations: CitationData[]) {
  return function Cite(props: CiteProps) {
    const raw = props.node?.properties?.["data-cite"] ?? (props as Record<string, unknown>)["data-cite"];
    const n = Number(raw);
    const c = Number.isFinite(n) ? citations[n - 1] : undefined;
    if (!c) return <>{`[${raw}]`}</>;
    const href = safeHref(c.sourceUrl);
    return (
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={`Source: ${c.title ?? "saved item"}`}
              className="mx-0.5 inline-flex -translate-y-px align-middle text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-200"
            >
              <KindIcon kind={c.kind} className="size-3.5 text-current" />
            </button>
          }
        />
        <PopoverContent>
          <p className="font-medium text-foreground">{c.title ?? "Saved item"}</p>
          {c.content ? <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{c.content}</p> : null}
          {href !== "#" ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs underline">Open source ↗</a>
          ) : null}
        </PopoverContent>
      </Popover>
    );
  };
}
```

(`citation.tsx` imports `safeHref` from `chat.tsx` and `chat.tsx` will import `makeCitation` from here —
a cycle that is safe because both are hoisted `function` declarations / type-only, used at render time,
not at module init.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gr/web exec vitest run components/citation.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/citation.tsx apps/web/components/citation.test.tsx
git commit -m "feat(web): inline citation marker with source popover

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Wire citations into the chat reply; remove the chips

**Files:**
- Modify: `apps/web/components/chat.tsx` (Markdown uses the plugin + `Citation`; delete chips; `send()` keeps full citations)
- Modify: `apps/web/components/chat.test.tsx` (replace chip assertions with inline-icon assertions)
- Modify: `apps/web/lib/citations.ts` (remove `citedOnly`)
- Modify: `apps/web/lib/citations.test.ts` (remove the `citedOnly` test)

**Interfaces:**
- Consumes: `rehypeCitations` (Task 2), `makeCitation`/`CitationData` (Task 4), `parseCitations` (Task 1).

- [ ] **Step 1: Rewrite the chat.test citation expectations**

In `apps/web/components/chat.test.tsx`: the reply now renders an inline icon (not `[1]` text or a chip).
Replace the two chip tests with these (keep the `safeHref` describe block and the markdown-bold test as
they are). The Transcript `Citation` type now needs `kind` + `content`:

```tsx
  it("renders an assistant reply with an inline citation icon and no chips", () => {
    render(<Transcript messages={[
      { id: "2", role: "assistant", content: "Tawaraya [1].", citations: [
        { title: "Kyoto", sourceUrl: "https://x", kind: "web", content: "Tawaraya is a ryokan." },
      ] },
    ]} />);
    expect(screen.getByText(/Tawaraya/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Source: Kyoto/ })).toBeTruthy();
    // the inline [1] text is gone
    expect(screen.queryByText("Tawaraya [1].")).toBeNull();
  });
```

(Delete the previous `"renders user and assistant turns with a citation chip"` and
`"renders a non-link chip ..."` tests — chips no longer exist. Keep the `safeHref` tests and the
markdown-bold test.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gr/web exec vitest run components/chat.test.tsx`
Expected: FAIL — no button with `Source: Kyoto` (Markdown doesn't render citation icons yet) and the
`Citation` type doesn't have `kind`/`content`.

- [ ] **Step 3: Update `chat.tsx` — Markdown, Transcript, send, types**

In `apps/web/components/chat.tsx`:

1. Add imports (near the react-markdown import):

```tsx
import { useMemo } from "react";
import rehypeGfm from "remark-gfm"; // (already imported as remarkGfm — leave as is)
import { rehypeCitations } from "@/lib/rehype-citations";
import { makeCitation, type CitationData } from "@/components/citation";
```

(Only add `useMemo`, `rehypeCitations`, and `makeCitation`/`CitationData`; `remarkGfm` is already
imported. Merge `useMemo` into the existing `react` import: `import { useState, useMemo, type FormEvent } from "react";`.)

2. Change the `Citation` interface to carry the icon + chunk:

```tsx
export interface Citation { title: string | null; sourceUrl: string | null; kind: string; content: string; }
```

3. Replace the `Markdown` component to accept `citations` and wire the plugin + component:

```tsx
function Markdown({ children, citations }: { children: string; citations?: CitationData[] }) {
  const components = useMemo(() => ({ cite: makeCitation(citations ?? []) }), [citations]);
  return (
    <div className="space-y-2 text-left [&_a]:underline [&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] dark:[&_code]:bg-white/15 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-0 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-black/10 [&_pre]:p-2 dark:[&_pre]:bg-white/10 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeCitations]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
```

4. In `Transcript`, pass citations into `Markdown` and delete the chip block. The reply cell becomes:

```tsx
              <div className={cn(
                "inline-block max-w-full rounded-lg px-3 py-2 text-left",
                isUser ? "bg-muted text-foreground" : "bg-amber-100 text-amber-950 dark:bg-amber-950/60 dark:text-amber-50",
              )}>
                {isUser ? m.content : m.content === "" ? <TypingDots /> : <Markdown citations={m.citations}>{m.content}</Markdown>}
              </div>
```

Delete the entire `{m.citations?.length ? ( <div className="mt-1 flex flex-wrap gap-1"> ... </div> ) : null}` block that followed it. Also delete the now-unused `CITE` constant and the `Badge` import if nothing else uses them (the chips were their only use).

5. In `send()`, keep the full citations (drop `citedOnly`):

Change the dynamic import + mapping + set:

```ts
      const { parseCitations } = await import("../lib/citations.js");
      const allCitations = parseCitations(res.headers.get("x-citations"))
        .map((c) => ({ title: c.title, sourceUrl: c.sourceUrl, kind: c.kind, content: c.content }));
```

and the finalize line:

```ts
      setAssistant({ citations: allCitations });
```

(Remove the `// Show only the sources...` comment; `acc` is still used for the streamed content and the empty-stream ERR check.)

- [ ] **Step 4: Remove `citedOnly`**

In `apps/web/lib/citations.ts`, delete the `citedOnly` function. In `apps/web/lib/citations.test.ts`,
delete the `citedOnly` test(s) (keep `parseCitations` + the new `snippet` tests).

- [ ] **Step 5: Run the component test + full check**

Run: `pnpm --filter @gr/web exec vitest run components/chat.test.tsx`
Expected: PASS.

Then: `pnpm --filter @gr/web typecheck && bash scripts/test.sh`
Expected: typecheck clean; whole node + component suite green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/chat.tsx apps/web/components/chat.test.tsx apps/web/lib/citations.ts apps/web/lib/citations.test.ts
git commit -m "feat(web): inline citation icons in replies; remove citation chips

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Plan Self-Review

**Spec coverage:**
- `Citation` + `kind`/`content`, `snippet` cap, `getDocumentKinds`, route wiring → Task 1. ✓
- `[n]` → citation element (rehype) → Task 2. ✓
- Popover primitive + shared `KindIcon` → Task 3. ✓
- Citation marker (icon + popover, title + chunk + optional link, out-of-range fallback) → Task 4. ✓
- Markdown wiring, chips removed, full citations, `citedOnly` removed → Task 5. ✓
- Tests: snippet, getDocumentKinds, route payload (T1); rehype plugin (T2); citation component (T4); chat integration (T5). ✓
- No new deps; base-ui render props; XSS via plain-text + `safeHref`; out-of-range fallback. ✓

**Placeholder scan:** No TBD/TODO/"handle errors"/"similar to" — complete code in every step. ✓

**Type consistency:** `Citation`/`CitationData` share `{ title, sourceUrl, kind, content }`; `snippet(text, max?)`, `getDocumentKinds(db, ids) → Map`, `makeCitation(citations)`, `rehypeCitations()` names match between definition and use across tasks. The `Cite` component reads `data-cite` from `node.properties` (set by Task 2) with a prop fallback. `citedOnly` removal (T5) is the only place chat.tsx used it, so no dangling references. ✓

**Deviation from spec (noted):** the spec described a *remark* plugin using `data.hName`; this plan uses a *rehype* plugin that builds the `<cite>` hast element directly — deterministic and library-agnostic, same observable behavior. Flag for the reviewer.
