// HERO-Aktionen aus einer Anweisung („Nein, anders …“): alles, was die HERO-API fuer die Arbeit an einer Mail
// hergibt – ausser Projekt anlegen/zuordnen, Angebot und Termin (die laufen in instruct.ts ueber ihre eigenen Wege).
//
//   ansprechpartner_anlegen  Ansprechpartner beim Kunden anlegen        create_contact(is_contact_person, parent_customer_id)
//   kontakt_aendern          Telefon/Mail/Adresse/Position aendern     update_contact
//   adresse_anlegen          weitere Adresse beim Kunden               create_customer_address
//   projekt_aendern          Projektname, Ansprechpartner am Projekt   update_project_match
//   status_setzen            Projektschritt wechseln                   update_project_match(step_id)
//   mitarbeiter_zuweisen     Mitarbeiter dem Projekt zuweisen          add_project_match_assignments
//   aufgabe_anlegen          Aufgabe fuer einen Mitarbeiter            update_task (ohne id = neu)
//   logbuch_notiz            Notiz ins Projekt-Logbuch                 add_logbook_entry
//
// Bewusst NICHT: Loeschen jeder Art, Mails senden (`send_mail` nur ueber sendDocument), Zahlungen/Belege,
// Leistungs-/Artikelstamm, Vorlagen, Webhooks, Firmendaten, Passwoerter.
//
// Das Modell liefert nur Felder. Welche Kontakt-, Mitarbeiter- und Schritt-IDs dahinterstehen, loest der Code aus der
// HERO-Lage auf (`toOps`), und vor dem Ausfuehren wird alles noch einmal gegen HERO geprueft (`runOp`).

import { z } from "zod";

export const OP_KINDS = [
  "ansprechpartner_anlegen", "kontakt_aendern", "adresse_anlegen", "projekt_aendern",
  "status_setzen", "mitarbeiter_zuweisen", "aufgabe_anlegen", "logbuch_notiz",
] as const;
export type OpKind = typeof OP_KINDS[number];

export const MAX_OPS = 10;

/** Felder, die eine Aktion traegt (bearbeitbar in der Mail-App). */
export const OP_FIELDS: Record<OpKind, string[]> = {
  ansprechpartner_anlegen: ["salutation", "first_name", "last_name", "email", "phone", "mobile", "position"],
  kontakt_aendern: ["email", "phone", "mobile", "position", "street", "zip", "city"],
  adresse_anlegen: ["label", "street", "zip", "city"],
  projekt_aendern: ["project_name"],
  status_setzen: [],
  mitarbeiter_zuweisen: [],
  aufgabe_anlegen: ["title", "note", "due_date"],
  logbuch_notiz: ["note"],
};

export const FIELD_LABEL: Record<string, string> = {
  salutation: "Anrede", first_name: "Vorname", last_name: "Nachname", email: "E-Mail", phone: "Telefon", mobile: "Mobil",
  position: "Position", street: "Straße", zip: "PLZ", city: "Ort", label: "Bezeichnung", project_name: "Projektname",
  title: "Titel", note: "Text", due_date: "Fällig am",
};

export const OP_TITLE: Record<OpKind, string> = {
  ansprechpartner_anlegen: "Ansprechpartner anlegen", kontakt_aendern: "Kontaktdaten ändern", adresse_anlegen: "Adresse beim Kunden anlegen",
  projekt_aendern: "Projekt ändern", status_setzen: "Projektstatus setzen", mitarbeiter_zuweisen: "Mitarbeiter dem Projekt zuweisen",
  aufgabe_anlegen: "Aufgabe anlegen", logbuch_notiz: "Notiz ins Logbuch",
};

const str = z.string().nullish().transform((v) => (v == null ? null : String(v).trim() || null));

