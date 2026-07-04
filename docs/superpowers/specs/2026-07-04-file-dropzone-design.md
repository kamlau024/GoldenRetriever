# File Dropzone Design (drag-and-drop upload for File + Import tabs)

**Status:** Approved pending user review
**Date:** 2026-07-04

Replace the bare `<input type="file">` in both the **File** tab (document upload) and the **Import** tab (bookmark file) of the "Add to your library" card with a shared drag-and-drop uploader that replicates the sadmann7 shadcn file-uploader UX (dashed dropzone + file cards with preview/size/remove).

## Approach

One shared, presentational component surfaces the chosen `File[]` to its parent; each parent decides what to do (upload vs. parse). The component replicates the sadmann7 look/behavior using **native HTML5 drag events** — no `react-dropzone` dependency (its React 19 peer support is unreliable and the drag/drop we need is small). Same look, one fewer dependency.

## Component: `apps/web/components/ui/file-dropzone.tsx`

```ts
export interface FileDropzoneProps {
  value: File[];                              // files rendered as cards (controlled)
  onValueChange: (files: File[]) => void;     // list changed (add or remove)
  onAdd?: (added: File[]) => void;            // just-added files (post-validation) — for upload/parse side effects
  accept?: string;                            // <input accept> string, e.g. ".pdf,.docx" or ".html,.htm"
  maxSize?: number;                           // bytes; default 25 * 1024 * 1024 (25 MB)
  maxFileCount?: number;                      // default 1
  disabled?: boolean;
  uploading?: Set<string>;                    // file.name values currently uploading → indeterminate bar
  ariaLabel?: string;                         // aria-label for the hidden file input (default "Upload files")
  className?: string;
}
export function FileDropzone(props: FileDropzoneProps): JSX.Element;
```

**Dropzone area:** a dashed-border region ("⬆ Drag & drop, or click to browse" + a hint line) that highlights while a drag is over it. Drag state is tracked with a small enter/leave counter (ref) so child elements don't flicker it. Clicking the region (or pressing Enter/Space — it's a `role="button"`, `tabIndex=0`) opens a hidden `<input type="file">` (carrying `accept`, `multiple = maxFileCount > 1`, and `ariaLabel`). The region is hidden once `value.length >= maxFileCount`.

**Validation (on both drop and input change):**
- Reject files whose extension/MIME doesn't satisfy `accept` (helper `matchesAccept(file, accept)` — matches `.ext` entries and `type/subtype` incl. `type/*` wildcards; empty `accept` allows all).
- Reject files larger than `maxSize` (toast: `"<name> is too large (max <N> MB)"`).
- If adding would exceed `maxFileCount`, keep only up to the remaining slots and toast `"You can add up to <N> file(s)"`.
- Errors are surfaced via `sonner` `toast.error`; accepted files → `onValueChange(union)` and `onAdd(accepted)`.
- The dropzone region hides once `value.length >= maxFileCount`; to swap the file the user clicks a card's remove ✕ (which frees a slot and re-shows the region). This keeps single-slot (Import) and multi-slot (File) behavior identical — no special replace case.

**File card (per file in `value`):** an image thumbnail (via `URL.createObjectURL`, revoked on removal/unmount) when `file.type` starts with `image/`, else a lucide icon by type (`FileText`); the filename (truncated); the formatted size (`formatBytes`); an **indeterminate animated bar** when `uploading?.has(file.name)`; and a remove **✕** button (hidden while that file is uploading or `disabled`) that calls `onValueChange(value without file)`.

The component owns no upload/parse logic — it is pure UI + validation. Cards live in a `ScrollArea` (reused primitive).

## Consumers

### File tab (`apps/web/components/add-content.tsx`) — multiple

Replace the current `uploadFile` `<Input type="file">` with:
- State: `files: File[]`, `uploading: Set<string>`.
- `<FileDropzone value={files} onValueChange={setFiles} onAdd={uploadEach} accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg" maxSize={25*1024*1024} maxFileCount={10} uploading={uploading} ariaLabel="Upload files" />`
- `uploadEach(added)`: for each file, mark its name uploading, `POST /api/upload` (`FormData` `{ kbId, file }`); on `ok` → unmark + remove the file from `files` (card clears) + `toast.success("Saved — processing…")` + `router.refresh()`; on failure → unmark + `toast.error(...)` (card stays so the user can retry or remove).
- No change to `/api/upload` (still one file per request; the client loops).

### Import tab (`apps/web/components/bookmark-import.tsx`) — single

Replace the current `<Input type="file">`/`onFile` with:
- `<FileDropzone value={file ? [file] : []} onValueChange={onValueChange} onAdd={([f]) => f && loadFile(f)} accept=".html,.htm" maxFileCount={1} ariaLabel="Bookmarks file" />`
- `onValueChange(fs)`: `setFile(fs[0] ?? null)`; if empty, also clear the parsed `entries`/`selected`.
- `loadFile(f)`: `parseBookmarksHtml(await readText(f))` → set `entries`/`selected` (the existing folder-preview/select UI renders below, unchanged). Keep the existing `readText` FileReader helper.

## Testing

- **`apps/web/components/file-dropzone.test.tsx`** (jsdom): selecting a file via the input (`fireEvent.change`) calls `onAdd`/`onValueChange`; an oversize file is rejected with a `toast.error` and is not added; exceeding `maxFileCount` is rejected/truncated; the remove ✕ calls `onValueChange` without the file. `sonner` is mocked.
- **`apps/web/components/add-content.test.tsx`** (update): drive the File tab through the dropzone input; assert a dropped doc POSTs to `/api/upload`.
- **`apps/web/components/bookmark-import.test.tsx`** (update): the existing tests drive the file via `getByLabelText("Bookmarks file")` — the dropzone keeps that aria-label on its input, so the tests continue to work with minimal change (verify the preview still renders and Import still posts the selection).

## Out of scope

- Real byte-percent upload progress (indeterminate bar only; an `XMLHttpRequest`-based `%` is a noted follow-up).
- Image editing/cropping; folder drops (directory upload).
- Any change to `/api/upload` or `/api/import/bookmarks`.
- Pulling in the `react-dropzone` package (we replicate its UX natively).

## Global constraints

- base-ui primitives via `render={<X/>}` props (never Radix `asChild`); reuse `button.tsx`, `scroll-area.tsx`, `cn`, `sonner`, `lucide-react`.
- Native HTML5 drag-and-drop (`dragenter/over/leave/drop`, `preventDefault` on over) + a hidden `<input type="file">` for click/keyboard access. Keyboard-operable (`role="button"`, `tabIndex=0`, Enter/Space).
- Server remains the security boundary: `/api/upload` already enforces auth + KB membership + the 25 MB cap; the client `maxSize`/`accept` are UX only.
- Tailwind v4 utility classes; `@/` alias → `apps/web`.
