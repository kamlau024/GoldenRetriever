# GoldenRetriever UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `apps/web` into a polished, professional, warm-gold UI (light + dark) on the already-installed shadcn design system, with tabbed content input and a proper data-table library.

**Architecture:** Adopt shadcn tokens/components everywhere. Replace the grayscale palette in `globals.css` with a warm-gold/stone theme for `:root` + `.dark`, add Geist Sans, wire `next-themes`. Rebuild nav, add-content (Tabs), and library (Table+Badge); restyle Chat/Search to match. No API/backend changes.

**Tech Stack:** Next.js 15 App Router, Tailwind v4, shadcn ("base-nova" on `@base-ui/react`), next-themes, geist, lucide-react, Vitest + Testing Library (jsdom).

## Global Constraints

- **`apps/web` only** — no changes to API routes, ingestion, auth, or data model.
- **Imports use the `@/` alias** (→ `apps/web` root): `@/components/ui/<x>`, `@/lib/utils`, `@/components/<x>`. `cn` comes from `@/lib/utils`.
- **Add shadcn components via the local CLI:** `pnpm --filter @gr/web exec shadcn add <names> --yes` (style is "base-nova"; do not hand-write `components/ui/*`).
- **Theme** lives in `apps/web/app/globals.css` as oklch CSS variables under `:root` (light) and `.dark`. Warm-gold primary, stone neutrals. Keep every `--chart-*` and `--sidebar-*` variable (referenced by `@theme inline`).
- **Status pill colors** (via `lib/status.ts`): ready→emerald, processing→amber, failed→red, queued/other→slate; each with a `dark:` variant.
- **Dark mode** via `next-themes` (`attribute="class"`; the `.dark` custom-variant is already in `globals.css`).
- **Font:** Geist Sans via the `geist` package, exposed as `--font-sans`.
- **Component tests** (jsdom) run with `pnpm --filter @gr/web exec vitest run <path>`; full suite (node + component) via `bash scripts/test.sh`. Mock `next/navigation`, `next-themes`, and `sonner` in tests as needed.
- **Commit after each task**, trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- **Create:** `components/theme-provider.tsx`, `components/theme-toggle.tsx`, `components/logo.tsx`,
  `components/nav-link.tsx`, `lib/status.ts`, `app/icon.svg`, and CLI-generated
  `components/ui/{tabs,table,badge,label,sonner,dropdown-menu,separator,skeleton,alert-dialog}.tsx`.
- **Modify:** `app/globals.css`, `app/layout.tsx`, `app/(app)/layout.tsx`,
  `components/add-content.tsx`, `components/library-list.tsx`, `components/chat.tsx`,
  `components/search.tsx`, `package.json`.

---

### Task 1: Design-system foundation (deps, components, theme, font, providers)

**Files:**
- Modify: `apps/web/package.json`, `apps/web/app/globals.css`, `apps/web/app/layout.tsx`
- Create: `apps/web/components/theme-provider.tsx`, `apps/web/components/theme-toggle.tsx`
- CLI-create: `apps/web/components/ui/{tabs,table,badge,label,sonner,dropdown-menu,separator,skeleton,alert-dialog}.tsx`
- Test: `apps/web/components/theme-toggle.test.tsx`

**Interfaces:**
- Produces: `<ThemeProvider>` (wraps next-themes), `<ThemeToggle/>` (button toggling light/dark),
  the warm-gold theme tokens, `--font-sans` = Geist, and the shadcn `ui/*` components used by later tasks.

- [ ] **Step 1: Install dependencies**

Run:
```bash
pnpm --filter @gr/web add next-themes geist
```

- [ ] **Step 2: Add shadcn components**

Run:
```bash
pnpm --filter @gr/web exec shadcn add tabs table badge label sonner dropdown-menu separator skeleton alert-dialog --yes
```
Expected: new files under `apps/web/components/ui/`. If a prompt appears, accept defaults.

- [ ] **Step 3: Replace the palette in `apps/web/app/globals.css`**

