import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb } from "./client.js";
import {
  createUser, createKnowledgeBase, createConversation, appendMessage, getMessages,
  listConversations, getConversationForUser, deleteConversation, setConversationTitle,
} from "./queries.js";

const URL = process.env.DATABASE_URL ?? "postgres://gr:gr@localhost:5433/gr_test";
const { db, sql } = createDb(URL);
let kbId: string, uid: string, otherUid: string, otherKb: string;

beforeAll(async () => {
  uid = await createUser(db, { id: "u_conv", email: "conv@c.dev" });
  otherUid = await createUser(db, { id: "u_conv_other", email: "convo@c.dev" });
  kbId = await createKnowledgeBase(db, { ownerId: uid, name: "Conv" });
  otherKb = await createKnowledgeBase(db, { ownerId: otherUid, name: "Other" });
});
afterAll(async () => { await sql.end(); });

describe("conversation queries", () => {
  it("lists conversations ordered by last activity with message counts", async () => {
    const a = await createConversation(db, { kbId, userId: uid, title: "A" });
    const b = await createConversation(db, { kbId, userId: uid, title: "B" });
    await appendMessage(db, { conversationId: a, role: "user", content: "first in A" });
    await appendMessage(db, { conversationId: b, role: "user", content: "later in B" });
    await appendMessage(db, { conversationId: b, role: "assistant", content: "reply in B" });
    const list = await listConversations(db, uid, kbId);
    const ids = list.map((c) => c.id);
    expect(ids.indexOf(b)).toBeLessThan(ids.indexOf(a)); // b is more recent → sorts first
    expect(list.find((c) => c.id === b)!.messageCount).toBe(2);
    expect(list.find((c) => c.id === a)!.messageCount).toBe(1);
  });

  it("scopes the list to the owner and kb", async () => {
    const mine = await createConversation(db, { kbId, userId: uid });
    await createConversation(db, { kbId: otherKb, userId: otherUid });
    expect((await listConversations(db, uid, kbId)).some((c) => c.id === mine)).toBe(true);
    expect((await listConversations(db, otherUid, otherKb)).some((c) => c.id === mine)).toBe(false);
  });

  it("returns a conversation with messages only to its owner", async () => {
    const c = await createConversation(db, { kbId, userId: uid, title: "Detail" });
    await appendMessage(db, { conversationId: c, role: "user", content: "hello", citations: null });
    await appendMessage(db, { conversationId: c, role: "assistant", content: "hi", citations: [{ title: "T", sourceUrl: null }] });
    const detail = await getConversationForUser(db, c, uid);
    expect(detail).not.toBeNull();
    expect(detail!.title).toBe("Detail");
    expect(detail!.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(await getConversationForUser(db, c, otherUid)).toBeNull(); // not owner → null
  });

  it("deletes a conversation (cascading messages) only for its owner", async () => {
    const c = await createConversation(db, { kbId, userId: uid });
    await appendMessage(db, { conversationId: c, role: "user", content: "x" });
    expect(await deleteConversation(db, c, otherUid)).toBe(false);
    expect(await deleteConversation(db, c, uid)).toBe(true);
    expect(await getMessages(db, c)).toEqual([]); // cascaded
    expect(await getConversationForUser(db, c, uid)).toBeNull();
  });

  it("sets a conversation title", async () => {
    const c = await createConversation(db, { kbId, userId: uid });
    await setConversationTitle(db, c, "Kyoto stay");
    expect((await getConversationForUser(db, c, uid))!.title).toBe("Kyoto stay");
  });
});
