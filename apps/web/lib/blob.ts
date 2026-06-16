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

/**
 * Vercel Blob impl (prod). Uses PRIVATE access so a tenant's uploaded documents are NOT
 * world-readable — the ref is the store pathname (never a public URL), and reads go through
 * the authenticated SDK (not a plain fetch). Requires BLOB_READ_WRITE_TOKEN.
 */
export class VercelBlobStore implements BlobStore {
  async put(bytes: Uint8Array, contentType: string): Promise<string> {
    const { put } = await import("@vercel/blob");
    const { pathname } = await put(`uploads/${randomUUID()}`, Buffer.from(bytes), {
      access: "private", contentType, addRandomSuffix: false,
    });
    return pathname;
  }
  async get(ref: string): Promise<Uint8Array> {
    const { get } = await import("@vercel/blob");
    const result = await get(ref, { access: "private" });
    if (!result || !result.stream) throw new Error(`blob not found: ${ref}`);
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
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
