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
