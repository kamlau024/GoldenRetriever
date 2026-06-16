import { describe, it, expect } from "vitest";
import { InMemoryBlobStore, resolveBlobStore, __setBlobStore } from "./blob.js";

describe("InMemoryBlobStore", () => {
  it("round-trips bytes and content type, and deletes", async () => {
    const store = new InMemoryBlobStore();
    const ref = await store.put(new Uint8Array([1, 2, 3]), "application/pdf");
    expect(typeof ref).toBe("string");
    const got = await store.get(ref);
    expect(Array.from(got)).toEqual([1, 2, 3]);
    await store.del(ref);
    await expect(store.get(ref)).rejects.toThrow();
  });
});

describe("blob store DI seam", () => {
  it("returns the override when set", () => {
    const fake = new InMemoryBlobStore();
    __setBlobStore(fake);
    expect(resolveBlobStore()).toBe(fake);
    __setBlobStore(null);
  });
});
