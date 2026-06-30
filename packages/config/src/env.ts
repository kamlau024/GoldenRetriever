import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  // Optional: on Vercel the AI SDK authenticates to the Gateway via the deployment's
  // OIDC token, so no explicit key is required. Set it for local/non-Vercel use.
  AI_GATEWAY_API_KEY: z.string().optional(),
  GR_GENERATION_MODEL: z.string().default("anthropic/claude-sonnet-4-6"),
  GR_TAGGING_MODEL: z.string().default("anthropic/claude-haiku-4-5"),
  GR_EMBEDDING_MODEL: z.string().default("openai/text-embedding-3-small"),
  // A fast generative model used as an LLM reranker (the Gateway has no native rerank endpoint).
  GR_RERANK_MODEL: z.string().default("openai/gpt-4o-mini"),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  return schema.parse(source);
}

export const env: Env = parseEnv();
