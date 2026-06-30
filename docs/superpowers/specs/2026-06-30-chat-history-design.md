# Chat History — Design

**Date:** 2026-06-30
**Status:** Approved (design). Ready for implementation plan.

## Goal

Surface and resume the conversations the backend already persists. Add a slide-over **History**
drawer to the Chat page that lists past conversations, opens one (reloading its transcript), starts a
new chat, and deletes a conversation. Conversations get **LLM-generated titles**.

## Scope boundary

This is **read-back + thread management only**. It does **not** change what the model sees per
question. Resuming a thread reloads the displayed transcript and appends new turns to that thread in
the database, but each answer is still generated independently over the library. (Feeding prior turns
to the model is the separate *conversational memory* design.)

## Out of scope — tracked as follow-ups

Recorded in `backlog.md` to be done **right after this build, before any other stage**:

- Rename a conversation
- Search within history
- Pagination of the conversation list

## Architecture

Client-driven drawer + thin REST endpoints. The streaming Chat client stays intact and gains
conversation state plus a drawer. Three new session-authed endpoints back the drawer. Titles are
generated server-side inside the chat route's existing `onFinish` callback (no extra round trip from
the client). The chat route **already** emits an `x-conversation-id` response header and accepts an
optional `conversationId` — the client simply starts using both.

```mermaid
sequenceDiagram
    participant U as User
    participant C as Chat (client)
    participant API as /api/conversations*
    participant CHAT as /api/chat
    participant DB as Postgres

    U->>C: open History drawer
    C->>API: GET /api/conversations
    API->>DB: listConversations(userId, kbId)
    DB-->>C: [{id,title,lastActivityAt,messageCount}]
    U->>C: select a conversation
    C->>API: GET /api/conversations/:id
    API->>DB: getConversationForUser(id, userId)
    DB-->>C: {id,title,messages[]}
    C-->>U: transcript reloaded
    U->>C: ask a follow-up
    C->>CHAT: POST {kbId, conversationId, message}
    CHAT->>DB: append messages; (if new) set title
    CHAT-->>C: stream + x-conversation-id
```

## Data layer — `packages/db/src/queries.ts` (no schema migration)

Types:

```ts
export interface ConversationSummary {
  id: string;
  title: string | null;
  lastActivityAt: Date;
  messageCount: number;
}
export interface ConversationDetail {
  id: string;
  title: string | null;
  messages: { id: string; role: string; content: string; citations: unknown }[];
}
```

- `listConversations(db, userId, kbId): Promise<ConversationSummary[]>`
  Conversations for `(userId, kbId)`, left-joined to `messages`, grouped by conversation, ordered by
  `coalesce(max(messages.created_at), conversations.created_at) DESC` so revisited threads bubble up —
  no `updated_at` column needed. `lastActivityAt = coalesce(max(m.created_at), c.created_at)`,
  `messageCount = count(m.id)`.

- `getConversationForUser(db, conversationId, userId): Promise<ConversationDetail | null>`
  Returns `null` if the conversation does not exist **or** is not owned by `userId` (no info leak).
  Otherwise its messages ordered by `created_at ASC`.

- `deleteConversation(db, conversationId, userId): Promise<boolean>`
  Deletes where `id AND user_id`; returns whether a row was removed. `messages` cascade via the
  existing FK (`onDelete: "cascade"`).

- `setConversationTitle(db, conversationId, title): Promise<void>`
  Updates `conversations.title`.

## Titling

`packages/ai/src/index.ts`:

```ts
titleConversation(firstMessage: string, reply: string): Promise<string>
```

Uses `generateText` with the **tagging model** (`gpt-4o-mini`, cheap). Prompt asks for a concise title
of **at most 6 words**, no surrounding quotes or trailing punctuation. Returns the model text trimmed,
de-quoted, and length-capped (≤ 60 chars).

Chat route (`apps/web/app/api/chat/route.ts`):

- Compute `const isNew = !conversationId;` **before** resolving `convId`.
- In `onFinish`, after appending the assistant message, if `isNew`:
  `try { title = await ai.titleConversation(message, text) } catch { title = firstWords(message, 60) }`
  then `setConversationTitle(db, convId, title)`. `firstWords` is a small local helper in
  `lib/chat-service.ts` (first ~6 words, capped). Best-effort — a title failure must not break the
  reply (already inside the existing `onFinish` try-surface).

## Endpoints (App Router, session auth via existing `resolveAuth`)

- `GET /api/conversations` → `resolveAuth`; `kbId = getOrCreatePersonalKb(db, userId)`;
  returns `{ conversations: ConversationSummary[] }`.
- `GET /api/conversations/[id]` → `getConversationForUser(db, id, userId)`; **404** if `null`; else the
  `ConversationDetail` as JSON.
