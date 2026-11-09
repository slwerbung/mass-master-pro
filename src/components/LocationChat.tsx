import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Trash2, Check, RotateCcw } from "lucide-react";

export interface ChatMessage {
  id: string;
  author_name: string;
  author_type?: string; // 'employee' | 'customer' | 'guest'
  message: string;
  status?: string;       // 'open' | 'done'
  created_at: string;
  author_customer_id?: string | null;
  legacy?: boolean;
  /** Spec C: Antwort auf (eine Ebene) */
  parent_id?: string | null;
  /** Spec C: Kommentar mit Markierung (zeigt die Nummer) */
  markup?: { color: string } | null;
}

interface LocationChatProps {
  messages: ChatMessage[];
  /** Which side the current viewer is on (controls bubble alignment). */
  viewerSide: "customer" | "employee";
  onSend: (text: string) => Promise<void> | void;
  sending?: boolean;
  /** Return true to show a delete action on a message. */
  canDelete?: (m: ChatMessage) => boolean;
  onDelete?: (m: ChatMessage) => void;
  /** Employee-only: mark a customer correction as done / open again. */
  onToggleDone?: (m: ChatMessage) => void;
  busyId?: string | null;
  placeholder?: string;
  /** Antworten (eine Ebene); ohne Prop kein „Antworten“-Knopf */
  onReply?: (parent: ChatMessage, text: string) => Promise<void> | void;
}

const isEmployee = (m: ChatMessage) => m.author_type === "employee";

function fmtTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t || t <= 0) return "";
  return new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const LocationChat = ({
  messages, viewerSide, onSend, sending, canDelete, onDelete, onToggleDone, busyId, placeholder, onReply,
}: LocationChatProps) => {
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  // Top-Level in Zeitfolge, Antworten direkt darunter; Nummern wie im Prüfmodus (älteste Top-Level = 1).
  const tops = messages.filter((m) => !m.parent_id);
  const numberOf = new Map([...tops].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((m, i) => [m.id, i + 1]));
  const ordered: ChatMessage[] = [];
  for (const t of tops) {
    ordered.push(t);
    ordered.push(...messages.filter((m) => m.parent_id === t.id));
  }
  // Antworten ohne bekannten Elternteil nicht verschlucken.
  ordered.push(...messages.filter((m) => m.parent_id && !tops.some((t) => t.id === m.parent_id)));

  const handleSend = async () => {
    const t = text.trim();
    if (!t) return;
    await onSend(t);
    setText("");
  };

  return (
    <div className="space-y-2">
      {messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Nachrichten.</p>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {ordered.map((m) => {
            const mine = viewerSide === "employee" ? isEmployee(m) : !isEmployee(m);
            const isReply = !!m.parent_id;
            // Status: Kundenkommentare und Markierungen (auch vom Team); einfache Team-Nachrichten wie bisher ohne.
            const hasStatus = !isReply && !m.legacy && (!isEmployee(m) || !!m.markup);
            const showStatus = hasStatus && m.status;
            return (
              <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"} ${isReply ? (mine ? "pr-6" : "pl-6") : ""}`}>
                <div
                  className={`max-w-[82%] rounded-2xl px-3 py-1.5 text-sm ${
                    mine ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm"
                  }`}
                >
                  <div className="flex items-baseline gap-2">
                    {m.markup && !isReply && (
                      <span className="inline-flex h-4 min-w-4 items-center justify-center self-center rounded-full px-1 text-[10px] font-bold text-white"
                        style={{ background: m.status === "done" ? "#16a34a" : m.markup.color }}>{numberOf.get(m.id)}</span>
                    )}
                    {isReply && <span className={`text-[10px] ${mine ? "opacity-70" : "text-muted-foreground"}`}>↳</span>}
                    <span className={`text-[11px] font-medium ${mine ? "opacity-90" : "text-muted-foreground"}`}>{m.author_name}</span>
                    <span className={`text-[10px] ${mine ? "opacity-70" : "text-muted-foreground"}`}>{fmtTime(m.created_at)}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words">{m.message}</p>
                </div>
                <div className="flex items-center gap-2 mt-0.5 px-1">
                  {showStatus && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${m.status === "done" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                      {m.status === "done" ? "Umgesetzt" : "Offen"}
                    </span>
                  )}
                  {onReply && !isReply && !m.legacy && (
                    <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => { setReplyTo(replyTo === m.id ? null : m.id); setReplyText(""); }}>
                      Antworten
                    </button>
                  )}
                  {onToggleDone && hasStatus && (
                    <button
                      className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
                      disabled={busyId === m.id}
                      onClick={() => onToggleDone(m)}
                    >
                      {m.status === "done" ? (<><RotateCcw className="h-3 w-3" /> öffnen</>) : (<><Check className="h-3 w-3" /> erledigt</>)}
                    </button>
                  )}
                  {canDelete?.(m) && onDelete && (
                    <button
                      className="text-[10px] text-destructive/80 hover:text-destructive inline-flex items-center gap-0.5"
                      disabled={busyId === m.id}
                      onClick={() => onDelete(m)}
                    >
                      <Trash2 className="h-3 w-3" /> löschen
                    </button>
                  )}
                </div>
                {replyTo === m.id && onReply && (
                  <div className="mt-1 flex w-full max-w-[82%] items-end gap-1.5">
                    <Textarea rows={1} value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Antwort…" className="min-h-[36px] resize-none text-sm" autoFocus />
                    <Button size="icon" className="h-9 w-9" disabled={sending || !replyText.trim()}
                      onClick={async () => { const t = replyText.trim(); if (!t) return; await onReply(m, t); setReplyText(""); setReplyTo(null); }}>
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-end gap-2">
        <Textarea
          placeholder={placeholder || "Nachricht schreiben…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend(); }}
          rows={2}
          className="resize-none"
        />
        <Button size="icon" onClick={handleSend} disabled={sending || !text.trim()} title="Senden">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default LocationChat;
