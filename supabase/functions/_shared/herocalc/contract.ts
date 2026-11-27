// Vertrags- und Selbsttest für hero-calc: läuft NUR gegen die Test-Entwürfe in WER-1984 (hart verdrahtet).
// Schlägt der Vertragstest fehl, hat HERO den internen Endpoint (Edit-Seite / ajax_save) geändert.
import { draftHash, assertWritableDraft } from "./guard.ts";
import { overview } from "./overview.ts";
import { round2 } from "./calc.ts";
import { applyCommand } from "./ops.ts";
import { loadPage, runCommand, runUndo, type Ctx } from "./service.ts";

export const PROJECT_MATCH_ID = 12886720; // WER-1984
export const CONTRACT_DOC = 22589010;
export const SELFTEST_DOCS = [22588702, 22589010];
const ALLOWED = new Set(SELFTEST_DOCS);

export interface Step { name: string; ok: boolean; detail: string }
export const allOk = (steps: Step[]) => steps.length > 0 && steps.every((s) => s.ok);

const check = (name: string, ok: boolean, detail = ""): Step => ({ name, ok, detail });
const near = (a: number, b: number) => Math.abs(Number(a) - Number(b)) < 0.0051;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const TOTAL_KEYS = ["base", "net", "time", "wage", "wage_base", "material", "material_base", "sales", "byVat", "vat"];

/** Nur freigegebene Test-Entwürfe in WER-1984, nur Entwürfe. */
async function loadTestDoc(ctx: Ctx, docId: number) {
  if (!ALLOWED.has(docId)) throw new Error(`Dokument ${docId} ist kein freigegebener Testentwurf`);
  const { draft, document } = await loadPage(ctx.apiKey, docId);
  if (Number(document?.project_match_id) !== PROJECT_MATCH_ID) {
    throw new Error(`Dokument ${docId} gehört nicht zu WER-1984 – Test abgebrochen`);
  }
  assertWritableDraft(draft);
  return draft;
}

function single(ov: any) {
  const t = ov.tables;
  if (t.length !== 1 || t[0].services.length !== 1) throw new Error("Testentwurf braucht genau eine Tabelle mit einer Leistung");
  const s = t[0].services[0];
  if (Number(s.sales) > 0) throw new Error("Testentwurf darf keinen Rabatt haben");
  return s;
}

async function restoreAndVerify(ctx: Ctx, doc: number, undoId: number, h0: string, ov0: any, label: string, steps: Step[]) {
  try {
    await runUndo(ctx, doc, undoId, false);
    const back = (await loadPage(ctx.apiKey, doc)).draft;
    const s1 = JSON.stringify(overview(back).summary), s0 = JSON.stringify(ov0.summary);
    steps.push(check(`${label}: rückgängig -> Summen wie vorher`, s1 === s0, s1 === s0 ? "" : `${s1} statt ${s0}`));
    steps.push(check(`${label}: rückgängig -> Daten identisch (Hash)`, (await draftHash(back)) === h0));
  } catch (e) {
    steps.push(check(`${label}: rückgängig`, false, msg(e)));
  }
}

