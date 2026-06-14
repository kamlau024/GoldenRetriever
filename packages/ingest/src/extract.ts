import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

const turndown = new TurndownService({ headingStyle: "atx" });

export interface ExtractResult {
  title: string | null;
  markdown: string;
  wordCount: number;
}

export function extractContent(html: string, url: string | null): ExtractResult {
  const dom = new JSDOM(html, { url: url ?? undefined });
  const doc = dom.window.document;
  const title = doc.title?.trim() || null;

  let contentHtml: string;
  try {
    const article = new Readability(doc).parse();
    contentHtml = article?.content ?? doc.body?.innerHTML ?? "";
  } catch {
    contentHtml = doc.body?.innerHTML ?? "";
  }

  const markdown = turndown.turndown(contentHtml).trim();
  const wordCount = markdown.split(/\s+/).filter(Boolean).length;
  return { title, markdown, wordCount };
}
