// Die Mails rund um einen Termin. Reines Modul: Texte und Links sind das,
// was der Kunde am Ende sieht, und ein falscher Link ist hier teurer als ein
// Fehler in der Berechnung. Deshalb testbar gehalten.

import { DateTime } from "luxon";

export type MailKind = "confirmation" | "internal_new" | "reminder" | "cancellation" | "reschedule";

export interface MailInfo {
  customerName: string;
  projectNumber: string;
  /** Bezeichnung der Terminart, z.B. "Aufmass vor Ort". */
  label: string;
  start: Date | string;
  end: Date | string;
  address: string | null;
  hinweis?: string | null;
  staffName?: string | null;
  /** Link, mit dem der Kunde selbst absagt. */
  cancelUrl?: string;
  /** Buchungsseite des Projekts (fuer einen neuen Termin). */
  bookingUrl?: string;
  /** Interne Links aus der Benachrichtigungsmail. */
  staffCancelUrl?: string;
  staffRescheduleUrl?: string;
  /** Warum abgesagt wurde — entscheidet den Text der Absagemail. */
  cancelReason?: "customer" | "staff_cancel" | "staff_reschedule" | null;
  /** Fehlt HERO, steht das in der internen Mail. */
  heroError?: string | null;
  timezone?: string;
}

const TZ = "Europe/Berlin";

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const dt = (v: Date | string, tz: string) =>
  (v instanceof Date ? DateTime.fromJSDate(v) : DateTime.fromISO(v, { zone: "utc" })).setZone(tz);

/** "Donnerstag, 24. September 2026" */
export function dateText(v: Date | string, tz = TZ): string {
  return dt(v, tz).setLocale("de").toFormat("cccc, d. LLLL yyyy");
}

/** "09:45 - 11:15 Uhr" */
export function timeText(start: Date | string, end: Date | string, tz = TZ): string {
  return `${dt(start, tz).toFormat("HH:mm")} - ${dt(end, tz).toFormat("HH:mm")} Uhr`;
}

function button(url: string, text: string, color = "#111827"): string {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 18px;border-radius:8px;` +
    `background:${color};color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(text)}</a>`;
}

function shell(inner: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;` +
    `font-size:15px;line-height:1.55;color:#111827;max-width:560px">${inner}` +
    `<p style="margin-top:28px;color:#6b7280;font-size:13px">SL WERBUNG &middot; Aufmass-Termine &uuml;ber Captfix</p></div>`;
}

/** Termin-Steckbrief, in jeder Mail gleich aufgebaut. */
function facts(info: MailInfo): string {
  const tz = info.timezone || TZ;
  const rows: [string, string][] = [
    ["Termin", `${dateText(info.start, tz)}<br>${timeText(info.start, info.end, tz)}`],
    ["Anlass", escapeHtml(info.label)],
  ];
  if (info.address) rows.push(["Adresse", escapeHtml(info.address)]);
  if (info.projectNumber) rows.push(["Projekt", escapeHtml(info.projectNumber)]);
  if (info.staffName) rows.push(["Kollege", escapeHtml(info.staffName)]);
  if (info.hinweis) rows.push(["Hinweis", escapeHtml(info.hinweis)]);
  return `<table cellpadding="0" cellspacing="0" style="margin:18px 0;border-collapse:collapse">` +
    rows.map(([k, v]) =>
      `<tr><td style="padding:4px 16px 4px 0;color:#6b7280;vertical-align:top">${k}</td>` +
      `<td style="padding:4px 0"><strong>${v}</strong></td></tr>`).join("") +
    `</table>`;
}

