import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  AI_GATEWAY_API_KEY: z.string().min(1),
  GR_GENERATION_MODEL: z.string().default("anthropic/claude-sonnet-4-6"),
  GR_TAGGING_MODEL: z.string().default("anthropic/claude-haiku-4-5"),
  GR_EMBEDDING_MODEL: z.string().default("openai/text-embedding-3-small"),
  GR_RERANK_MODEL: z.string().default("cohere/rerank-3.5"),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  return schema.parse(source);
}

export const env: Env = parseEnv();
