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
