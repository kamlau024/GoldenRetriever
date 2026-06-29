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