export function buildBookingMail(kind: MailKind, info: MailInfo): { subject: string; html: string } {
  const tz = info.timezone || TZ;
  const kurz = dt(info.start, tz).setLocale("de").toFormat("dd.LL.yyyy HH:mm");
  const name = escapeHtml(info.customerName || "");
  const anrede = name ? `Hallo ${name},` : "Hallo,";

  if (kind === "confirmation") {
    return {
      subject: `Termin bestätigt: ${info.label} am ${kurz}`,
      html: shell(
        `<p>${anrede}</p><p>Ihr Termin steht — wir haben ihn fest eingeplant.</p>` +
        facts(info) +
        `<p>Der Kalendereintrag liegt dieser Mail als Datei bei.</p>` +
        (info.cancelUrl
          ? `<p style="margin-top:20px">Passt es doch nicht? ${button(info.cancelUrl, "Termin absagen", "#b91c1c")}</p>`
          : "") +
        `<p style="margin-top:20px">Bis dahin!</p>`,
      ),
    };
  }

  if (kind === "reminder") {
    return {
      subject: `Erinnerung: ${info.label} am ${kurz}`,
      html: shell(
        `<p>${anrede}</p><p>kurze Erinnerung an unseren Termin.</p>` + facts(info) +
        (info.cancelUrl
          ? `<p style="margin-top:20px">Wenn es nicht passt, bitte kurz absagen: ${button(info.cancelUrl, "Termin absagen", "#b91c1c")}</p>`
          : ""),
      ),
    };
  }

  if (kind === "cancellation") {
    // Der Kunde hat selbst abgesagt: dann ist die Mail nur eine Bestaetigung.
    const selbst = info.cancelReason === "customer";
    return {
      subject: selbst
        ? `Termin abgesagt: ${info.label} am ${kurz}`
        : `Termin muss leider entfallen: ${info.label} am ${kurz}`,
      html: shell(
        `<p>${anrede}</p>` +
        (selbst
          ? `<p>Ihre Absage ist angekommen, der Termin ist ausgetragen.</p>`
          : `<p>leider müssen wir den Termin absagen. Entschuldigen Sie die Umstände.</p>`) +
        facts(info) +
        (info.bookingUrl
          ? `<p style="margin-top:20px">Einen neuen Termin können Sie jederzeit selbst wählen: ${button(info.bookingUrl, "Neuen Termin wählen")}</p>`
          : ""),
      ),
    };
  }

  if (kind === "reschedule") {
    return {
      subject: `Bitte neuen Termin wählen: ${info.label}`,
      html: shell(
        `<p>${anrede}</p>` +
        `<p>der vereinbarte Termin passt bei uns leider doch nicht. Der Platz ist wieder frei — ` +
        `bitte wählen Sie einen neuen, der Ihnen passt.</p>` + facts(info) +
        (info.bookingUrl ? `<p style="margin-top:20px">${button(info.bookingUrl, "Neuen Termin wählen")}</p>` : "") +
        `<p style="margin-top:20px">Danke für Ihr Verständnis.</p>`,
      ),
    };
  }

  // internal_new — die Mail an uns. Hier zaehlen die zwei Knoepfe.
  return {
    subject: `Neue Terminbuchung: ${info.projectNumber || info.label} am ${kurz}`,
    html: shell(
      `<p><strong>${name || "Ein Kunde"}</strong> hat einen Termin gebucht.</p>` + facts(info) +
      (info.heroError
        ? `<p style="padding:10px 12px;background:#fef2f2;border-radius:8px;color:#991b1b">` +
          `In HERO konnte der Termin NICHT angelegt werden: ${escapeHtml(info.heroError)}. ` +
          `Bitte dort von Hand eintragen.</p>`
        : "") +
      `<p style="margin-top:20px">Passt der Termin nicht?</p>` +
      `<p>` +
      (info.staffRescheduleUrl ? button(info.staffRescheduleUrl, "Umbuchen lassen") + " " : "") +
      (info.staffCancelUrl ? button(info.staffCancelUrl, "Termin absagen", "#b91c1c") : "") +
      `</p>` +
      `<p style="color:#6b7280;font-size:13px">Beides gibt den Platz sofort wieder frei. ` +
      `Beim Umbuchen bekommt der Kunde die Bitte, selbst einen neuen Termin zu wählen, ` +
      `beim Absagen eine Absage.</p>`,
    ),
  };
}
