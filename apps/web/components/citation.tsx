"use client";
import type { ComponentPropsWithoutRef } from "react";
import { KindIcon } from "@/components/kind-icon";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { safeHref } from "@/components/chat";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface CitationData {
  title: string | null; sourceUrl: string | null; kind: string; content: string;
}

type CiteProps = ComponentPropsWithoutRef<"cite"> & { node?: { properties?: Record<string, unknown> } };

/** Render a citation's chunk snippet as markdown (bold, lists, headings, code). No nested citations —
 *  a citation popup must not contain citation markers. */
function CitationMarkdown({ children }: { children: string }) {
  return (
    <div className="mt-1 space-y-1 text-sm text-muted-foreground [&_a]:underline [&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] dark:[&_code]:bg-white/15 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-0 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-black/10 [&_pre]:p-2 dark:[&_pre]:bg-white/10 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

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
          {c.content ? <CitationMarkdown>{c.content}</CitationMarkdown> : null}
          {href !== "#" ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs underline">Open source ↗</a>
          ) : null}
        </PopoverContent>
      </Popover>
    );
  };
}
