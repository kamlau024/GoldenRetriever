import { describe, it, expect } from "vitest";
import { resolveModels } from "./models.js";

describe("resolveModels", () => {
  it("reads provider/model strings from env", () => {
    const m = resolveModels({
      GR_GENERATION_MODEL: "anthropic/claude-sonnet-4-6",
      GR_TAGGING_MODEL: "anthropic/claude-haiku-4-5",
      GR_EMBEDDING_MODEL: "openai/text-embedding-3-small",
      GR_RERANK_MODEL: "cohere/rerank-3.5",
    });
    expect(m.generation).toBe("anthropic/claude-sonnet-4-6");
    expect(m.embedding).toBe("openai/text-embedding-3-small");
  });

  it("rejects an embedding model swap that is not declared 1536-dim safe", () => {
    expect(() => resolveModels({
      GR_GENERATION_MODEL: "openai/gpt-5",
      GR_TAGGING_MODEL: "openai/gpt-5-mini",
      GR_EMBEDDING_MODEL: "openai/text-embedding-3-large", // 3072 dims
      GR_RERANK_MODEL: "cohere/rerank-3.5",
    })).toThrow(/1536/);
  });
});
