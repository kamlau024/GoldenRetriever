# Memory Phase 1 — Within-Conversation Memory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed the active thread's prior turns into the chat prompt so follow-up questions resolve, via a new sectioned prompt builder that keeps the `[n]` citation + REFUSAL rules intact.

**Architecture:** A pure, env-free prompt module (`apps/web/lib/chat-prompt.ts`) assembles non-citable memory/history sections plus the numbered citable Sources. Task 1 introduces it as a behavior-preserving refactor of the chat route (no history yet). Task 2 loads the thread's prior turns — reusing the messages the ownership check already fetches — and passes them as the history section.

**Tech Stack:** Next.js 15 App Router, AI SDK v6 (`streamText`), Drizzle/Postgres, Vitest.

## Global Constraints

- The prompt keeps the existing citation format `[n]` and the REFUSAL rule for library-grounded answers; memory/history is **never citable** — it only personalizes and resolves references.
- No schema change, no new endpoints (Phase 1 reads existing `messages`).
- The prompt builder is **pure** (no `@gr/config`/env import) so it unit-tests without the DB harness.
- Prior turns are the thread's messages **excluding the current question** (load before appending the new user message).
- Test runners: pure node unit via `pnpm exec vitest run <path>`; DB/integration via `bash scripts/test.sh <path>`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Sectioned chat-prompt builder (behavior-preserving refactor)

**Files:**
- Create: `apps/web/lib/chat-prompt.ts`
- Test: `apps/web/lib/chat-prompt.test.ts` (create)
- Modify: `apps/web/lib/chat-service.ts` (remove `REFUSAL` const + `groundedPrompt`)
- Modify: `apps/web/app/api/chat/route.ts` (import + use `buildChatPrompt`, no history yet)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `REFUSAL: string` (moved here from `chat-service.ts`)
  - `interface ChatPromptParts { question: string; sources: string[]; history?: { role: string; content: string }[]; facts?: string[]; pastChats?: string[] }`
  - `formatHistory(messages: { role: string; content: string }[], maxChars?: number): string`
  - `buildChatPrompt(parts: ChatPromptParts): string`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/chat-prompt.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run apps/web/lib/chat-prompt.test.ts`
Expected: FAIL — `./chat-prompt.js` does not exist.

- [ ] **Step 3: Create the prompt module**

Create `apps/web/lib/chat-prompt.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run apps/web/lib/chat-prompt.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Remove the old prompt from `chat-service.ts`**

In `apps/web/lib/chat-service.ts`, delete the `REFUSAL` constant and the `groundedPrompt` function (the last block of the file):

```ts
export const REFUSAL = "I don't have anything saved about that.";
export function groundedPrompt(question: string, contexts: string[]): string {
  const numbered = contexts.map((c, i) => `[${i + 1}] ${c}`).join("\n\n");
  return `Answer the question using ONLY the numbered sources. Cite sources inline like [1].\n` +
    `If the sources do not contain the answer, say "${REFUSAL}"\n\nSources:\n${numbered}\n\nQuestion: ${question}`;
}
```

Leave the rest of `chat-service.ts` (imports, `ChatDeps`, `__setChatDeps`, `resolveChatDeps`, `firstWords`) unchanged. (`REFUSAL` and the prompt now live in `chat-prompt.ts`; nothing else imports `groundedPrompt`.)

- [ ] **Step 6: Point the chat route at the new builder (no behavior change)**

In `apps/web/app/api/chat/route.ts`:

Change the import on line 7 from:

```ts
import { resolveChatDeps, groundedPrompt, REFUSAL, firstWords } from "../../../lib/chat-service.js";
```

to these two lines:

```ts
import { resolveChatDeps, firstWords } from "../../../lib/chat-service.js";
import { buildChatPrompt, REFUSAL } from "../../../lib/chat-prompt.js";
```

Change the `streamText` prompt from:

```ts
    prompt: groundedPrompt(message, hits.map((h) => h.content)),
```

to:

```ts
    prompt: buildChatPrompt({ question: message, sources: hits.map((h) => h.content) }),
```

(No history is passed yet — behavior is identical to before. `REFUSAL` is still used by the no-hits branch.)

- [ ] **Step 7: Verify nothing regressed**

Run: `pnpm --filter @gr/web typecheck && bash scripts/test.sh apps/web/test/chat-route.test.ts`
Expected: typecheck clean; the existing chat-route tests still PASS (same grounded behavior, same REFUSAL string).

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/chat-prompt.ts apps/web/lib/chat-prompt.test.ts apps/web/lib/chat-service.ts apps/web/app/api/chat/route.ts
git commit -m "refactor(web): sectioned chat-prompt builder (no behavior change)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Load the thread's prior turns into the prompt

**Files:**
- Modify: `apps/web/app/api/chat/route.ts` (capture prior messages, pass as `history`)
- Test: `apps/web/test/chat-route.test.ts` (add a capturing-model test)

**Interfaces:**
- Consumes: `buildChatPrompt` (Task 1) — its `history` param; `getConversationForUser(db, conversationId, userId)` → `{ …, messages: { id; role; content; citations }[] } | null` (already imported in the route).
- Produces: the chat route passes the active thread's prior turns as `history`.

