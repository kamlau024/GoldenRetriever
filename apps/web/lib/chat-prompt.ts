export const REFUSAL = "I don't have anything saved about that.";

export interface ChatPromptParts {
  question: string;
  /** Retrieved library passages — the ONLY citable sources ([1], [2], …). */
  sources: string[];
  /** Prior turns of the active thread (Phase 1). */
  history?: { role: string; content: string }[];
  /** Long-term extracted facts about the user (Phase 2 — accepted now, unused). */
  facts?: string[];
  /** Summaries of relevant past conversations (Phase 3 — accepted now, unused). */
  pastChats?: string[];
}

/** The most recent prior turns that fit within ~maxChars, oldest-first within the kept window.
 *  Always keeps at least the last turn. Returns "" when there are no messages. */
export function formatHistory(messages: { role: string; content: string }[], maxChars = 6000): string {
  const kept: string[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const line = `${messages[i].role === "assistant" ? "Assistant" : "You"}: ${messages[i].content}`;
    if (kept.length > 0 && used + line.length > maxChars) break;
    kept.unshift(line);
    used += line.length;
  }
  return kept.join("\n");
}

/** Assemble the chat prompt: non-citable memory/history context sections (only when present),
 *  then the numbered citable Sources, then the question. Preserves the [n] citation format and
 *  the REFUSAL rule for library-grounded answers. */
export function buildChatPrompt(parts: ChatPromptParts): string {
  const { question, sources, history = [], facts = [], pastChats = [] } = parts;
  const sections: string[] = [];
  if (facts.length) sections.push(`About you (memory):\n${facts.map((f) => `- ${f}`).join("\n")}`);
  const hist = formatHistory(history);
  if (hist) sections.push(`Earlier in this conversation:\n${hist}`);
  if (pastChats.length) sections.push(`Possibly relevant past chats:\n${pastChats.map((c) => `- ${c}`).join("\n")}`);
  const context = sections.length ? `${sections.join("\n\n")}\n\n` : "";
  const numbered = sources.map((c, i) => `[${i + 1}] ${c}`).join("\n\n");
  return `${context}Answer the question using ONLY the numbered Sources, and cite them inline like [1]. ` +
    `Use any memory and conversation context above only to personalize the reply and resolve references — never cite it. ` +
    `If the Sources do not contain the answer, say "${REFUSAL}"\n\nSources:\n${numbered}\n\nQuestion: ${question}`;
}
