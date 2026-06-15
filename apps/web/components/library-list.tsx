export interface LibraryDoc {
  id: string; title: string | null; sourceUrl: string | null;
  kind: string; status: string; capturedAt: Date;
}

export function LibraryList({ docs }: { docs: LibraryDoc[] }) {
  if (docs.length === 0) {
    return <p className="text-neutral-500">Nothing saved yet — add a page to get started.</p>;
  }
  return (
    <ul className="divide-y divide-neutral-200">
      {docs.map((d) => (
        <li key={d.id} className="flex items-center justify-between py-3">
          <span className="font-medium">{d.title ?? d.sourceUrl ?? "Untitled"}</span>
          <span className="text-xs uppercase text-neutral-500">{d.status}</span>
        </li>
      ))}
    </ul>
  );
}
