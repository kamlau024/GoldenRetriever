"use client";
import { useState, useMemo, type FormEvent } from "react";
import { useUser } from "@clerk/nextjs";
import { User, History, Plus } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetTrigger, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ChatHistory } from "@/components/chat-history";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/logo";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { rehypeCitations } from "@/lib/rehype-citations";
import { makeCitation, type CitationData } from "@/components/citation";

export interface Citation { title: string | null; sourceUrl: string | null; kind: string; content: string; }
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

/** Render an assistant reply as markdown (bold, lists, links, code, …), with `[n]` markers rendered
 *  as inline citation icons that open a source popover. */
function Markdown({ children, citations }: { children: string; citations?: CitationData[] }) {
  const components = useMemo(() => ({ cite: makeCitation(citations ?? []) }), [citations]);
  return (
    <div className="space-y-2 text-left [&_a]:underline [&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] dark:[&_code]:bg-white/15 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-0 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-black/10 [&_pre]:p-2 dark:[&_pre]:bg-white/10 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeCitations]} components={components}>{children}</ReactMarkdown>
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

function Avatar({ isUser, userAvatarUrl }: { isUser: boolean; userAvatarUrl?: string }) {
  if (!isUser) {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/60">
        <LogoMark className="h-4 w-auto" />
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
            <div className={cn("min-w-0 flex-1", isUser ? "ml-6 text-right sm:ml-9" : "mr-6 text-left sm:mr-9")}>
              <div className={cn(
                "inline-block max-w-full rounded-lg px-3 py-2 text-left",
                isUser ? "bg-muted text-foreground" : "bg-amber-100 text-amber-950 dark:bg-amber-950/60 dark:text-amber-50",
              )}>
                {isUser ? m.content : m.content === "" ? <TypingDots /> : <Markdown citations={m.citations}>{m.content}</Markdown>}
              </div>
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
          ? (m.citations as { title: string | null; sourceUrl: string | null; kind?: string; content?: string }[])
              .map((c) => ({ title: c.title, sourceUrl: c.sourceUrl, kind: c.kind ?? "text", content: c.content ?? "" }))
          : undefined,
      })));
      setConversationId(id);
      setHistoryOpen(false);
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
      const { parseCitations } = await import("../lib/citations.js");
      const allCitations = parseCitations(res.headers.get("x-citations"))
        .map((c) => ({ title: c.title, sourceUrl: c.sourceUrl, kind: c.kind, content: c.content }));
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
      setAssistant({ citations: allCitations });
    } catch {
      setAssistant({ content: "⚠️ Network error — please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
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
      <Card className="p-3 sm:p-4">
        <div className="space-y-4">
          <Transcript messages={messages} userAvatarUrl={user?.imageUrl ?? undefined} />
          <form onSubmit={send} className="flex gap-2">
            <Input className="flex-1" value={input} onChange={(e) => setInput(e.target.value)}
              placeholder="Ask your library…" />
            <Button type="submit" disabled={busy}>Ask</Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