- `DELETE /api/conversations/[id]` → `deleteConversation(db, id, userId)`; **404** if `false`; else
  `{ ok: true }`.
- All return **401** when unauthenticated. Ownership failures return **404** (not 403) to avoid leaking
  a conversation's existence — mirrors `/api/documents/[id]`.

## UI

**New primitive — `apps/web/components/ui/sheet.tsx`**: a slide-over built on
`@base-ui/react/dialog` (overlay + side-anchored panel, slide/fade transitions), following the same
wrapper conventions as `ui/alert-dialog.tsx` (`data-slot`, `cn`, base-ui `render` props).

**New — `apps/web/components/chat-history.tsx`**: the drawer contents.
- Fetches `GET /api/conversations` when opened; renders a scrollable list (`ui/scroll-area`) of rows:
  title (fallback **"Untitled chat"**) + relative time, with a trash button per row that opens an
  `AlertDialog` confirm → `DELETE` → refetch.
- A **"＋ New chat"** action at the top.
- Loading → `ui/skeleton` rows; empty → "No conversations yet."

**Modify — `apps/web/components/chat.tsx`**:
- State: `conversationId: string | null`, drawer open boolean.
- Card header gains a **"History"** button (opens drawer) and **"＋ New chat"** button.
- `send()` includes `conversationId` in the POST body; after the response, reads
  `res.headers.get("x-conversation-id")` and, if `conversationId` was `null`, sets it.
- `selectConversation(id)`: GET detail → map messages to `Turn[]` (jsonb `citations` →
  `{ title, sourceUrl }[]`) → `setMessages`, `setConversationId`, close drawer.
- `newChat()`: `setMessages([])`, `setConversationId(null)`, close drawer.
- Page loads to a **blank new chat** (no auto-resume).

**New — `apps/web/lib/relative-time.ts`**: `relativeTime(date): string` (e.g. `"2h ago"`) via
`Intl.RelativeTimeFormat`.

## Errors / edge cases

- Deleting the currently-open thread → `newChat()` reset.
- `title === null` (threads created before titling, or refusal-only threads) → list shows
  **"Untitled chat"**. Pre-existing test threads are not backfilled (acceptable; new threads all get
  titles).
- Network errors on list / load / delete → `sonner` toast; current state preserved.

## Testing

- **Integration** (`scripts/test.sh`, pgvector DB):
  - `listConversations` — ordering by last activity, `messageCount`, scoping to `(userId, kbId)`.
  - `getConversationForUser` — own conversation returns messages; another user's returns `null`.
  - `deleteConversation` — deletes own + cascades messages; refuses another user's (returns `false`).
  - `setConversationTitle` — persists.
- **AI unit** (`packages/ai`): `titleConversation` de-quotes, caps length, with a stubbed model.
- **Component** (vitest jsdom, mock `fetch`):
  - `ChatHistory` lists conversations, "New chat" clears, selecting loads messages, delete confirm
    calls the endpoint.
  - `Chat` sends `conversationId` and captures `x-conversation-id` on a new thread.

## File structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `packages/db/src/queries.ts` | 4 queries + 2 types |
| Create | `packages/db/src/queries.conversations.test.ts` | query integration tests |
| Modify | `packages/ai/src/index.ts` | `titleConversation` |
| Modify | `packages/ai/src/*.test.ts` | title unit test |
| Modify | `apps/web/app/api/chat/route.ts` | set title on a new conversation |
| Create | `apps/web/app/api/conversations/route.ts` | `GET` list |
| Create | `apps/web/app/api/conversations/[id]/route.ts` | `GET` detail, `DELETE` |
| Create | `apps/web/components/ui/sheet.tsx` | slide-over primitive |
| Create | `apps/web/components/chat-history.tsx` | drawer contents |
| Modify | `apps/web/components/chat.tsx` | conversation state + drawer wiring |
| Create | `apps/web/lib/relative-time.ts` | relative timestamps |
| Modify | `apps/web/components/chat.test.tsx` | `conversationId` send/capture |
| Create | `apps/web/components/chat-history.test.tsx` | drawer behavior |

## Global constraints (inherited)

- Auth: session via Clerk (`resolveAuth`); ownership failures → **404**, never leak existence.
- UI built on **base-ui** (`@base-ui/react`, `render={<X/>}` props — not Radix `asChild`), Tailwind v4
  theme tokens, `cn` from `@/lib/utils`, `@/` alias → `apps/web` root.
- Tests: node/integration via `bash scripts/test.sh <path>`; component (jsdom) via
  `pnpm --filter @gr/web exec vitest run <path>`.
- No new heavyweight deps; reuse existing UI primitives where possible.
