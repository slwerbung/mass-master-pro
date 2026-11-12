// Spec D1: Kundenmail „Neue Version zur Freigabe“. Reine Funktion (getestet), Versand in project-invite.
// Absender/Branding = Firmenname aus legal_info, nie „Captfix“.

export interface NewVersionItem { label: string; version: number | null }

function esc(s: string) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildNewVersionMail(o: {
  companyName: string; projectNumber: string; link: string; items: NewVersionItem[]; note?: string; resetApproval: boolean;
}): { subject: string; html: string; text: string } {
  const subject = `Neue Version zur Freigabe – Projekt ${o.projectNumber}`;
  const items = o.items.length ? o.items : [{ label: "Ihre Dateien", version: null }];
  const li = items.map((i) => `<li style="margin:2px 0">${esc(i.label)}${i.version ? ` <span style="color:#666">(Version ${i.version})</span>` : ""}</li>`).join("");
  const note = o.note?.trim() ? `<p style="margin:12px 0"><strong>Was wurde geändert?</strong><br><span style="white-space:pre-wrap">${esc(o.note.trim())}</span></p>` : "";
  const reset = o.resetApproval
    ? `<p style="margin:12px 0">Bitte prüfen Sie die neue Version und geben Sie sie erneut frei – die bisherige Freigabe gilt für die ältere Version.</p>`
    : `<p style="margin:12px 0">Bitte sehen Sie sich die neue Version an.</p>`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:560px;line-height:1.5">
      <p>Guten Tag,</p>
      <p>für Ihr Projekt <strong>${esc(o.projectNumber)}</strong> liegt eine neue Version vor:</p>
      <ul style="margin:8px 0;padding-left:20px">${li}</ul>
      ${note}
      ${reset}
      <p style="margin:24px 0">
        <a href="${esc(o.link)}" style="background:#0E73E8;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">Neue Version ansehen</a>
      </p>
      <p style="font-size:13px;color:#666">Link: ${esc(o.link)}</p>
      <p style="margin-top:20px">Mit freundlichen Grüßen<br>${esc(o.companyName)}</p>
    </div>`;
  const text = [
    "Guten Tag,", "", `für Ihr Projekt ${o.projectNumber} liegt eine neue Version vor:`,
    ...items.map((i) => `- ${i.label}${i.version ? ` (Version ${i.version})` : ""}`),
    ...(o.note?.trim() ? ["", `Was wurde geändert? ${o.note.trim()}`] : []),
    "", o.resetApproval ? "Bitte prüfen Sie die neue Version und geben Sie sie erneut frei." : "Bitte sehen Sie sich die neue Version an.",
    "", o.link, "", "Mit freundlichen Grüßen", o.companyName,
  ].join("\n");
  return { subject, html, text };
}
