// HERO-Anbindung des Mail-Assistenten (GraphQL v9).
//
// Alle Felder und Aufrufe hier stammen aus Abfragen, die in diesem Repo bereits
// produktiv gegen HERO laufen (hero-integration, submit-vehicle-request,
// hero-upload-proxy, booking/hero.ts) bzw. aus der Introspection im HERO-Skill.
// Ein unbekanntes Feld laesst eine GraphQL-Abfrage komplett scheitern – deshalb
// wird nichts „auf Verdacht" mitabgefragt.
//
// Fehler stehen bei HERO im Body (`errors`), nicht im HTTP-Status: sie werden hier
// zu Exceptions. Variablen statt String-Interpolation (nie Fremdtext in die Query).

export const HERO_GRAPHQL = "https://login.hero-software.de/api/external/v9/graphql";
export const HERO_UPLOAD = "https://login.hero-software.de/app/v8/FileUploads/upload";

type F = typeof fetch;

export class HeroError extends Error {}

export async function heroGraphql(
  apiKey: string, query: string, variables: Record<string, unknown> = {}, fetchImpl: F = fetch,
): Promise<any> {
  const resp = await fetchImpl(HERO_GRAPHQL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await resp.text();
  if (!resp.ok) throw new HeroError(`HERO HTTP ${resp.status}: ${text.slice(0, 200)}`);
  let json: any;
  try { json = JSON.parse(text); } catch { throw new HeroError(`HERO lieferte kein JSON: ${text.slice(0, 120)}`); }
  if (json.errors?.length) throw new HeroError(String(json.errors[0]?.message || "HERO GraphQL-Fehler"));
  return json.data;
}

/** HERO-Schluessel aus app_config; null, wenn HERO nicht aktiv ist. */
export async function loadHeroKey(sb: any): Promise<string | null> {
  const { data } = await sb.from("app_config").select("key, value").in("key", ["hero_api_key", "hero_enabled"]);
  const m = new Map((data || []).map((r: any) => [r.key, r.value]));
  const key = m.get("hero_api_key") as string | undefined;
  return key && m.get("hero_enabled") === "true" ? key : null;
}

export interface HeroProject {
  id: number;
  nr: string;
  name: string;
  stepId: number | null;
  stepName: string | null;
  customerId: number | null;
  customerName: string;
}

const PROJECT_FIELDS = `
  id project_nr name
  current_project_match_status { step_id step { name } }
  customer { id first_name last_name company_name }
`;

function customerName(c: any): string {
  if (!c) return "";
  return String(c.company_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || "").trim();
}

export function toProject(pm: any): HeroProject {
  return {
    id: Number(pm.id),
    nr: String(pm.project_nr || ""),
    name: String(pm.name || ""),
    stepId: pm.current_project_match_status?.step_id != null ? Number(pm.current_project_match_status.step_id) : null,
    stepName: pm.current_project_match_status?.step?.name ?? null,
    customerId: pm.customer?.id != null ? Number(pm.customer.id) : null,
    customerName: customerName(pm.customer),
  };
}

/** WER-1234 -> Projekt. `relative_id` trifft exakt (die Zahl ohne Kuerzel). */
export async function projectByNumber(apiKey: string, relativeId: number, fetchImpl: F = fetch): Promise<HeroProject | null> {
  const data = await heroGraphql(apiKey, `query($nr: String) { project_matches(relative_id: $nr) { ${PROJECT_FIELDS} } }`, { nr: String(relativeId) }, fetchImpl);
  const pm = data?.project_matches?.[0];
  return pm?.id ? toProject(pm) : null;
}

export async function projectById(apiKey: string, id: number, fetchImpl: F = fetch): Promise<HeroProject | null> {
  const data = await heroGraphql(apiKey, `query($ids: [Int]) { project_matches(ids: $ids) { ${PROJECT_FIELDS} } }`, { ids: [id] }, fetchImpl);
  const pm = data?.project_matches?.[0];
  return pm?.id ? toProject(pm) : null;
}

/** Projektsuche fuer die Mail-App (Nummer, Name, Kunde). */
export async function searchProjects(apiKey: string, term: string, fetchImpl: F = fetch): Promise<HeroProject[]> {
  const data = await heroGraphql(apiKey, `query($s: String) { project_matches(search: $s, first: 20) { ${PROJECT_FIELDS} } }`, { s: term }, fetchImpl);
  return (data?.project_matches || []).map(toProject);
}

/** Offene Projekte eines Kunden (ohne die ausgeschlossenen Schritte). */
export async function openProjectsOfCustomer(
  apiKey: string, customerId: number, excludedSteps: number[], fetchImpl: F = fetch,
): Promise<HeroProject[]> {
  const data = await heroGraphql(
    apiKey, `query($c: Int) { project_matches(customer_id: $c, first: 50) { ${PROJECT_FIELDS} } }`, { c: customerId }, fetchImpl,
  );
  return (data?.project_matches || [])
    .map(toProject)
    // Es zaehlt nur, was wirklich dem Kunden gehoert (der Filter ist serverseitig, aber wir vertrauen nicht blind).
    .filter((p: HeroProject) => p.customerId === customerId && !(p.stepId != null && excludedSteps.includes(p.stepId)));
}

export interface HeroContact {
  id: number;
  /** Kunde, zu dem der Kontakt gehoert (bei Ansprechpartnern der Firmenkunde). */
  customerId: number;
  name: string;
  email: string;
  isContactPerson: boolean;
}

/** Kontakte mit GENAU dieser E-Mail-Adresse (die HERO-Suche ist Teilstring-Suche, daher nachfiltern). */
export async function contactsByEmail(apiKey: string, email: string, fetchImpl: F = fetch): Promise<HeroContact[]> {
  const q = `query($s: String) {
    contacts(search: $s) { id email is_contact_person parent_customer_id full_name company_name first_name last_name }
  }`;
  const data = await heroGraphql(apiKey, q, { s: email }, fetchImpl);
  const want = email.trim().toLowerCase();
  return (data?.contacts || [])
    .filter((c: any) => String(c.email || "").trim().toLowerCase() === want)
    .map((c: any) => ({
      id: Number(c.id),
      customerId: Number(c.is_contact_person && c.parent_customer_id ? c.parent_customer_id : c.id),
      name: String(c.full_name || c.company_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || "").trim(),
      email: want,
      isContactPerson: !!c.is_contact_person,
    }));
}

/** Logbuch-Eintrag am Projekt. v9: `custom_text` ist Pflicht, kein Titel-Feld. */
export async function addLogbookEntry(apiKey: string, projectMatchId: number, text: string, fetchImpl: F = fetch): Promise<void> {
  await heroGraphql(
    apiKey,
    `mutation($entry: LogbookEntryInput!) { add_logbook_entry(logbook_entry: $entry) { id } }`,
    { entry: { target: "project_match", target_id: projectMatchId, custom_text: text.slice(0, 5000) } },
    fetchImpl,
  );
}

/** Schritt wechseln (Pipeline). Schreibzugriff – nur nach Freigabe aufrufen. */
export async function setStep(apiKey: string, projectMatchId: number, stepId: number, fetchImpl: F = fetch): Promise<void> {
  await heroGraphql(
    apiKey,
    `mutation($pm: ProjectMatchInput) { update_project_match(project_match: $pm) { id } }`,
    { pm: { id: projectMatchId, step_id: stepId } },
    fetchImpl,
  );
}

export interface NewContact {
  salutation?: string | null; first_name?: string | null; last_name?: string | null; company?: string | null;
  email?: string | null; phone?: string | null; street?: string | null; zip?: string | null; city?: string | null;
}

/** Kontakt anlegen oder den vorhandenen mit gleicher E-Mail finden (`findExisting`). */
export async function createContact(apiKey: string, c: NewContact, source: string, fetchImpl: F = fetch): Promise<number> {
  const hasCompany = !!c.company?.trim();
  const contact: Record<string, unknown> = {
    type: hasCompany ? "commercial" : "private",
    is_contact_person: !hasCompany,
    first_name: c.first_name || null,
    last_name: c.last_name || (hasCompany ? null : c.email || "Unbekannt"),
    company_name: c.company || null,
    title: c.salutation || null,
    email: c.email || null,
    phone_home: c.phone || null,
    category: "customer",
    source,
  };
  if (c.street || c.zip || c.city) contact.address = { street: c.street || null, zip: c.zip || null, city: c.city || null };
  const data = await heroGraphql(
    apiKey,
    `mutation Create($contact: CustomerInput, $findExisting: Boolean) { create_contact(contact: $contact, findExisting: $findExisting) { id } }`,
    { contact, findExisting: true },
    fetchImpl,
  );
  const id = Number(data?.create_contact?.id);
  if (!Number.isFinite(id) || id <= 0) throw new HeroError("HERO lieferte keine Kontakt-ID");
  return id;
}

export interface NewProject {
  name: string;
  customerId: number;
  measureId: number | null;
  typeId: number | null;
  stepId: number | null;
  notes: string;
  address?: { street?: string | null; city?: string | null; zip?: string | null } | null;
}

/**
 * Projekt anlegen. Die Form (verschachteltes `project{customer_id, measure_id, address}`,
 * Adresse Pflicht) ist die, die in submit-vehicle-request produktiv laeuft; `type_id` und
 * `step_id` kommen aus der HERO-Introspection. Lehnt HERO die zusaetzlichen Felder ab,
 * wird mit der bewaehrten Minimalform wiederholt (HERO nimmt dann den Startschritt).
 */
export async function createProject(apiKey: string, p: NewProject, fetchImpl: F = fetch): Promise<{ id: number; nr: string }> {
  const mutation = `mutation CreateProject($project_match: ProjectMatchInput) { create_project_match(project_match: $project_match) { id project_nr } }`;
  const base: Record<string, unknown> = {
    name: p.name,
    partner_notes: p.notes,
    project: {
      customer_id: p.customerId,
      ...(p.measureId ? { measure_id: p.measureId } : {}),
      address: { street: p.address?.street || "", city: p.address?.city || "", zipcode: p.address?.zip || "" },
    },
  };
  const full = { ...base, ...(p.typeId ? { type_id: p.typeId } : {}), ...(p.stepId ? { step_id: p.stepId } : {}) };
  let data: any;
  try {
    data = await heroGraphql(apiKey, mutation, { project_match: full }, fetchImpl);
  } catch (e) {
    if (full === base || !/type_id|step_id|unknown|field|ProjectMatchInput/i.test(String((e as Error).message))) throw e;
    data = await heroGraphql(apiKey, mutation, { project_match: base }, fetchImpl);
  }
  const id = Number(data?.create_project_match?.id);
  if (!Number.isFinite(id) || id <= 0) throw new HeroError("HERO lieferte keine Projekt-ID");
  return { id, nr: String(data.create_project_match.project_nr || "") };
}

/** Datei hochladen und als Dokument ans Projekt haengen (Ablauf wie hero-upload-proxy). */
export async function uploadDocument(
  apiKey: string, projectMatchId: number, file: { bytes: Uint8Array; filename: string; mime: string },
  documentTypeId: number, fetchImpl: F = fetch,
): Promise<{ uploadId: string }> {
  const form = new FormData();
  form.append("file", new Blob([file.bytes as BlobPart], { type: file.mime }), file.filename);
  const resp = await fetchImpl(HERO_UPLOAD, { method: "POST", headers: { "x-auth-token": apiKey }, body: form, signal: AbortSignal.timeout(60_000) });
  const text = await resp.text();
  if (!resp.ok) throw new HeroError(`HERO-Upload HTTP ${resp.status}: ${text.slice(0, 200)}`);
  let uuid: string | undefined;
  try {
    const j = JSON.parse(text);
    // Die UUID liegt unter data.uuid, NICHT auf oberster Ebene.
    uuid = j.data?.uuid ?? j.uuid ?? j.file_upload_uuid ?? j.file?.uuid;
  } catch { /* unten */ }
  if (!uuid) throw new HeroError(`Keine UUID in der Upload-Antwort: ${text.slice(0, 200)}`);
  // `target` ist ein Enum-Literal, `document` enthaelt NUR die document_type_id.
  const data = await heroGraphql(
    apiKey,
    `mutation($doc: CustomerDocumentInput!, $uuid: String!, $targetId: Int!) {
       upload_document(document: $doc, file_upload_uuid: $uuid, target: project_match, target_id: $targetId) { id }
     }`,
    { doc: { document_type_id: documentTypeId }, uuid, targetId: projectMatchId },
    fetchImpl,
  );
  return { uploadId: String(data?.upload_document?.id ?? uuid) };
}

/**
 * Kontext fuer Antwortentwuerfe: Dokumente (Angebote mit Nummer und Betrag) und naechster Termin.
 * Jede Teilabfrage ist fuer sich abgesichert – fehlt eine, wird der Entwurf trotzdem geschrieben.
 * (Das Logbuch fliesst nicht ein: die Feldnamen von `project_histories` sind nirgends in diesem Repo belegt.)
 */
export async function projectDraftContext(
  apiKey: string, projectId: number, fetchImpl: F = fetch, now: Date = new Date(),
): Promise<{ projectNr: string; projectName: string; stepName: string | null; offers: { nr: string; type: string; status: string; value: number | null }[]; nextAppointment: { title: string; start: string } | null } | null> {
  const p = await projectById(apiKey, projectId, fetchImpl);
  if (!p) return null;

  let offers: { nr: string; type: string; status: string; value: number | null }[] = [];
  try {
    const d = await heroGraphql(
      apiKey,
      `query($ids: [Int]) { customer_documents(project_match_ids: $ids) { nr value status_name document_type { name } } }`,
      { ids: [projectId] }, fetchImpl,
    );
    offers = (d?.customer_documents || []).slice(0, 8).map((x: any) => ({
      nr: String(x.nr ?? ""), type: String(x.document_type?.name ?? "Dokument"), status: String(x.status_name ?? ""),
      value: x.value != null && Number.isFinite(Number(x.value)) ? Number(x.value) : null,
    }));
  } catch { /* ohne Dokumentliste weiter */ }

  let nextAppointment: { title: string; start: string } | null = null;
  try {
    const end = new Date(now.getTime() + 90 * 86400_000);
    const d = await heroGraphql(
      apiKey,
      `query($s: DateTime, $e: DateTime, $p: Int) { calendar_events(start: $s, end: $e, project_match_id: $p) { title start end } }`,
      { s: now.toISOString(), e: end.toISOString(), p: projectId }, fetchImpl,
    );
    // HERO-Zeit ist Ortszeit mit beliebiger Zonenangabe: nur die ersten 19 Zeichen zaehlen.
    const events = (d?.calendar_events || [])
      .map((x: any) => ({ title: String(x.title || "Termin"), start: String(x.start || "").slice(0, 19).replace("T", " ") }))
      .filter((x: { start: string }) => x.start)
      .sort((a: { start: string }, b: { start: string }) => a.start.localeCompare(b.start));
    nextAppointment = events[0] ?? null;
  } catch { /* ohne Termin weiter */ }

  return { projectNr: p.nr, projectName: p.name, stepName: p.stepName, offers, nextAppointment };
}