/** Was das Modell je Aktion liefert (flach, alles optional – die Pruefung macht der Code). */
export const ActionSchema = z.object({
  op: z.enum(OP_KINDS),
  /** vorhandener Kontakt: Name oder E-Mail eines Ansprechpartners, „Absender“ oder „Kunde“ */
  contact: str,
  salutation: str, first_name: str, last_name: str, email: str, phone: str, mobile: str, position: str,
  street: str, zip: str, city: str, label: str, project_name: str, note: str,
  /** Mitarbeiter (Name aus der Liste) */
  person: str,
  /** Projektschritt (Name aus der Liste) */
  step: str,
  title: str,
  due_date: str,
});
export type ActionResult = z.infer<typeof ActionSchema>;

const S = { type: ["string", "null"] };
export const ACTION_JSON_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["op", "contact", "salutation", "first_name", "last_name", "email", "phone", "mobile", "position", "street", "zip", "city", "label", "project_name", "note", "person", "step", "title", "due_date"],
  properties: {
    op: { type: "string", enum: [...OP_KINDS] }, contact: S, salutation: S, first_name: S, last_name: S, email: S, phone: S, mobile: S,
    position: S, street: S, zip: S, city: S, label: S, project_name: S, note: S, person: S, step: S, title: S, due_date: S,
  },
};

/** Regeln fuer den Prompt (instruct.ts haengt sie an). */
export const OPS_PROMPT = [
  "- actions: weitere HERO-Aktionen, je Aktion ein Eintrag (nur wenn die Anweisung sie verlangt):",
  "  ansprechpartner_anlegen = neuen Ansprechpartner beim Kunden anlegen (salutation Herr/Frau, first_name, last_name, email, phone, mobile, position; Daten aus Anweisung oder Mail-Signatur);",
  "  kontakt_aendern = Kontaktdaten eines vorhandenen Kontakts ändern (contact = wer: Name/E-Mail eines Ansprechpartners, „Absender“ oder „Kunde“; nur die geänderten Felder);",
  "  adresse_anlegen = weitere Adresse beim Kunden (label z. B. „Lieferadresse“, street, zip, city);",
  "  projekt_aendern = Projektname (project_name) und/oder Ansprechpartner am Projekt (contact);",
  "  status_setzen = Projektschritt wechseln (step = Name aus der Schrittliste);",
  "  mitarbeiter_zuweisen = Mitarbeiter dem Projekt zuweisen (person);",
  "  aufgabe_anlegen = Aufgabe (title, note, person = für wen, due_date YYYY-MM-DD);",
  "  logbuch_notiz = Notiz ins Projekt-Logbuch (note).",
  "  Alles, was dafür nicht genannt ist, = null. Nichts erfinden: Telefonnummern, Adressen usw. nur aus Anweisung oder Mail.",
].join("\n");

// ---------------------------------------------------------------- Plan

export interface OpPerson { id: number; name: string; userId: number | null }
export interface OpContact { id: number; name: string; email: string; isCustomer: boolean }
export interface OpStep { id: number; name: string }

export interface OpContext {
  people: OpPerson[];
  /** Kunde selbst + seine Ansprechpartner (leer, wenn der Kunde unbekannt ist) */
  contacts: OpContact[];
  steps: OpStep[];
  /** Absenderadresse der Mail */
  sender: string;
}

export interface HeroOp {
  op: OpKind;
  fields: Record<string, string>;
  contactId: number | null; contactName: string | null;
  /** HERO-Benutzer (fuer Zuweisung/Aufgabe) */
  userId: number | null; personName: string | null;
  stepId: number | null; stepName: string | null;
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß@.\- ]/g, " ").split(/\s+/).filter((w) => w.length >= 2);

/** Eindeutiger Treffer ueber Woerter („jens“, „Frau Klöpfer“) – sonst null. */
function pick<T extends { name: string }>(name: string | null, list: T[]): T | null {
  const w = words(String(name ?? "")).filter((x) => !["herr", "frau"].includes(x));
  if (!w.length) return null;
  const hits = list.filter((p) => { const parts = words(p.name); return w.every((x) => parts.some((y) => y === x || y.startsWith(x))); });
  return hits.length === 1 ? hits[0] : null;
}