Replace the entire `:root { … }` block with:
```css
:root {
    --background: oklch(0.985 0.006 85);
    --foreground: oklch(0.24 0.015 65);
    --card: oklch(1 0 0);
    --card-foreground: oklch(0.24 0.015 65);
    --popover: oklch(1 0 0);
    --popover-foreground: oklch(0.24 0.015 65);
    --primary: oklch(0.66 0.13 72);
    --primary-foreground: oklch(0.99 0.01 90);
    --secondary: oklch(0.96 0.01 82);
    --secondary-foreground: oklch(0.30 0.02 65);
    --muted: oklch(0.965 0.008 82);
    --muted-foreground: oklch(0.52 0.015 68);
    --accent: oklch(0.95 0.03 85);
    --accent-foreground: oklch(0.30 0.03 65);
    --destructive: oklch(0.58 0.20 25);
    --border: oklch(0.91 0.008 82);
    --input: oklch(0.91 0.008 82);
    --ring: oklch(0.66 0.13 72);
    --chart-1: oklch(0.66 0.13 72);
    --chart-2: oklch(0.55 0.10 55);
    --chart-3: oklch(0.45 0.07 60);
    --chart-4: oklch(0.72 0.11 90);
    --chart-5: oklch(0.60 0.09 45);
    --radius: 0.625rem;
    --font-sans: var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, sans-serif;
    --sidebar: oklch(0.985 0.006 85);
    --sidebar-foreground: oklch(0.24 0.015 65);
    --sidebar-primary: oklch(0.66 0.13 72);
    --sidebar-primary-foreground: oklch(0.99 0.01 90);
    --sidebar-accent: oklch(0.95 0.03 85);
    --sidebar-accent-foreground: oklch(0.30 0.03 65);
    --sidebar-border: oklch(0.91 0.008 82);
    --sidebar-ring: oklch(0.66 0.13 72);
}
```

Replace the entire `.dark { … }` block with:
```css
.dark {
    --background: oklch(0.21 0.012 65);
    --foreground: oklch(0.96 0.006 88);
    --card: oklch(0.25 0.012 65);
    --card-foreground: oklch(0.96 0.006 88);
    --popover: oklch(0.25 0.012 65);
    --popover-foreground: oklch(0.96 0.006 88);
    --primary: oklch(0.79 0.13 78);
    --primary-foreground: oklch(0.24 0.03 65);
    --secondary: oklch(0.29 0.012 65);
    --secondary-foreground: oklch(0.96 0.006 88);
    --muted: oklch(0.29 0.012 65);
    --muted-foreground: oklch(0.72 0.012 80);
    --accent: oklch(0.32 0.03 75);
    --accent-foreground: oklch(0.96 0.006 88);
    --destructive: oklch(0.70 0.19 22);
    --border: oklch(1 0 0 / 10%);
    --input: oklch(1 0 0 / 14%);
    --ring: oklch(0.79 0.13 78);
    --chart-1: oklch(0.79 0.13 78);
    --chart-2: oklch(0.65 0.10 55);
    --chart-3: oklch(0.72 0.11 90);
    --chart-4: oklch(0.55 0.09 45);
    --chart-5: oklch(0.60 0.08 60);
    --sidebar: oklch(0.21 0.012 65);
    --sidebar-foreground: oklch(0.96 0.006 88);
    --sidebar-primary: oklch(0.79 0.13 78);
    --sidebar-primary-foreground: oklch(0.24 0.03 65);
    --sidebar-accent: oklch(0.32 0.03 75);
    --sidebar-accent-foreground: oklch(0.96 0.006 88);
    --sidebar-border: oklch(1 0 0 / 10%);
    --sidebar-ring: oklch(0.79 0.13 78);
}
```

- [ ] **Step 4: Create `apps/web/components/theme-provider.tsx`**

```tsx
"use client";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
```

- [ ] **Step 5: Write the failing test `apps/web/components/theme-toggle.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const setTheme = vi.fn();
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme }) }));
import { ThemeToggle } from "./theme-toggle.js";

describe("ThemeToggle", () => {
  it("switches to dark when currently light", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: /theme/i }));
    expect(setTheme).toHaveBeenCalledWith("dark");
  });
});
```

