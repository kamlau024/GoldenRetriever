import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDb, schema } from "@gr/db";
import { createUser, getOrCreatePersonalKb, getDocument } from "@gr/db/queries";
import { createMockAiClient } from "@gr/ai/mock";
import { MockConverter } from "@gr/ingest";
import { hashToken } from "../lib/auth.js";
import { __setIngestDeps } from "../lib/ingest-service.js";
import { InMemoryBlobStore, __setBlobStore } from "../lib/blob.js";
import { POST } from "../app/api/upload/route.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, token: string;

const upload = (kb: string, file: File | null, auth = true) => {
  const fd = new FormData();
  fd.set("kbId", kb);
  if (file) fd.set("file", file);
  return POST(new NextRequest("http://localhost/api/upload", {
    method: "POST", headers: auth ? { authorization: `Bearer ${token}` } : {}, body: fd,
  }));
};
const pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "report.pdf", { type: "application/pdf" });

beforeAll(async () => {
  const uid = await createUser(db, { id: "u_upload", email: "up@up.dev" });
  kbId = await getOrCreatePersonalKb(db, uid);
  token = "grt_upload";
  await db.insert(schema.apiTokens).values({ id: `tok_${randomUUID().slice(0, 8)}`, userId: uid, name: "t", tokenHash: hashToken(token) });
  __setBlobStore(new InMemoryBlobStore());
  __setIngestDeps({ ai: createMockAiClient(), converter: new MockConverter("# PDF\n\nReport about Kyoto."), urlFetcher: async () => ({ kind: "text" as const, mimeType: "text/plain", text: "" }) });
});
afterAll(async () => { __setBlobStore(null); __setIngestDeps(null); await sql.end(); });

describe("POST /api/upload", () => {
  it("401 without auth", async () => { expect((await upload(kbId, pdf(), false)).status).toBe(401); });
  it("400 without a file", async () => { expect((await upload(kbId, null)).status).toBe(400); });
  it("403 for a kb the caller is not a member of", async () => { expect((await upload("kb_other", pdf())).status).toBe(403); });
  it("413 for a file over the 25 MB cap", async () => {
    const big = new File([new Uint8Array(26 * 1024 * 1024)], "big.pdf", { type: "application/pdf" });
    expect((await upload(kbId, big)).status).toBe(413);
  });
  it("stores the file and ingests it to ready", async () => {
    delete process.env.APP_URL;
    const res = await upload(kbId, pdf());
    expect(res.status).toBe(202);
    const { documentId } = await res.json() as { documentId: string };
    const doc = await getDocument(db, documentId, kbId);
    expect(doc?.status).toBe("ready");
    expect(doc?.blobKey).toMatch(/^mem:\/\//);
  });
});