export function findContact(ref: string | null, ctx: OpContext): OpContact | null {
  const r = String(ref ?? "").trim().toLowerCase();
  if (!r) return null;
  if (r === "kunde") return ctx.contacts.find((c) => c.isCustomer) ?? null;
  const email = r === "absender" ? ctx.sender.toLowerCase() : r.includes("@") ? r : null;
  if (email) return ctx.contacts.find((c) => c.email && c.email.toLowerCase() === email) ?? null;
  return pick(r, ctx.contacts.filter((c) => !c.isCustomer)) ?? pick(r, ctx.contacts);
}

export function findStep(name: string | null, steps: OpStep[]): OpStep | null {
  const n = String(name ?? "").toLowerCase().replace(/[^a-zäöüß ]/g, " ").trim();
  if (!n) return null;
  const clean = (s: string) => s.toLowerCase().replace(/[^a-zäöüß ]/g, " ").replace(/\s+/g, " ").trim();
  return steps.find((s) => clean(s.name) === clean(n)) ?? steps.find((s) => clean(s.name).includes(clean(n))) ?? null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** Modellantwort -> pruefbare Aktionen; was nicht aufloesbar ist, landet in `notDoable`. */
export function toOps(actions: ActionResult[], ctx: OpContext): { ops: HeroOp[]; notDoable: string[] } {
  const ops: HeroOp[] = [];
  const notDoable: string[] = [];
  for (const a of actions.slice(0, MAX_OPS)) {
    const fields: Record<string, string> = {};
    for (const f of OP_FIELDS[a.op]) {
      const v = (a as Record<string, string | null>)[f];
      if (v) fields[f] = v.slice(0, f === "note" ? 2000 : 200);
    }
    const op: HeroOp = { op: a.op, fields, contactId: null, contactName: null, userId: null, personName: null, stepId: null, stepName: null };
    if (a.op === "kontakt_aendern" || (a.op === "projekt_aendern" && a.contact)) {
      const c = findContact(a.contact ?? (a.op === "kontakt_aendern" ? "absender" : null), ctx);
      if (!c) { notDoable.push(`${OP_TITLE[a.op]}: Kontakt „${a.contact ?? "Absender"}“ beim Kunden nicht gefunden`); continue; }
      op.contactId = c.id; op.contactName = c.name;
    }
    if (a.op === "mitarbeiter_zuweisen" || a.op === "aufgabe_anlegen") {
      const p = pick(a.person, ctx.people);
      if (p?.userId) { op.userId = p.userId; op.personName = p.name; }
      else if (a.person || a.op === "mitarbeiter_zuweisen") notDoable.push(`${OP_TITLE[a.op]}: Mitarbeiter „${a.person ?? "?"}“ nicht gefunden – bitte im Plan wählen`);
    }
    if (a.op === "status_setzen") {
      const s = findStep(a.step, ctx.steps);
      if (!s) { notDoable.push(`Status „${a.step ?? "?"}“ gibt es im Projektablauf nicht`); continue; }
      op.stepId = s.id; op.stepName = s.name;
    }
    const problem = checkFields(op);
    if (problem) { notDoable.push(`${OP_TITLE[a.op]}: ${problem}`); continue; }
    ops.push(op);
  }
  return { ops, notDoable };
}

/** Pflichtfelder und Formate je Aktion; null = in Ordnung. */
export function checkFields(op: HeroOp): string | null {
  const f = op.fields;
  if (f.email && !EMAIL.test(f.email)) return `E-Mail „${f.email}“ ist ungültig`;
  if (f.due_date && !DATE.test(f.due_date)) return "Fälligkeit bitte als Datum";
  switch (op.op) {
    case "ansprechpartner_anlegen": return f.last_name || f.email ? null : "Nachname oder E-Mail fehlt";
    case "kontakt_aendern": return Object.keys(f).length ? null : "keine neuen Daten genannt";
    case "adresse_anlegen": return f.street && f.city ? null : "Straße und Ort fehlen";
    case "projekt_aendern": return f.project_name || op.contactId ? null : "nichts zu ändern";
    case "status_setzen": return op.stepId ? null : "Schritt fehlt";
    case "mitarbeiter_zuweisen": return null; // ohne Mitarbeiter: im Plan waehlen, sonst scheitert das Ausfuehren
    case "aufgabe_anlegen": return f.title ? null : "Titel fehlt";
    case "logbuch_notiz": return f.note ? null : "Text fehlt";
  }
}

/** Kurzbeschreibung fuer Plan und Ergebnis. */
export function describeOp(op: HeroOp): string {
  const f = op.fields;
  const person = [f.salutation, f.first_name, f.last_name].filter(Boolean).join(" ");
  const data = (keys: string[]) => keys.filter((k) => f[k]).map((k) => `${FIELD_LABEL[k]} ${f[k]}`).join(", ");
  switch (op.op) {
    case "ansprechpartner_anlegen": return `Ansprechpartner ${person || f.email} anlegen${data(["email", "phone", "mobile", "position"]) ? ` (${data(["email", "phone", "mobile", "position"])})` : ""}`;
    case "kontakt_aendern": return `${op.contactName ?? "Kontakt"}: ${data(OP_FIELDS.kontakt_aendern)}`;
    case "adresse_anlegen": return `Adresse${f.label ? ` „${f.label}“` : ""} anlegen: ${[f.street, [f.zip, f.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}`;
    case "projekt_aendern": return [f.project_name && `Projektname „${f.project_name}“`, op.contactName && `Ansprechpartner ${op.contactName}`].filter(Boolean).join(", ");
    case "status_setzen": return `Status auf „${op.stepName}“`;
    case "mitarbeiter_zuweisen": return `${op.personName ?? "(Mitarbeiter wählen)"} dem Projekt zuweisen`;
    case "aufgabe_anlegen": return `Aufgabe „${f.title}“${op.personName ? ` für ${op.personName}` : ""}${f.due_date ? `, fällig ${f.due_date.split("-").reverse().join(".")}` : ""}`;
    case "logbuch_notiz": return `Logbuch: ${f.note}`;
  }
}

// ---------------------------------------------------------------- Ausfuehren

export interface HeroOpsApi {
  /** Kunde + Ansprechpartner (fuer die Pruefung von Kontakt-IDs) */
  customerContacts(customerId: number): Promise<OpContact[]>;
  createContactPerson(customerId: number, c: Record<string, string | null>): Promise<number>;
  updateContact(contactId: number, patch: Record<string, unknown>): Promise<void>;
  createCustomerAddress(customerId: number, title: string, address: { street: string; zip: string; city: string }): Promise<number | null>;
  updateProject(projectId: number, patch: Record<string, unknown>): Promise<void>;
  assignUsers(projectId: number, userIds: number[]): Promise<void>;
  createTask(t: { title: string; comment: string | null; target_user_id: number | null; target_project_match_id: number | null; due_date: string | null }): Promise<number | null>;
  addLogbook(projectId: number, text: string): Promise<void>;
}

export interface OpTarget { projectId: number | null; customerId: number | null; allowedUserIds: number[]; allowedStepIds: number[] }

const needProject = (t: OpTarget) => { if (!t.projectId) throw new Error("kein Projekt – erst Projekt anlegen oder zuordnen"); return t.projectId; };
const needCustomer = (t: OpTarget) => { if (!t.customerId) throw new Error("Kunde in HERO unbekannt"); return t.customerId; };

/** Eine Aktion ausfuehren; gibt den Ergebnistext zurueck oder wirft. */
export async function runOp(op: HeroOp, t: OpTarget, api: HeroOpsApi): Promise<string> {
  const problem = checkFields(op);
  if (problem) throw new Error(problem);
  const f = op.fields;
  const knownContact = async () => {
    const list = await api.customerContacts(needCustomer(t));
    const c = list.find((x) => x.id === op.contactId);
    if (!c) throw new Error("der Kontakt gehört nicht zu diesem Kunden");
    return { c, list };
  };
  switch (op.op) {
    case "ansprechpartner_anlegen": {
      const customerId = needCustomer(t);
      const list = await api.customerContacts(customerId);
      const dup = f.email ? list.find((c) => c.email && c.email.toLowerCase() === f.email.toLowerCase()) : null;
      if (dup) return `${dup.name} (${f.email}) gibt es beim Kunden schon – nicht doppelt angelegt`;
      await api.createContactPerson(customerId, {
        title: f.salutation ?? null, first_name: f.first_name ?? null, last_name: f.last_name ?? f.email ?? null, email: f.email ?? null,
        phone_home: f.phone ?? null, phone_mobile: f.mobile ?? null, position: f.position ?? null,
      });
      return describeOp(op);
    }
    case "kontakt_aendern": {
      await knownContact();
      const patch: Record<string, unknown> = {};
      if (f.email) patch.email = f.email;
      if (f.phone) patch.phone_home = f.phone;
      if (f.mobile) patch.phone_mobile = f.mobile;
      if (f.position) patch.position = f.position;
      if (f.street || f.zip || f.city) patch.address = { street: f.street ?? "", zipcode: f.zip ?? "", city: f.city ?? "" };
      await api.updateContact(op.contactId!, patch);
      return describeOp(op);
    }
    case "adresse_anlegen":
      await api.createCustomerAddress(needCustomer(t), f.label ?? "", { street: f.street, zip: f.zip ?? "", city: f.city });
      return describeOp(op);
    case "projekt_aendern": {
      const id = needProject(t);
      if (op.contactId) await knownContact();
      await api.updateProject(id, { ...(f.project_name ? { name: f.project_name } : {}), ...(op.contactId ? { contact_id: op.contactId } : {}) });
      return describeOp(op);
    }
    case "status_setzen":
      if (!op.stepId || !t.allowedStepIds.includes(op.stepId)) throw new Error("Schritt gehört nicht zum Projektablauf");
      await api.updateProject(needProject(t), { step_id: op.stepId });
      return describeOp(op);
    case "mitarbeiter_zuweisen":
      if (!op.userId || !t.allowedUserIds.includes(op.userId)) throw new Error("bitte einen Mitarbeiter wählen");
      await api.assignUsers(needProject(t), [op.userId]);
      return describeOp(op);
    case "aufgabe_anlegen":
      if (op.userId && !t.allowedUserIds.includes(op.userId)) throw new Error("unbekannter Mitarbeiter");
      await api.createTask({
        title: f.title, comment: f.note ?? null, target_user_id: op.userId, target_project_match_id: t.projectId,
        // Nur ein Tag: Mittag „Ortszeit“ (HERO rechnet ohne Zeitzone, siehe toHeroTime) – faellt nie auf den Vortag.
        due_date: f.due_date ? `${f.due_date}T12:00:00+00:00` : null,
      });
      return describeOp(op);
    case "logbuch_notiz":
      await api.addLogbook(needProject(t), `📝 ${f.note} (Mail-Assistent, Anweisung)`);
      return describeOp(op);
  }
}

/** Plan-Aktionen aus dem Client pruefen: nur bekannte Arten und Felder, IDs als Zahlen. */
export function sanitizeOps(raw: unknown): HeroOp[] {
  if (!Array.isArray(raw)) return [];
  const out: HeroOp[] = [];
  for (const o of raw.slice(0, MAX_OPS)) {
    if (!o || typeof o !== "object" || !OP_KINDS.includes((o as any).op)) continue;
    const op = (o as any).op as OpKind;
    const fields: Record<string, string> = {};
    for (const f of OP_FIELDS[op]) {
      const v = (o as any).fields?.[f];
      if (v != null && String(v).trim()) fields[f] = String(v).trim().slice(0, f === "note" ? 2000 : 200);
    }
    const num = (v: unknown) => (Number(v) > 0 ? Number(v) : null);
    const s = (v: unknown) => (v == null ? null : String(v).slice(0, 200));
    out.push({
      op, fields, contactId: num((o as any).contactId), contactName: s((o as any).contactName),
      userId: num((o as any).userId), personName: s((o as any).personName), stepId: num((o as any).stepId), stepName: s((o as any).stepName),
    });
  }
  return out;
}