- [ ] **Step 6: Run it (fails — no component)**

Run: `pnpm --filter @gr/web exec vitest run components/theme-toggle.test.tsx`
Expected: FAIL — `Cannot find module './theme-toggle.js'`.

- [ ] **Step 7: Create `apps/web/components/theme-toggle.tsx`**

```tsx
"use client";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <Button variant="ghost" aria-label="Toggle theme" className="size-9 p-0"
      onClick={() => setTheme(isDark ? "light" : "dark")}>
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
```

- [ ] **Step 8: Wire `apps/web/app/layout.tsx`**

Replace its contents with:
```tsx
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { GeistSans } from "geist/font/sans";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata = { title: "GoldenRetriever" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={GeistSans.variable} suppressHydrationWarning>
        <body>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            {children}
            <Toaster richColors position="top-center" />
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
```

- [ ] **Step 9: Run the test + typecheck**

Run: `pnpm --filter @gr/web exec vitest run components/theme-toggle.test.tsx && pnpm --filter @gr/web typecheck`
Expected: test PASS; typecheck exits 0.

- [ ] **Step 10: Commit**

```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml apps/web/app/globals.css apps/web/app/layout.tsx apps/web/components/theme-provider.tsx apps/web/components/theme-toggle.tsx apps/web/components/theme-toggle.test.tsx apps/web/components/ui
git -C "$(git rev-parse --show-toplevel)" add pnpm-lock.yaml 2>/dev/null || true
git commit -m "feat(web): warm-gold shadcn theme + Geist font + dark mode foundation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Logo mark + favicon

**Files:**
- Create: `apps/web/components/logo.tsx`, `apps/web/app/icon.svg`
- Test: `apps/web/components/logo.test.tsx`

**Interfaces:**
- Produces: `<Logo />` (mark + "GoldenRetriever" wordmark) and `<LogoMark className?/>` (mark only).

- [ ] **Step 1: Write the failing test `apps/web/components/logo.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Logo, LogoMark } from "./logo.js";