- [ ] **Step 1: Write the failing test**

In `apps/web/test/chat-route.test.ts`, first add a prompt-capturing model. Just below the existing `modelSaying` definition, add a shared stream-chunks helper and a capturing model (and refactor `modelSaying` to use the helper so the chunk list isn't duplicated):

```ts
// Shared V3 stream chunks for the mock model (text-start / delta / end / finish-with-usage).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const streamChunks = (text: string): any => ({
  stream: simulateReadableStream({
    chunks: [
      { type: "text-start" as const, id: "t1" },
      { type: "text-delta" as const, id: "t1", delta: text },
      { type: "text-end" as const, id: "t1" },
      {
        type: "finish" as const,
        finishReason: "stop" as const,
        usage: {
          inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
      },
    ],
  }),
});

let capturedPrompt = "";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const capturingModel = (text: string) => new MockLanguageModelV3({
  doStream: (async (opts: { prompt: unknown }) => {
    capturedPrompt = JSON.stringify(opts.prompt);
    return streamChunks(text);
  }) as any,
});
```

Then change the existing `modelSaying` to reuse the helper — replace its body:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const modelSaying = (text: string) => new MockLanguageModelV3({
  doStream: (async () => streamChunks(text)) as any,
});
```

Then add this test inside the `describe("POST /api/chat", …)` block:

```ts
  it("includes the thread's prior turns in the prompt (within-conversation memory)", async () => {
    __setChatDeps({ retriever: retrieverReturning([chunk("Tawaraya is a ryokan in Kyoto.")]), model: capturingModel("Stay at Tawaraya [1].") });
    const first = await post({ kbId, message: "where should I stay in Kyoto?" });
    const convId = first.headers.get("x-conversation-id")!;
    await first.text();

    __setChatDeps({ retriever: retrieverReturning([chunk("Tawaraya has tatami rooms.")]), model: capturingModel("It does [1].") });
    const second = await post({ kbId, conversationId: convId, message: "does it have tatami?" });
    await second.text();

    expect(capturedPrompt).toContain("Earlier in this conversation:");
    expect(capturedPrompt).toContain("where should I stay in Kyoto?"); // prior user turn
    expect(capturedPrompt).toContain("Stay at Tawaraya");              // prior assistant turn
    expect(capturedPrompt).toContain("does it have tatami?");          // current question
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/test.sh apps/web/test/chat-route.test.ts`
Expected: FAIL — `capturedPrompt` has no "Earlier in this conversation:" (the route passes no history yet).

- [ ] **Step 3: Capture prior turns and pass them as history**

In `apps/web/app/api/chat/route.ts`, replace the ownership-check block:

```ts
  if (conversationId) {
    const owned = await getConversationForUser(db, conversationId, principal.userId);
    if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });
  }
```

with one that keeps the prior turns (loaded **before** the current user message is appended, so it excludes the current question):

```ts
  let priorMessages: { role: string; content: string }[] = [];
  if (conversationId) {
    const owned = await getConversationForUser(db, conversationId, principal.userId);
    if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });
    priorMessages = owned.messages;
  }
```

Then pass `history` into the prompt — change:

```ts
    prompt: buildChatPrompt({ question: message, sources: hits.map((h) => h.content) }),
```

to:

```ts
    prompt: buildChatPrompt({ question: message, sources: hits.map((h) => h.content), history: priorMessages }),
```

(For a brand-new conversation the ownership block is skipped, so `priorMessages` stays `[]` and the "Earlier in this conversation" section is omitted.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/test.sh apps/web/test/chat-route.test.ts`
Expected: PASS — all existing chat-route tests plus the new within-conversation-memory test.

- [ ] **Step 5: Typecheck + full suite**

Run: `pnpm --filter @gr/web typecheck && bash scripts/test.sh`
Expected: typecheck clean; entire node + component suite green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/chat/route.ts apps/web/test/chat-route.test.ts
git commit -m "feat(web): include prior thread turns in the chat prompt (within-conversation memory)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Plan Self-Review

**Spec coverage (Phase 1 rows of the design):**
- Sectioned prompt builder with "Earlier in this conversation" + non-citable memory sections, `[n]` + REFUSAL preserved → Task 1. ✓
- Chat route loads the active thread's recent turns (excluding the current message) into that section, token-budgeted → Task 2 (`priorMessages` loaded before the append; `formatHistory` budget). ✓
- No schema change, no new endpoints → neither task adds them. ✓
- Forward-compatible `facts`/`pastChats` slots for Phases 2–3 → present on `ChatPromptParts`, unused now (YAGNI: accepted but not wired). ✓

**Placeholder scan:** No TBD/TODO/"handle errors"/"similar to" — every code step is complete. ✓

**Type consistency:** `buildChatPrompt`/`formatHistory`/`ChatPromptParts`/`REFUSAL` names and signatures are identical between Task 1's definition and Task 2's use. `owned.messages` (`{id,role,content,citations}[]`) is assignable to `priorMessages: {role,content}[]` (structural width). The route imports `buildChatPrompt, REFUSAL` from `chat-prompt.js` (Task 1) and uses `history` (Task 2). ✓
