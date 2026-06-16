import { randomUUID } from "node:crypto";

/** Opaque-ref blob storage. `put` returns a ref to store on the document. */
export interface BlobStore {
  put(bytes: Uint8Array, contentType: string): Promise<string>;
  get(ref: string): Promise<Uint8Array>;
  del(ref: string): Promise<void>;
}

export class InMemoryBlobStore implements BlobStore {
  private map = new Map<string, { bytes: Uint8Array; contentType: string }>();
  async put(bytes: Uint8Array, contentType: string): Promise<string> {
    const ref = `mem://${randomUUID()}`;
    this.map.set(ref, { bytes, contentType });
    return ref;
  }
  async get(ref: string): Promise<Uint8Array> {
    const e = this.map.get(ref);
    if (!e) throw new Error(`blob not found: ${ref}`);
    return e.bytes;
  }
  async del(ref: string): Promise<void> { this.map.delete(ref); }
}

/** Vercel Blob impl (prod). The returned URL is the ref. Requires BLOB_READ_WRITE_TOKEN. */
export class VercelBlobStore implements BlobStore {
  async put(bytes: Uint8Array, contentType: string): Promise<string> {
    const { put } = await import("@vercel/blob");
    const { url } = await put(`uploads/${randomUUID()}`, Buffer.from(bytes), {
      access: "public", contentType, addRandomSuffix: false,
    });
    return url;
  }
  async get(ref: string): Promise<Uint8Array> {
    const res = await fetch(ref);
    if (!res.ok) throw new Error(`blob fetch failed ${res.status}: ${ref}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  async del(ref: string): Promise<void> {
    const { del } = await import("@vercel/blob");
    await del(ref);
  }
}

let override: BlobStore | null = null;
export function __setBlobStore(s: BlobStore | null) { override = s; }
export function resolveBlobStore(): BlobStore {
  return override ?? new VercelBlobStore();
}
