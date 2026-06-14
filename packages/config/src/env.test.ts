import { describe, it, expect } from "vitest";
import { parseEnv } from "./env.js";

describe("parseEnv", () => {
  it("applies model defaults when not provided", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://x",
      AI_GATEWAY_API_KEY: "k",
    });
    expect(env.GR_GENERATION_MODEL).toBe("anthropic/claude-sonnet-4-6");
    expect(env.GR_EMBEDDING_MODEL).toBe("openai/text-embedding-3-small");
  });

  it("throws when a required var is missing", () => {
    expect(() => parseEnv({ AI_GATEWAY_API_KEY: "k" })).toThrow();
  });

  it("respects model overrides", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://x",
      AI_GATEWAY_API_KEY: "k",
      GR_GENERATION_MODEL: "openai/gpt-5",
    });
    expect(env.GR_GENERATION_MODEL).toBe("openai/gpt-5");
  });
});
