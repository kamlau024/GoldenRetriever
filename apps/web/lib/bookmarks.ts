export interface BookmarkEntry { url: string; title: string; folder: string; }

/** Max pages accepted per bookmark import (bounds cost/time). Enforced client- and server-side. */
export const MAX_BOOKMARK_IMPORT = 50;

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const cp = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : whole;
    }
    const key = code.toLowerCase();
    return key in NAMED ? NAMED[key] : whole;
  });
}

const stripTags = (s: string): string => s.replace(/<[^>]*>/g, "");

/**
 * Parse a Netscape-format bookmarks export into http(s) entries. Maintains a folder stack across
 * `<H3>` headings and `<DL>` nesting so each link gets its nearest enclosing folder (top level →
 * "Bookmarks"). Drops non-http(s) links and de-dupes repeated URLs (first wins). No DOM dependency,
 * so it runs both in the browser and in node tests.
 */
export function parseBookmarksHtml(html: string): BookmarkEntry[] {
  const entries: BookmarkEntry[] = [];
  const seen = new Set<string>();
  const stack: string[] = ["Bookmarks"];
  let pending: string | null = null;
  const token = /<h3\b[^>]*>([\s\S]*?)<\/h3>|<dl\b[^>]*>|<\/dl\s*>|<a\b[^>]*\shref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = token.exec(html)) !== null) {
    if (m[1] !== undefined) {
      pending = decodeEntities(stripTags(m[1])).trim() || "Bookmarks";
    } else if (m[2] !== undefined) {
      const url = decodeEntities(m[2]).trim();
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      const title = decodeEntities(stripTags(m[3])).trim() || url;
      entries.push({ url, title, folder: stack[stack.length - 1] });
    } else if (m[0][1] === "/") { // </dl>
      if (stack.length > 1) stack.pop();
    } else { // <dl ...>
      stack.push(pending ?? stack[stack.length - 1]);
      pending = null;
    }
  }
  return entries;
}
