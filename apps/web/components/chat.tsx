"use client";
import { useState, type FormEvent } from "react";
import { useUser } from "@clerk/nextjs";
import { User } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DogAvatar } from "@/components/logo";

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

// Citation chips get a distinct amber background so they stand out from the (muted) reply bubble.
const CITE = "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200";

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
            <div className={cn("min-w-0", isUser ? "text-right" : "text-left")}>
              <p className="inline-block rounded-lg bg-muted px-3 py-2 text-left">
                {m.role === "assistant" && m.content === "" ? <TypingDots /> : m.content}
              </p>
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
  const { user } = useUser();

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
        body: JSON.stringify({ kbId, message }),
      });
      if (!res.ok) { setAssistant({ content: ERR }); return; }
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
      // An empty stream means generation failed mid-flight (e.g. a rate-limit/gateway error
      // that the server couldn't surface) — show a message instead of an empty bubble.
      if (!acc.trim()) { setAssistant({ content: ERR }); return; }
      // Show only the sources the answer actually cited as [n], not every retrieved chunk.
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
