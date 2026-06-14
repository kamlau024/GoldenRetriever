import type { ConvertedContent } from "@gr/core";
import type { Converter } from "./converter.js";
import { extractContent } from "./extract.js";

export interface RouterInput {
  mimeType: string | null;
  /** Text-ish sources: HTML or plain text. */
  text?: string;
  /** Binary sources: PDF / Office / images. */
  bytes?: Uint8Array;
  sourceUrl?: string | null;
  filename?: string | null;
}

const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;
const looksLikeHtml = (s: string) => /<html|<body|<article|<\/p>|<div/i.test(s);

export async function convertToMarkdown(input: RouterInput, converter: Converter): Promise<ConvertedContent> {
  const mime = input.mimeType;
  const hasText = input.text !== undefined;

  if (hasText && (mime?.includes("html") || (mime == null && looksLikeHtml(input.text!)))) {
    return extractContent(input.text!, input.sourceUrl ?? null);
  }
  if (hasText && (mime?.startsWith("text/plain") || mime == null)) {
    const md = input.text!.trim();
    return { title: null, markdown: md, wordCount: countWords(md) };
  }
  if (input.bytes) {
    const md = (await converter.convert(input.bytes, mime ?? "application/octet-stream", input.filename ?? undefined)).trim();
    return { title: input.filename ?? null, markdown: md, wordCount: countWords(md) };
  }
  const md = (input.text ?? "").trim();
  return { title: null, markdown: md, wordCount: countWords(md) };
}
