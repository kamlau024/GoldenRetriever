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

const SOURCES: Record<string, string> = {
  selection: "Text",
  url_fetch: "URL",
  full_dom: "URL",
  upload: "File",
};

/** Human label for how a document was captured (its "source"). Unknown/future capture modes
 *  are title-cased so a newly-added type still renders something sensible (never blank). */
export function sourceLabel(captureMode: string): string {
  return (
    SOURCES[captureMode] ??
    (captureMode ? captureMode.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Other")
  );
}
