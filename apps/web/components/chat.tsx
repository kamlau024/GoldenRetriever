"use client";
import { useState, type FormEvent } from "react";
import { useUser } from "@clerk/nextjs";
import { User, History, Plus } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetTrigger, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ChatHistory } from "@/components/chat-history";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DogAvatar } from "@/components/logo";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface Citation { title: string | null; sourceUrl: string | null; }
export interface Turn { id: string; role: string; content: string; citations?: Citation[]; }

/** Only allow http(s) hrefs; anything else (e.g. `javascript:`) becomes inert. Prevents XSS
 *  from a user-controlled saved URL rendered as a citation link. */
export function safeHref(u: string | null | undefined): string {
  if (!u) return "#";
  try {
    const { protocol } = new URL(u, "http://_");
    return protocol === "http:" || protocol === "https:" ? u : "#";
  } catch {
    return "#";
  }
}

/** Render an assistant reply as markdown (bold, lists, links, code, …). */
function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-2 text-left [&_a]:underline [&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] dark:[&_code]:bg-white/15 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-0 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-black/10 [&_pre]:p-2 dark:[&_pre]:bg-white/10 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

/** Bouncing dots shown in the assistant bubble while waiting for the first token. */
function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Generating response">
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
    </span>
  );
}

// Citation chips: a light, outlined "source" pill — distinct from the solid amber reply bubble.
const CITE = "border border-amber-400/60 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200";

function Avatar({ isUser, userAvatarUrl }: { isUser: boolean; userAvatarUrl?: string }) {
  if (!isUser) {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/60">
        <DogAvatar className="size-5" />
      </span>
    );
  }
  return userAvatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={userAvatarUrl} alt="You" className="size-7 shrink-0 rounded-full object-cover" />
  ) : (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
      <User className="size-4 text-muted-foreground" />
    </span>
  );
}

export function Transcript({ messages, userAvatarUrl }: { messages: Turn[]; userAvatarUrl?: string }) {
  return (
    <div className="space-y-4">
      {messages.map((m) => {
        const isUser = m.role === "user";
        return (
          <div key={m.id} className={cn("flex items-start gap-2", isUser && "flex-row-reverse")}>
            <Avatar isUser={isUser} userAvatarUrl={userAvatarUrl} />
            <div className={cn("min-w-0 flex-1", isUser ? "ml-9 text-right" : "mr-9 text-left")}>
              <div className={cn(
                "inline-block max-w-full rounded-lg px-3 py-2 text-left",
                isUser ? "bg-muted text-foreground" : "bg-amber-100 text-amber-950 dark:bg-amber-950/60 dark:text-amber-50",
              )}>
                {isUser ? m.content : m.content === "" ? <TypingDots /> : <Markdown>{m.content}</Markdown>}
              </div>
              {m.citations?.length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.citations.map((c, i) => {
                    const href = safeHref(c.sourceUrl);
                    const label = c.title ?? "source";
                    // Pasted text / uploads have no external URL → show a non-clickable chip
                    // instead of a dead link that opens a blank tab.
                    return href === "#" ? (
                      <Badge key={i} variant="secondary" className={CITE} title="Saved text — no external source">{label}</Badge>
                    ) : (
                      <Badge key={i} variant="secondary" className={CITE} render={<a href={href} target="_blank" rel="noopener noreferrer" className="underline" />}>{c.title ?? c.sourceUrl}</Badge>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Chat({ kbId }: { kbId: string }) {
  const [messages, setMessages] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { user } = useUser();

  function newChat() {
    setMessages([]);
    setConversationId(null);
    setHistoryOpen(false);
  }

  async function selectConversation(id: string) {
    setHistoryOpen(false);
    try {
      const res = await fetch(`/api/conversations/${id}`);
      if (!res.ok) throw new Error();
      const detail = await res.json() as {
        id: string;
        messages: { id: string; role: string; content: string; citations: unknown }[];
      };
      setMessages(detail.messages.map((m) => ({
        id: m.id, role: m.role, content: m.content,
        citations: Array.isArray(m.citations)
          ? (m.citations as { title: string | null; sourceUrl: string | null }[])
              .map((c) => ({ title: c.title, sourceUrl: c.sourceUrl }))
          : undefined,
      })));
      setConversationId(id);
    } catch {
      toast.error("Couldn't open that conversation");
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    const userTurn: Turn = { id: crypto.randomUUID(), role: "user", content: message };
    const assistantId = crypto.randomUUID();
    setMessages((m) => [...m, userTurn, { id: assistantId, role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    const setAssistant = (patch: Partial<Turn>) =>
      setMessages((m) => m.map((t) => (t.id === assistantId ? { ...t, ...patch } : t)));
    const ERR = "⚠️ The AI couldn't generate a response right now — it may be rate-limited (the free AI tier limits requests). Please try again in a moment.";
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(conversationId ? { kbId, conversationId, message } : { kbId, message }),
      });
      if (!res.ok) { setAssistant({ content: ERR }); return; }
      const newConvId = res.headers.get("x-conversation-id");
      if (newConvId && !conversationId) setConversationId(newConvId);
      const { parseCitations, citedOnly } = await import("../lib/citations.js");
      const allCitations = parseCitations(res.headers.get("x-citations"))
        .map((c) => ({ title: c.title, sourceUrl: c.sourceUrl }));
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setAssistant({ content: acc });
      }
      if (!acc.trim()) { setAssistant({ content: ERR }); return; }
      setAssistant({ citations: citedOnly(acc, allCitations) });
    } catch {
      setAssistant({ content: "⚠️ Network error — please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
            <SheetTrigger render={<Button variant="outline" size="sm"><History className="size-4" /> History</Button>} />
            <SheetContent side="left">
              <SheetTitle>Conversations</SheetTitle>
              <ChatHistory
                open={historyOpen}
                activeId={conversationId}
                onSelect={selectConversation}
                onNew={newChat}
                onDeletedActive={newChat}
              />
            </SheetContent>
          </Sheet>
          <Button variant="ghost" size="sm" onClick={newChat}><Plus className="size-4" /> New chat</Button>
        </div>
        <Transcript messages={messages} userAvatarUrl={user?.imageUrl ?? undefined} />
        <form onSubmit={send} className="flex gap-2">
          <Input className="flex-1" value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your library…" />
          <Button type="submit" disabled={busy}>Ask</Button>
        </form>
      </div>
    </Card>
  );
}
