// Turns a stored meeting note (summary + action plan, both markdown-light) into
// a readable plain-text protocol for the "send to customer" mail composer.
// Headings ("## ") stay as their own line, checkbox/bullet markers all become
// plain "- " bullets — matching how the app renders the note on screen.

function normalizeSection(text: string): string[] {
  const out: string[] = [];
  for (const raw of (text || "").split("\n")) {
    const line = raw.trim();
    if (!line) { out.push(""); continue; }
    if (line.startsWith("## ")) { out.push(line.slice(3)); continue; }
    const isList = /^[-*•]\s+/.test(line) || /\[[ xX]?\]/.test(line);
    if (!isList) { out.push(line); continue; }
    const body = line.replace(/^[-*•]\s*/, "");
    const parts = body.split(/\s*\[[ xX]?\]\s*/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) out.push(`- ${body}`);
    else for (const part of parts) out.push(`- ${part}`);
  }
  // Collapse leading/trailing blank lines.
  while (out.length && !out[0]) out.shift();
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

export interface ProtocolParts {
  title?: string | null;
  summary: string;
  actionPlan: string;
  customerName?: string | null;
}

/** A ready-to-edit e-mail body containing the full protocol. */
export function buildProtocolEmailBody({ title, summary, actionPlan, customerName }: ProtocolParts): string {
  // Neutral wording — no direct address (neither "Sie" nor "du").
  const greeting = customerName?.trim() ? `Guten Tag ${customerName.trim()},` : "Guten Tag,";
  const intro = title?.trim()
    ? `anbei das Protokoll zu „${title.trim()}".`
    : "anbei das Protokoll unseres Gesprächs.";

  const lines: string[] = [greeting, "", intro, ""];
  lines.push("Ergebnisprotokoll", "");
  lines.push(...normalizeSection(summary));
  lines.push("", "Maßnahmenplan", "");
  lines.push(...normalizeSection(actionPlan));
  return lines.join("\n").trim();
}

/** Default subject line for the protocol mail. */
export function buildProtocolSubject(title?: string | null): string {
  return title?.trim() ? `Protokoll – ${title.trim()}` : "Protokoll";
}
