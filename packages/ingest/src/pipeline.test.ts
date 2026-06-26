import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb } from "@gr/db";
import { createUser, createKnowledgeBase, insertDocument, getDocument } from "@gr/db/queries";
import { createMockAiClient } from "@gr/ai/mock";
import { runIngestion } from "./pipeline.js";
import { MockConverter } from "./converter.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
const ai = createMockAiClient();
const conv = new MockConverter();
let userId: string, kbId: string;

beforeAll(async () => {
  userId = await createUser(db, { id: "u_pipe", email: "p@p.dev" });
  kbId = await createKnowledgeBase(db, { ownerId: userId, name: "Pipe" });
});
afterAll(async () => { await sql.end(); });

describe("runIngestion", () => {
  it("parses HTML, chunks, embeds, tags and marks the document ready", async () => {
    const docId = await insertDocument(db, {
      kbId, addedBy: userId, kind: "web", captureMode: "full_dom",
      sourceUrl: "https://ex.com", title: null,
    });
    await runIngestion(db, ai, conv, {
      documentId: docId, kbId, mimeType: "text/html",
      text: "<html><head><title>T</title></head><body><article><p>Kyoto ryokan stay.</p></article></body></html>",
    });
    const doc = await getDocument(db, docId, kbId);
    expect(doc?.status).toBe("ready");
    expect(doc?.title).toBe("T");

    const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM chunks WHERE document_id = ${docId}`;
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("converts a binary document via the Converter and marks it ready", async () => {
    const docId = await insertDocument(db, {
      kbId, addedBy: userId, kind: "pdf", captureMode: "upload",
      sourceUrl: null, title: null, mimeType: "application/pdf",
    });
    await runIngestion(db, ai, new MockConverter("# PDF\n\nKyoto ryokan report body."), {
      documentId: docId, kbId, mimeType: "application/pdf",
      bytes: new Uint8Array([1, 2, 3]), filename: "report.pdf",
    });
    const doc = await getDocument(db, docId, kbId);
    expect(doc?.status).toBe("ready");
  });

  it("marks the document failed when there is no content", async () => {
    const docId = await insertDocument(db, {
      kbId, addedBy: userId, kind: "text", captureMode: "selection",
      sourceUrl: null, title: null, mimeType: "text/plain",
    });
    // empty text → router yields empty markdown → pipeline throws "no content to ingest"
    await expect(runIngestion(db, ai, conv, {
      documentId: docId, kbId, mimeType: "text/plain", text: "",
    })).rejects.toThrow();
    const doc = await getDocument(db, docId, kbId);
    expect(doc?.status).toBe("failed");
  });

  it("fetches and parses an html URL when no inline content is provided", async () => {
    const docId = await insertDocument(db, {
      kbId, addedBy: userId, kind: "web", captureMode: "url_fetch",
      sourceUrl: "https://ok.dev/post", title: null, mimeType: null,
    });
    const fakeFetcher = async () => ({ kind: "text" as const, mimeType: "text/html",
      text: "<html><head><title>Post</title></head><body><article><p>Kyoto ryokan guide.</p></article></body></html>" });
    await runIngestion(db, ai, conv, {
      documentId: docId, kbId, mimeType: null, sourceUrl: "https://ok.dev/post",
    }, fakeFetcher);
    const doc = await getDocument(db, docId, kbId);
    expect(doc?.status).toBe("ready");
    expect(doc?.title).toBe("Post");
  });

  it("fetches the URL when inline text is an empty string (the web form/route sends text='')", async () => {
    const docId = await insertDocument(db, {
      kbId, addedBy: userId, kind: "web", captureMode: "url_fetch",
      sourceUrl: "https://ok.dev/empty", title: null, mimeType: null,
    });
    const fakeFetcher = async () => ({ kind: "text" as const, mimeType: "text/html",
      text: "<html><head><title>Fetched</title></head><body><article><p>Kyoto ryokan via fetch.</p></article></body></html>" });
    await runIngestion(db, ai, conv, {
      documentId: docId, kbId, mimeType: null, text: "", sourceUrl: "https://ok.dev/empty",
    }, fakeFetcher);
    const doc = await getDocument(db, docId, kbId);
    expect(doc?.status).toBe("ready");
    expect(doc?.title).toBe("Fetched");
  });
});
