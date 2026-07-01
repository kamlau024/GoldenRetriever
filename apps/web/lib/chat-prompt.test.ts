import { describe, it, expect } from "vitest";
import { REFUSAL, formatHistory, buildChatPrompt } from "./chat-prompt.js";

describe("formatHistory", () => {
  it("formats turns as You/Assistant, oldest-first", () => {
    expect(formatHistory([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ])).toBe("You: hi\nAssistant: hello");
  });
  it("returns an empty string for no messages", () => {
    expect(formatHistory([])).toBe("");
  });
  it("keeps the most recent turns within the char budget (but always the last)", () => {
    const msgs = [
      { role: "user", content: "A".repeat(100) },
      { role: "assistant", content: "B".repeat(100) },
      { role: "user", content: "C".repeat(100) },
    ];
    const out = formatHistory(msgs, 150);
    expect(out).toContain("C".repeat(100));      // most recent kept
    expect(out).not.toContain("A".repeat(100));  // oldest dropped
  });
});

describe("buildChatPrompt", () => {
  const base = { question: "where to stay?", sources: ["Tawaraya is a ryokan."] };
  it("with no history/facts/recall reads like a grounded prompt", () => {
    const p = buildChatPrompt(base);
    expect(p).toContain("[1] Tawaraya is a ryokan.");
    expect(p).toContain("Question: where to stay?");
    expect(p).toContain(REFUSAL);
    expect(p).not.toContain("Earlier in this conversation:");
    expect(p).not.toContain("About you");
  });
  it("places prior turns in an 'Earlier in this conversation' section before the Sources and question", () => {
    const p = buildChatPrompt({ ...base, history: [
      { role: "user", content: "is Kyoto nice?" },
      { role: "assistant", content: "yes, very" },
    ] });
    expect(p).toContain("Earlier in this conversation:");
    expect(p).toContain("You: is Kyoto nice?");
    expect(p).toContain("Assistant: yes, very");
    expect(p.indexOf("Earlier in this conversation:")).toBeLessThan(p.indexOf("Sources:"));
    expect(p.indexOf("Sources:")).toBeLessThan(p.indexOf("Question:"));
  });
});