/** Nächtlicher Vertragstest: lesen, ändern, speichern, zurücklesen, rückgängig. */
export async function runContract(ctx: Ctx): Promise<Step[]> {
  const steps: Step[] = [];
  const doc = CONTRACT_DOC;
  try {
    const start = await loadTestDoc(ctx, doc);
    steps.push(check("lesen (Edit-Seite, DocumentStore.draft)", true, `Netto ${start.data.totals.net}`));
    const h0 = await draftHash(start);
    const ov0 = overview(start);
    const svc = single(ov0);
    const q0 = Number(svc.quantity), q1 = q0 === 1 ? 2 : 1;
    const expectedNet = round2((ov0.summary.vk / q0) * q1);
    let undoId: number | undefined;
    try {
      const w: any = await runCommand(ctx, doc, { cmd: "set_quantity", position_uid: svc.uid, quantity: q1 }, false);
      undoId = w.undo_id;
      steps.push(check("schreiben (ajax_save)", w.wrote === true && near(w.after.vk, expectedNet), `Netto ${w.after.vk}, erwartet ${expectedNet}`));
      const back = (await loadPage(ctx.apiKey, doc)).draft;
      steps.push(check("zurücklesen: Menge", Number(overview(back).tables[0].services[0].quantity) === q1));
      steps.push(check("zurücklesen: Netto/total_price/value", near(back.data.totals.net, expectedNet) && near(back.data.total_price, expectedNet) && near(back.value, expectedNet),
        `net ${back.data.totals.net}, total_price ${back.data.total_price}, value ${back.value}`));
      const tt = back.data.items[0].totals, dt = back.data.totals;
      const diff = TOTAL_KEYS.filter((k) => JSON.stringify(tt?.[k]) !== JSON.stringify(dt[k]));
      steps.push(check("zurücklesen: table.totals == data.totals", diff.length === 0, diff.join(", ")));
    } catch (e) {
      steps.push(check("schreiben/zurücklesen", false, msg(e)));
    } finally {
      if (undoId !== undefined) await restoreAndVerify(ctx, doc, undoId, h0, ov0, "vertrag", steps);
    }
  } catch (e) {
    steps.push(check("vorbereitung", false, msg(e)));
  }
  return steps;
}

/** Live-Selbsttest (Nachbesserung Abschnitt 2 und 3) auf den Testentwürfen. */
export async function runSelftest(ctx: Ctx, docs: number[] = SELFTEST_DOCS): Promise<Step[]> {
  const steps: Step[] = [];

  // A) table.totals nach Lohnänderung (+30 min), je Testentwurf
  for (const doc of docs) {
    try {
      const start = await loadTestDoc(ctx, doc);
      const h0 = await draftHash(start);
      const ov0 = overview(start);
      const svc = single(ov0);
      const wage = svc.positions.find((p: any) => p.atType === "WageGroup");
      if (!wage) { steps.push(check(`${doc}: table.totals nach Lohnänderung`, true, "übersprungen: keine Lohnzeile")); continue; }
      const t0 = Number(start.data.totals.time);
      let undoId: number | undefined;
      try {
        const w: any = await runCommand(ctx, doc, { cmd: "set_wage_minutes", position_uid: svc.uid, wage_group_id: wage.id, minutes: Number(wage.quantity) + 30 }, false);
        undoId = w.undo_id;
        const back = (await loadPage(ctx.apiKey, doc)).draft;
        const tt = back.data.items[0].totals, dt = back.data.totals;
        const diff = TOTAL_KEYS.filter((k) => JSON.stringify(tt?.[k]) !== JSON.stringify(dt[k]));
        steps.push(check(`${doc}: table.totals == data.totals`, diff.length === 0, diff.join(", ")));
        steps.push(check(`${doc}: Netto = Vorhersage des Dry-Runs`, near(dt.net, w.after.vk), `${dt.net} vs ${w.after.vk}`));
        steps.push(check(`${doc}: Minuten +30 x Menge`, near(dt.time, t0 + 30 * Number(svc.quantity)), `${dt.time}`));
      } catch (e) {
        steps.push(check(`${doc}: Lohnänderung`, false, msg(e)));
      } finally {
        if (undoId !== undefined) await restoreAndVerify(ctx, doc, undoId, h0, ov0, `${doc}`, steps);
      }
    } catch (e) {
      steps.push(check(`${doc}: vorbereitung`, false, msg(e)));
    }
  }

  // B) drei parallele Schreibaufrufe auf demselben Entwurf: genau einer darf durchlaufen
  const doc = CONTRACT_DOC;
  if (docs.includes(doc)) {
    try {
      const start = await loadTestDoc(ctx, doc);
      const h0 = await draftHash(start);
      const ov0 = overview(start);
      const svc = single(ov0);
      const q0 = Number(svc.quantity);
      const res = await Promise.allSettled([1, 2, 3].map((i) =>
        runCommand(ctx, doc, { cmd: "set_quantity", position_uid: svc.uid, quantity: q0 + i }, false)));
      const ok = res.filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled");
      const bad = res.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      steps.push(check("parallel: genau ein Aufruf läuft durch", ok.length === 1 && bad.length === 2, `${ok.length} ok, ${bad.length} abgelehnt`));
      steps.push(check("parallel: Ablehnung mit klarer Meldung", bad.every((b) => /gerade bearbeitet|geändert/.test(msg(b.reason))), bad.map((b) => msg(b.reason)).join(" | ")));
      if (ok.length > 0) {
        // Bei mehr als einem Gewinner (Fehlerfall) zählt die früheste Sicherung = Ausgangsstand
        await restoreAndVerify(ctx, doc, Math.min(...ok.map((r) => Number(r.value.undo_id))), h0, ov0, "parallel", steps);
      } else {
        steps.push(check("parallel: Entwurf unverändert", (await draftHash((await loadPage(ctx.apiKey, doc)).draft)) === h0));
      }
    } catch (e) {
      steps.push(check("parallel", false, msg(e)));
    }
  }
  return steps;
}