describe("Logo", () => {
  it("renders the wordmark and an svg mark", () => {
    const { container } = render(<Logo />);
    expect(screen.getByText("GoldenRetriever")).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();
  });
  it("LogoMark renders just the svg", () => {
    const { container } = render(<LogoMark />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `pnpm --filter @gr/web exec vitest run components/logo.test.tsx`
Expected: FAIL — `Cannot find module './logo.js'`.

- [ ] **Step 3: Create `apps/web/components/logo.tsx`**

```tsx
import { cn } from "@/lib/utils";

/** Minimal geometric golden-retriever head mark. Uses currentColor so it themes. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label="GoldenRetriever" className={cn("size-7 text-primary", className)}>
      <path fill="currentColor" d="M16 4c-2.2 0-4 1.6-4.4 3.7C9.1 7.9 7 9.9 7 12.6c0 1 .3 1.9.8 2.7C6.7 16.5 6 18 6 19.7 6 23.7 10.5 27 16 27s10-3.3 10-7.3c0-1.7-.7-3.2-1.8-4.4.5-.8.8-1.7.8-2.7 0-2.7-2.1-4.7-4.6-4.9C19.9 5.6 18.2 4 16 4Z" />
      <circle cx="12.5" cy="17" r="1.4" fill="var(--background)" />
      <circle cx="19.5" cy="17" r="1.4" fill="var(--background)" />
      <path d="M14 21c.6.7 3.4.7 4 0" stroke="var(--background)" strokeWidth="1.3" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark />
      <span className="text-foreground">GoldenRetriever</span>
    </span>
  );
}
```

- [ ] **Step 4: Create `apps/web/app/icon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="7" fill="#1c1917"/>
  <path fill="#e0a82e" d="M16 5c-2.1 0-3.8 1.5-4.2 3.5C9.4 8.7 7.5 10.6 7.5 13c0 .9.3 1.8.7 2.5C7.1 16.7 6.5 18 6.5 19.6 6.5 23.3 10.8 26.4 16 26.4s9.5-3.1 9.5-6.8c0-1.6-.6-2.9-1.7-4.1.4-.7.7-1.6.7-2.5 0-2.4-1.9-4.3-4.3-4.5C19.8 6.5 18.1 5 16 5Z"/>
  <circle cx="12.7" cy="17" r="1.3" fill="#1c1917"/>
  <circle cx="19.3" cy="17" r="1.3" fill="#1c1917"/>
</svg>
```

- [ ] **Step 5: Run the test (passes)**

Run: `pnpm --filter @gr/web exec vitest run components/logo.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/logo.tsx apps/web/components/logo.test.tsx apps/web/app/icon.svg
git commit -m "feat(web): golden-retriever logo mark + favicon

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Navigation redesign

**Files:**
- Create: `apps/web/components/nav-link.tsx`
- Modify: `apps/web/app/(app)/layout.tsx`
- Test: `apps/web/components/nav-link.test.tsx`

**Interfaces:**
- Consumes: `<Logo>` (Task 2), `<ThemeToggle>` (Task 1).
- Produces: `<NavLink href label>` with an active state driven by `usePathname`.

- [ ] **Step 1: Write the failing test `apps/web/components/nav-link.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/chat" }));
import { NavLink } from "./nav-link.js";

describe("NavLink", () => {
  it("marks the matching route active", () => {
    render(<><NavLink href="/chat" label="Chat" /><NavLink href="/search" label="Search" /></>);
    expect(screen.getByText("Chat").getAttribute("data-active")).toBe("true");
    expect(screen.getByText("Search").getAttribute("data-active")).toBe("false");
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `pnpm --filter @gr/web exec vitest run components/nav-link.test.tsx`
Expected: FAIL — `Cannot find module './nav-link.js'`.

- [ ] **Step 3: Create `apps/web/components/nav-link.tsx`**

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link href={href} data-active={active}
      className={cn(
        "text-sm font-medium transition-colors hover:text-foreground",
        active ? "text-foreground" : "text-muted-foreground",
      )}>
      {label}
    </Link>
  );
}
```

- [ ] **Step 4: Run the test (passes)**

Run: `pnpm --filter @gr/web exec vitest run components/nav-link.test.tsx`
Expected: PASS.

- [ ] **Step 5: Replace `apps/web/app/(app)/layout.tsx`**

```tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { Logo } from "@/components/logo";
import { NavLink } from "@/components/nav-link";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" aria-label="GoldenRetriever home"><Logo /></Link>
          <nav className="flex items-center gap-5">
            <NavLink href="/" label="Library" />
            <NavLink href="/chat" label="Chat" />
            <NavLink href="/search" label="Search" />
            <NavLink href="/settings" label="Settings" />
          </nav>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <UserButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @gr/web typecheck` (Expected: exit 0)
```bash
git add apps/web/components/nav-link.tsx apps/web/components/nav-link.test.tsx "apps/web/app/(app)/layout.tsx"
git commit -m "feat(web): redesigned top nav with logo, active links, theme toggle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Status pill helper

**Files:**
- Create: `apps/web/lib/status.ts`
- Test: `apps/web/lib/status.test.ts`

**Interfaces:**
- Produces: `statusLabel(status: string): string` (uppercased display label) and
  `statusBadgeClass(status: string): string` (Tailwind classes for a pill, with `dark:` variants).

- [ ] **Step 1: Write the failing test `apps/web/lib/status.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { statusLabel, statusBadgeClass } from "./status.js";

describe("status helpers", () => {
  it("labels are uppercased", () => {
    expect(statusLabel("ready")).toBe("READY");
    expect(statusLabel("failed")).toBe("FAILED");
  });
  it("maps each status to distinct classes", () => {
    expect(statusBadgeClass("ready")).toContain("emerald");
    expect(statusBadgeClass("processing")).toContain("amber");
    expect(statusBadgeClass("failed")).toContain("red");
    expect(statusBadgeClass("queued")).toContain("slate");
    expect(statusBadgeClass("anything-else")).toContain("slate");
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `bash scripts/test.sh apps/web/lib/status.test.ts`
Expected: FAIL — `Cannot find module './status.js'`.

- [ ] **Step 3: Create `apps/web/lib/status.ts`**

```ts
export function statusLabel(status: string): string {
  return status.toUpperCase();
}

const CLASSES: Record<string, string> = {
  ready: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  processing: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  queued: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

/** Tailwind classes for a status pill. Unknown statuses fall back to the neutral (slate) style. */
export function statusBadgeClass(status: string): string {
  return CLASSES[status] ?? CLASSES.queued;
}
```

- [ ] **Step 4: Run the test (passes)**

Run: `bash scripts/test.sh apps/web/lib/status.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/status.ts apps/web/lib/status.test.ts
git commit -m "feat(web): status pill helper (label + themed classes)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Add-content tabs

**Files:**
- Modify: `apps/web/components/add-content.tsx`
- Test: `apps/web/components/add-content.test.tsx`

**Interfaces:**
- Consumes: `ui/{tabs,card,button,input,textarea,label}` (Task 1), `sonner`'s `toast`.
- Produces: `<AddContent kbId />` with Text/URL/File tabs.

- [ ] **Step 1: Write the failing test `apps/web/components/add-content.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast }));
import { AddContent } from "./add-content.js";

beforeEach(() => { vi.restoreAllMocks(); refresh.mockClear(); toast.success.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

describe("AddContent", () => {
  it("shows the three tabs", () => {
    render(<AddContent kbId="kb1" />);
    expect(screen.getByRole("tab", { name: /text/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /url/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /file/i })).toBeTruthy();
  });

  it("saves pasted text and refreshes with a success toast", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<AddContent kbId="kb1" />);
    fireEvent.change(screen.getByPlaceholderText(/paste/i), { target: { value: "Hello Kyoto" } });
    fireEvent.click(screen.getByRole("button", { name: /save text/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/ingest", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it (fails — old component has no tabs)**

Run: `pnpm --filter @gr/web exec vitest run components/add-content.test.tsx`
Expected: FAIL — no `tab` role / no success toast.

- [ ] **Step 3: Replace `apps/web/components/add-content.tsx`**

```tsx
"use client";
import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export function AddContent({ kbId }: { kbId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function done(res: Response) {
    setBusy(false);
    if (res.ok) {
      setText(""); setUrl("");
      toast.success("Saved — processing…");
      router.refresh();
    } else {
      toast.error("Couldn't save that. Please try again.");
    }
  }

  async function submitJson(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await done(await fetch("/api/ingest", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kbId, ...body }),
      }));
    } catch { setBusy(false); toast.error("Network error."); }
  }

  async function uploadFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const fd = new FormData(); fd.set("kbId", kbId); fd.set("file", file);
    try { await done(await fetch("/api/upload", { method: "POST", body: fd })); }
    catch { setBusy(false); toast.error("Network error."); }
    e.target.value = "";
  }

  return (
    <Card>
      <CardHeader><CardTitle>Add to your library</CardTitle></CardHeader>
      <CardContent>
        <Tabs defaultValue="text">
          <TabsList>
            <TabsTrigger value="text">Text</TabsTrigger>
            <TabsTrigger value="url">URL</TabsTrigger>
            <TabsTrigger value="file">File</TabsTrigger>
          </TabsList>

          <TabsContent value="text" className="space-y-3">
            <Textarea rows={4} placeholder="Paste text to save…" value={text}
              onChange={(e) => setText(e.target.value)} />
            <Button disabled={busy || !text.trim()} onClick={() => submitJson({ text })}>Save text</Button>
          </TabsContent>

          <TabsContent value="url" className="space-y-3">
            <Input type="url" placeholder="https://… (saves the page)" value={url}
              onChange={(e) => setUrl(e.target.value)} />
            <Button disabled={busy || !url.trim()} onClick={() => submitJson({ url })}>Save page</Button>
          </TabsContent>

          <TabsContent value="file" className="space-y-3">
            <Label className="text-sm text-muted-foreground">PDF, Word, PowerPoint, Excel, or an image</Label>
            <Input type="file" disabled={busy} onChange={uploadFile}
              accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg" />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run the test (passes)**

Run: `pnpm --filter @gr/web exec vitest run components/add-content.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/add-content.tsx apps/web/components/add-content.test.tsx
git commit -m "feat(web): tabbed add-content card (Text/URL/File) with toasts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Library data table

**Files:**
- Modify: `apps/web/components/library-list.tsx`
- Test: `apps/web/components/library-list.test.tsx`

**Interfaces:**
- Consumes: `ui/{table,badge,card,button,alert-dialog}` (Task 1), `statusLabel`/`statusBadgeClass` (Task 4), `safeHref` (existing, from `@/components/chat`).
- Produces: `<LibraryList docs />` rendering the existing `LibraryDoc` shape.

- [ ] **Step 1: Write the failing test `apps/web/components/library-list.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { LibraryList } from "./library-list.js";

const docs = [
  { id: "d1", title: "Kyoto guide", sourceUrl: "https://x.dev", kind: "web", status: "ready", capturedAt: new Date("2026-06-28T13:42:00Z") },
  { id: "d2", title: null, sourceUrl: null, kind: "text", status: "failed", capturedAt: new Date("2026-06-27T09:00:00Z") },
];

describe("LibraryList", () => {
  it("renders a table with status pills and timestamps", () => {
    render(<LibraryList docs={docs} />);
    expect(screen.getByText("Kyoto guide")).toBeTruthy();
    expect(screen.getByText("READY")).toBeTruthy();
    expect(screen.getByText("FAILED")).toBeTruthy();
    expect(screen.getByText("Untitled")).toBeTruthy();
    // a formatted year is shown for the Added column
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
  });

  it("shows an empty state when there are no docs", () => {
    render(<LibraryList docs={[]} />);
    expect(screen.getByText(/nothing saved yet/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it (fails — old component is a plain list)**

Run: `pnpm --filter @gr/web exec vitest run components/library-list.test.tsx`
Expected: FAIL — no "READY"/"FAILED" pill text, no formatted year.

- [ ] **Step 3: Replace `apps/web/components/library-list.tsx`**

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
import { statusBadgeClass, statusLabel } from "@/lib/status";
import { safeHref } from "@/components/chat";

export interface LibraryDoc {
  id: string; title: string | null; sourceUrl: string | null;
  kind: string; status: string; capturedAt: Date;
}

const fmt = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
});

function KindIcon({ kind }: { kind: string }) {
  const cls = "size-4 text-muted-foreground";
  if (kind === "web") return <Globe className={cls} />;
  if (kind === "image") return <ImageIcon className={cls} />;
  if (kind === "pdf" || kind === "document") return <FileText className={cls} />;
  return <FileIcon className={cls} />;
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
    <Card className="overflow-hidden p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead className="w-32">Status</TableHead>
            <TableHead className="w-48">Added</TableHead>
            <TableHead className="w-16 text-right">·</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {docs.map((d) => {
            const href = safeHref(d.sourceUrl);
            const label = d.title ?? "Untitled";
            return (
              <TableRow key={d.id}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    <KindIcon kind={d.kind} />
                    {href === "#" ? <span>{label}</span> : (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">{label}</a>
                    )}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge className={cn("border-transparent", statusBadgeClass(d.status))}>{statusLabel(d.status)}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{fmt.format(new Date(d.capturedAt))}</TableCell>
                <TableCell className="text-right">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" className="h-7 px-2 text-xs" disabled={busy === d.id}>Delete</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this document?</AlertDialogTitle>
                        <AlertDialogDescription>“{label}” will be removed from your library. This can't be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(d.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
```

- [ ] **Step 4: Run the test (passes)**

Run: `pnpm --filter @gr/web exec vitest run components/library-list.test.tsx`
Expected: PASS (2 tests). If the `AlertDialogTrigger asChild` prop is unsupported by the base-nova variant and typecheck flags it, drop `asChild` and wrap the `Button` as the trigger's child per the generated `alert-dialog.tsx` API.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @gr/web typecheck` (Expected: exit 0)
```bash
git add apps/web/components/library-list.tsx apps/web/components/library-list.test.tsx
git commit -m "feat(web): library data table with status pills + timestamps

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Chat + Search restyle (tokens, no logic changes)

**Files:**
- Modify: `apps/web/components/chat.tsx`, `apps/web/components/search.tsx`
- Test: re-run `apps/web/components/chat.test.tsx`, `apps/web/components/search.test.tsx`

**Interfaces:**
- Consumes: `ui/{card,input,button,badge}`, `@/lib/status` (optional). No exported API changes — `safeHref`, `Transcript`, `Chat`, `Search`, `Results` keep their current names/signatures (Task 6 imports `safeHref` from `@/components/chat`).

- [ ] **Step 1: Read both files**

Read `apps/web/components/chat.tsx` and `apps/web/components/search.tsx` fully before editing. Keep all exported names and the `safeHref` logic unchanged.

- [ ] **Step 2: Apply the token/component swaps (both files)**

Make these replacements wherever they appear, without changing behavior or exported signatures:
- `bg-neutral-100` → `bg-muted`; `bg-neutral-900 text-white` → use `<Button>` from `@/components/ui/button`.
- `text-neutral-500` / `text-neutral-600` → `text-muted-foreground`.
- `border-neutral-200` / `divide-neutral-200` → `border-border` / `divide-border`.
- `bg-amber-100` (citation chips) → keep the chip but use the shared `<Badge variant="secondary">` (or `bg-secondary text-secondary-foreground`) so chips match the theme.
- Replace raw `<input className="…border…">` with `<Input>` from `@/components/ui/input`, and raw `<button>` with `<Button>` (variant `default` for primary, `outline`/`ghost` otherwise). Keep `disabled`, `onClick`, and `type` props.
- Wrap each screen's root in `<Card className="p-4">` (import `Card` from `@/components/ui/card`) for visual consistency with Library.
- In `search.tsx`'s result list, render the result's document `status` (if present) using `<Badge className={statusBadgeClass(status)}>{statusLabel(status)}</Badge>` only if the result objects already include a status field; otherwise leave results as-is. Do not add new data fetching.

- [ ] **Step 3: Run the affected component tests**

Run: `pnpm --filter @gr/web exec vitest run components/chat.test.tsx components/search.test.tsx`
Expected: PASS. If a selector changed (e.g. a test queried a removed class), update the test to assert visible text/role instead of styling, keeping the behavioral assertions intact.

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm --filter @gr/web typecheck` (Expected: exit 0)
```bash
git add apps/web/components/chat.tsx apps/web/components/search.tsx apps/web/components/chat.test.tsx apps/web/components/search.test.tsx
git commit -m "style(web): restyle chat + search to shadcn tokens/components

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Full suite: `bash scripts/test.sh` — all node + component tests pass.
- [ ] Build: `pnpm --filter @gr/web build` — succeeds (catches RSC/client boundary + import errors the unit tests can't).
- [ ] Deploy: `vercel deploy --prod --yes` from the repo root; then a manual look: sign in, toggle dark mode, switch the three add-content tabs, confirm the library table shows status pills + timestamps, and that Chat/Search match.

## Self-Review

- **Spec coverage:** theme tokens light+dark (T1) ✓; Geist font (T1) ✓; dark toggle (T1) ✓; logo + favicon (T2) ✓; nav with active state + toggle (T3) ✓; status pills helper (T4) ✓; add-content Tabs + toasts + router.refresh (T5) ✓; library Table + Badge + timestamp + delete confirm (T6) ✓; chat/search consistency pass (T7) ✓; component tests for toggle/nav/status/tabs/table (T1,T3,T4,T5,T6) ✓.
- **Placeholders:** none — full code or exact CLI/commands in every step; the one conditional (T6 `asChild`, T7 status-in-results) names the exact fallback.
- **Type/name consistency:** `statusLabel`/`statusBadgeClass` (defined T4, used T6/T7); `LogoMark`/`Logo` (T2, used T3); `ThemeToggle` (T1, used T3); `NavLink` (T3); `safeHref` kept exported from `@/components/chat` (used T6) — preserved by the T7 constraint. `LibraryDoc` shape unchanged.
