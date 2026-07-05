"use client";
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { FileText, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FileDropzoneProps {
  value: File[];
  onValueChange: (files: File[]) => void;
  onAdd?: (added: File[]) => void;
  accept?: string;
  maxSize?: number;
  maxFileCount?: number;
  disabled?: boolean;
  uploading?: Set<string>;
  ariaLabel?: string;
  className?: string;
}

const MB = 1024 * 1024;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / MB).toFixed(1)} MB`;
}

/** True if `file` satisfies an <input accept> string (".pdf" extensions and "image/*" / "type/subtype" MIME). */
function matchesAccept(file: File, accept?: string): boolean {
  if (!accept) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).some((token) => {
    if (token.startsWith(".")) return name.endsWith(token);
    if (token.endsWith("/*")) return type.startsWith(token.slice(0, -1));
    return type === token;
  });
}

function FileCard({ file, uploading, onRemove }: { file: File; uploading: boolean; onRemove?: () => void }) {
  const isImage = file.type.startsWith("image/");
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage) return;
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, isImage]);
  return (
    <div className="flex items-center gap-2 rounded-md border p-2">
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt={file.name} className="size-9 shrink-0 rounded object-cover" />
      ) : (
        <span className="flex size-9 shrink-0 items-center justify-center rounded bg-muted"><FileText className="size-4 text-muted-foreground" /></span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{file.name}</p>
        <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
        {uploading && (
          <span className="mt-1 block h-1 w-full overflow-hidden rounded bg-muted" aria-label="Uploading">
            <span className="block h-full w-1/2 animate-pulse rounded bg-amber-600" />
          </span>
        )}
      </div>
      {!uploading && onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${file.name}`} className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function FileDropzone({
  value, onValueChange, onAdd, accept, maxSize = 25 * MB, maxFileCount = 1, disabled = false,
  uploading, ariaLabel = "Upload files", className,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  const dragCount = useRef(0);

  function addFiles(incoming: File[]) {
    if (disabled) return;
    const room = maxFileCount - value.length;
    if (room <= 0) return;
    const accepted: File[] = [];
    for (const f of incoming) {
      if (!matchesAccept(f, accept)) { toast.error(`${f.name}: unsupported file type`); continue; }
      if (f.size > maxSize) { toast.error(`${f.name} is too large (max ${Math.round(maxSize / MB)} MB)`); continue; }
      accepted.push(f);
    }
    if (accepted.length === 0) return;
    let take = accepted;
    if (accepted.length > room) { toast.error(`You can add up to ${maxFileCount} file${maxFileCount === 1 ? "" : "s"}`); take = accepted.slice(0, room); }
    onValueChange([...value, ...take]);
    onAdd?.(take);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragCount.current = 0; setActive(false);
    if (disabled) return;
    addFiles(Array.from(e.dataTransfer.files));
  }
  const onDragOver = (e: DragEvent) => e.preventDefault();
  const onDragEnter = (e: DragEvent) => { e.preventDefault(); dragCount.current++; setActive(true); };
  const onDragLeave = (e: DragEvent) => { e.preventDefault(); dragCount.current--; if (dragCount.current <= 0) setActive(false); };
  const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } };

  const full = value.length >= maxFileCount;

  return (
    <div className={cn("space-y-2", className)}>
      {!full && (
        <div
          role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled}
          onClick={() => !disabled && inputRef.current?.click()}
          onKeyDown={onKeyDown}
          onDrop={onDrop} onDragOver={onDragOver} onDragEnter={onDragEnter} onDragLeave={onDragLeave}
          className={cn(
            "flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-6 text-center outline-none transition-colors",
            active ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30" : "border-input hover:bg-muted/50",
            disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <Upload className="size-6 text-muted-foreground" />
          <span className="text-sm font-medium">Drag &amp; drop, or click to browse</span>
          <input
            ref={inputRef} type="file" className="sr-only" aria-label={ariaLabel}
            accept={accept} multiple={maxFileCount > 1} disabled={disabled}
            onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
          />
        </div>
      )}

      {value.length > 0 && (
        <div className="max-h-52 overflow-y-auto">
          <div className="space-y-1.5">
            {value.map((f) => (
              <FileCard
                key={`${f.name}-${f.size}-${f.lastModified}`}
                file={f}
                uploading={!!uploading?.has(f.name)}
                onRemove={disabled ? undefined : () => onValueChange(value.filter((x) => x !== f))}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
