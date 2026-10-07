// Eine geparste Mail in die Form bringen, die der Assistent speichert.
// `toParsed` ist rein (nimmt das Ergebnis von mailparser), damit es unter vitest
// laeuft; `parseRaw.ts` ruft mailparser selbst auf.

import { cleanBody, htmlToText, parseMessageIds } from "./mail.ts";

export interface ParsedAttachment {
  filename: string;
  mime: string;
  size: number;
  inline: boolean;
  content: Uint8Array | null;
}

export interface ParsedMail {
  messageId: string | null;
  inReplyTo: string | null;
  refs: string[];
  fromAddr: string;
  fromName: string;
  to: string[];
  cc: string[];
  subject: string;
  sentAt: string | null;
  /** Bereinigt (ohne Zitate/Signatur), gekuerzt. */
  body: string;
  headers: Record<string, string>;
  attachments: ParsedAttachment[];
}

const KEEP_HEADERS = ["list-unsubscribe", "list-id", "auto-submitted", "precedence", "x-auto-response-suppress"];

function addrList(v: any): { address: string; name: string }[] {
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  return arr.flatMap((x: any) => (x?.value ?? []) as { address?: string; name?: string }[])
    .filter((a) => a?.address)
    .map((a) => ({ address: String(a.address).toLowerCase(), name: a.name || "" }));
}

export function toParsed(mp: any): ParsedMail {
  const from = addrList(mp.from)[0];
  const rawText: string = mp.text && String(mp.text).trim() ? String(mp.text) : htmlToText(String(mp.html || ""));
  const headers: Record<string, string> = {};
  for (const k of KEEP_HEADERS) {
    const v = mp.headers?.get?.(k);
    if (v != null) headers[k] = typeof v === "object" ? String((v as any).value ?? JSON.stringify(v)) : String(v);
  }
  const inReplyTo = parseMessageIds(mp.inReplyTo)[0] ?? null;
  const refs = parseMessageIds(mp.references);
  const date = mp.date instanceof Date && !Number.isNaN(mp.date.getTime()) ? mp.date.toISOString() : null;
  return {
    messageId: parseMessageIds(mp.messageId)[0] ?? null,
    inReplyTo,
    refs: inReplyTo && !refs.includes(inReplyTo) ? [...refs, inReplyTo] : refs,
    fromAddr: from?.address ?? "",
    fromName: String(from?.name || "").trim().replace(/^["']|["']$/g, ""),
    to: addrList(mp.to).map((a) => a.address),
    cc: addrList(mp.cc).map((a) => a.address),
    subject: String(mp.subject || "").trim(),
    sentAt: date,
    body: cleanBody(rawText),
    headers,
    attachments: (mp.attachments || []).map((a: any) => ({
      filename: a.filename || "anhang",
      mime: a.contentType || "application/octet-stream",
      size: Number(a.size ?? a.content?.length ?? 0),
      inline: a.contentDisposition === "inline" || a.related === true,
      content: a.content ?? null,
    })),
  };
}
