"use client";

export interface LibraryDoc {
  id: string; title: string | null; sourceUrl: string | null;
  kind: string; status: string; capturedAt: Date;
}

export function LibraryList({ docs }: { docs: LibraryDoc[] }) {
  if (docs.length === 0) {
    return <p className="text-neutral-500">Nothing saved yet — add a page to get started.</p>;
  }
  async function remove(id: string) {
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    location.reload();
  }
  return (
    <ul className="divide-y divide-neutral-200">
      {docs.map((d) => (
        <li key={d.id} className="flex items-center justify-between py-3">
          <span className="font-medium">{d.title ?? d.sourceUrl ?? "Untitled"}</span>
          <span className="flex items-center gap-3">
            <span className="text-xs uppercase text-neutral-500">{d.status}</span>
            <button onClick={() => remove(d.id)} className="text-xs text-red-600 hover:underline">Delete</button>
          </span>
        </li>
      ))}
    </ul>
  );
}