/** Rechenfälle im Speicher (kein Schreiben nach HERO): eigener Preis + Rabatt + Menge, Festpreis gesperrt, Bereinigung der Materialzeilen. */
export async function runPureChecks(ctx: Ctx): Promise<Step[]> {
  const steps: Step[] = [];
  try {
    const start = await loadTestDoc(ctx, CONTRACT_DOC);
    single(overview(start));
    const mk = () => structuredClone(start);
    const svcOf = (d: any) => d.data.items.find((t: any) => t.type === "table").items.find((s: any) => s.type !== "title" && s.type !== "text");

    // 1) Eigener Preis 100 + 50,50, Menge 2, Rabatt 10 %: brutto 301,00, Rabatt 30,10, netto 270,90
    const a = mk(); const sa = svcOf(a);
    sa.is_custom_price = true; sa.custom_material_price = 100; sa.custom_wage_price = 50.5; sa.quantity = 2; sa.sales = 10;
    const ra = applyCommand(a, { cmd: "recalc" });
    steps.push(check("rechnen: eigener Preis 100+50,50, Menge 2, Rabatt 10 % -> Netto 270,90", near(ra.after.netto, 270.9), `Netto ${ra.after.netto}`));

    // 2) Festpreis bleibt gesperrt
    const b = mk(); svcOf(b).is_fixed_net_price = true;
    let blocked = false;
    try { applyCommand(b, { cmd: "recalc" }); } catch (e) { blocked = /Festpreis/.test(msg(e)); }
    steps.push(check("rechnen: Festpreis (is_fixed_net_price) wird abgelehnt", blocked));

    // 3) Eigener Preis ohne Werte wird abgelehnt
    const d = mk(); const sd = svcOf(d); sd.is_custom_price = true; sd.custom_material_price = null; sd.custom_wage_price = undefined;
    let bad = false;
    try { applyCommand(d, { cmd: "recalc" }); } catch (e) { bad = /eigener Preis/.test(msg(e)); }
    steps.push(check("rechnen: eigener Preis ohne Werte wird abgelehnt", bad));

    // 4) Bereinigung: attributes null / file_upload_uuid "" werden repariert
    const e = mk(); const mat = svcOf(e).positions.find((p: any) => p.atType === "SupplyProduct");
    if (!mat) {
      steps.push(check("bereinigen: Materialzeile", true, "übersprungen: keine Materialzeile"));
    } else {
      mat.attributes = null; mat.file_upload_uuid = "";
      const re = applyCommand(e, { cmd: "recalc" });
      const m2 = svcOf(re.draft).positions.find((p: any) => p.atType === "SupplyProduct");
      steps.push(check("bereinigen: attributes/file_upload_uuid auf Standardform", !!(m2.attributes?.stock && m2.attributes?.measurement) && m2.file_upload_uuid === null, JSON.stringify([m2.attributes, m2.file_upload_uuid])));
    }

    // 5) Ausgangsentwurf ohne Änderung: recalc ergibt dieselben Summen wie HERO gespeichert hat
    const same = applyCommand(mk(), { cmd: "recalc" });
    steps.push(check("rechnen: recalc ohne Änderung = von HERO gespeicherte Summen", JSON.stringify(same.before) === JSON.stringify(same.after), `${JSON.stringify(same.before)} vs ${JSON.stringify(same.after)}`));
  } catch (e) {
    steps.push(check("rechnen: vorbereitung", false, msg(e)));
  }
  return steps;
}
