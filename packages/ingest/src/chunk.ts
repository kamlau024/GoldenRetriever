export interface ChunkOptions { maxTokens: number; overlapTokens: number; }
export interface TextChunk { ordinal: number; content: string; tokenCount: number; }

// Heuristic: ~1.33 tokens per word. Word-based windowing keeps chunks readable.
const WORDS_PER_TOKEN = 0.75;
const toWords = (tokens: number) => Math.max(1, Math.round(tokens * WORDS_PER_TOKEN));
const estTokens = (words: number) => Math.ceil(words / WORDS_PER_TOKEN);

export function chunkText(text: string, opts: ChunkOptions): TextChunk[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const windowWords = toWords(opts.maxTokens);
  const overlapWords = Math.min(toWords(opts.overlapTokens), windowWords - 1);
  const step = Math.max(1, windowWords - overlapWords);

  const chunks: TextChunk[] = [];
  for (let start = 0, ordinal = 0; start < words.length; start += step, ordinal++) {
    const slice = words.slice(start, start + windowWords);
    chunks.push({ ordinal, content: slice.join(" "), tokenCount: estTokens(slice.length) });
    if (start + windowWords >= words.length) break;
  }
  return chunks;
}
