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
}

const isEmployee = (m: ChatMessage) => m.author_type === "employee";

function fmtTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t || t <= 0) return "";
  return new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const LocationChat = ({
  messages, viewerSide, onSend, sending, canDelete, onDelete, onToggleDone, busyId, placeholder,
}: LocationChatProps) => {
  const [text, setText] = useState("");

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
          {messages.map((m) => {
            const mine = viewerSide === "employee" ? isEmployee(m) : !isEmployee(m);
            const showStatus = !isEmployee(m) && !m.legacy && m.status;
            return (
              <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                <div
                  className={`max-w-[82%] rounded-2xl px-3 py-1.5 text-sm ${
                    mine ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm"
                  }`}
                >
                  <div className="flex items-baseline gap-2">
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
                  {onToggleDone && !isEmployee(m) && !m.legacy && (
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
