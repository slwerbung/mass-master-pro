// Die vier Datenquellen des Prüfmodus (Spec C). Standorte: Kunde über customer-data, Mitarbeiter über location-feedback
// (beide prüfen Markierung und Dateibezug serverseitig). Fahrzeuglayouts: Kunde und Mitarbeiter direkt per Supabase-Session
// (RLS); validateMarkup läuft vorher im Client, DB-Constraint + Trigger fangen den Rest ab.
import { supabase } from "@/integrations/supabase/client";
import { getSession } from "@/lib/session";
import { validateMarkup, type Markup } from "@/lib/markup";
import type { ReviewComment, ReviewCreateInput, ReviewFile, ReviewSource, ReviewVersion } from "./types";

type Client = typeof supabase;

/** Fehlermeldung des Servers aus einer Function-Antwort holen (auch bei HTTP 4xx). */
async function invokeFn(sb: Client, fn: string, body: Record<string, unknown>): Promise<any> {
  const { data, error } = await sb.functions.invoke(fn, { body });
  if (error) {
    const msg = await (error as any)?.context?.json?.().then((b: any) => b?.error).catch(() => null);
    throw new Error(msg || data?.error || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

function checkMarkup(input: ReviewCreateInput): Markup | undefined {
  if (!input.markup) return undefined;
  const r = validateMarkup(input.markup);
  if (r.ok === false) throw new Error(r.error);
  return r.markup;
}

function realtime(sb: Client, table: string, filter: string, onChange: () => void): () => void {
  const ch = (sb as any).channel(`review-${table}-${filter}-${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "*", schema: "public", table, filter }, () => onChange())
    .subscribe();
  return () => { (sb as any).removeChannel(ch); };
}

const sortByTime = (xs: ReviewComment[]) => [...xs].sort((a, b) => a.created_at.localeCompare(b.created_at));

export function locationCustomerSource(o: {
  locationId: string; assignmentId: string; files: ReviewFile[]; versions?: ReviewVersion[]; customerId: string; authorName: string; sb?: Client;
}): ReviewSource {
  const sb = o.sb ?? supabase;
  const base = () => ({ customerToken: getSession()?.authToken, assignmentId: o.assignmentId, locationId: o.locationId });
  return {
    kind: "location", viewerSide: "customer", files: o.files, versions: o.versions,
    async list() {
      const { data, error } = await (sb as any).from("location_feedback").select("*").eq("location_id", o.locationId).order("created_at");
      if (error) throw new Error(error.message);
      return sortByTime(data || []);
    },
    async create(input) {
      const markup = checkMarkup(input);
      const d = await invokeFn(sb, "customer-data", {
        action: "create_feedback", ...base(), authorName: o.authorName, message: input.message,
        parentId: input.parentId, markup, mediaRef: markup ? input.mediaRef : undefined,
      });
      return d?.feedback ?? null;
    },
    async update(id, patch) {
      const markup = patch.markup ? checkMarkup({ message: "", markup: patch.markup }) : undefined;
      await invokeFn(sb, "customer-data", { action: "update_feedback", ...base(), feedbackId: id, message: patch.message, markup });
    },
    async remove(id) {
      await invokeFn(sb, "customer-data", { action: "delete_feedback", ...base(), feedbackId: id });
    },
    subscribe: (cb) => realtime(sb, "location_feedback", `location_id=eq.${o.locationId}`, cb),
    isOwn: (c) => c.author_type !== "employee" && !c.legacy && c.author_customer_id === o.customerId,
  };
}

export function locationEmployeeSource(o: { locationId: string; files: ReviewFile[]; versions?: ReviewVersion[]; authorName: string; sb?: Client }): ReviewSource {
  const sb = o.sb ?? supabase;
  const call = (action: string, extra: Record<string, unknown> = {}) =>
    invokeFn(sb, "location-feedback", { token: getSession()?.authToken, action, locationId: o.locationId, ...extra });
  return {
    kind: "location", viewerSide: "employee", files: o.files, versions: o.versions,
    async list() { return sortByTime(((await call("list"))?.messages || []) as ReviewComment[]); },
    async create(input) {
      const markup = checkMarkup(input);
      const d = await call("send", { message: input.message, name: o.authorName, parentId: input.parentId, markup, mediaRef: markup ? input.mediaRef : undefined });
      return d?.message ?? null;
    },
    async update(id, patch) {
      if (!patch.markup) throw new Error("Nur die Markierung ist änderbar.");
      await call("update_markup", { id, markup: checkMarkup({ message: "", markup: patch.markup }), message: patch.message });
    },
    async remove(id) { await call("delete", { id }); },
    async toggle(id, status) { await call("toggle", { id, status }); },
    // Mitarbeiter lesen nicht direkt (RLS) – nach jeder eigenen Änderung lädt der Viewer neu.
    isOwn: (c) => c.author_type === "employee",
  };
}

export function vehicleCustomerSource(o: {
  projectId: string; files: ReviewFile[]; versions?: ReviewVersion[]; customerId: string | null; authorName: string; sb?: Client;
}): ReviewSource {
  const sb = o.sb ?? supabase;
  const t = () => (sb as any).from("vehicle_layout_feedback");
  return {
    kind: "vehicle", viewerSide: "customer", files: o.files, versions: o.versions,
    async list() {
      const { data, error } = await t().select("*").eq("project_id", o.projectId).order("created_at");
      if (error) throw new Error(error.message);
      return sortByTime(data || []);
    },
    async create(input) {
      const markup = checkMarkup(input);
      const { data, error } = await t().insert({
        project_id: o.projectId, message: input.message.trim().slice(0, 5000), author_name: o.authorName,
        author_customer_id: o.customerId, author_type: "customer", status: "open",
        parent_id: input.parentId ?? null, markup: input.parentId ? null : markup ?? null,
        media_ref: input.parentId || !markup ? null : input.mediaRef ?? null,
      }).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    async update(id, patch) {
      const row: Record<string, unknown> = {};
      if (patch.message !== undefined) row.message = patch.message.trim().slice(0, 5000);
      if (patch.markup) row.markup = checkMarkup({ message: "", markup: patch.markup });
      const { error } = await t().update(row).eq("id", id).eq("status", "open");
      if (error) throw new Error(error.message);
    },
    async remove(id) {
      const { error } = await t().delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    subscribe: (cb) => realtime(sb, "vehicle_layout_feedback", `project_id=eq.${o.projectId}`, cb),
    isOwn: (c) => c.author_type !== "employee" && !!o.customerId && c.author_customer_id === o.customerId,
  };
}

export function vehicleEmployeeSource(o: { projectId: string; files: ReviewFile[]; versions?: ReviewVersion[]; authorName: string; sb?: Client }): ReviewSource {
  const sb = o.sb ?? supabase;
  const t = () => (sb as any).from("vehicle_layout_feedback");
  return {
    kind: "vehicle", viewerSide: "employee", files: o.files, versions: o.versions,
    async list() {
      const { data, error } = await t().select("*").eq("project_id", o.projectId).order("created_at");
      if (error) throw new Error(error.message);
      return sortByTime(data || []);
    },
    async create(input) {
      const markup = checkMarkup(input);
      const { data, error } = await t().insert({
        project_id: o.projectId, message: input.message.trim().slice(0, 5000), author_name: o.authorName,
        author_customer_id: null, author_type: "employee", status: "open",
        parent_id: input.parentId ?? null, markup: input.parentId ? null : markup ?? null,
        media_ref: input.parentId || !markup ? null : input.mediaRef ?? null,
      }).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    async update(id, patch) {
      const row: Record<string, unknown> = {};
      if (patch.message !== undefined) row.message = patch.message.trim().slice(0, 5000);
      if (patch.markup) row.markup = checkMarkup({ message: "", markup: patch.markup });
      const { error } = await t().update(row).eq("id", id);
      if (error) throw new Error(error.message);
    },
    async remove(id) {
      const { error } = await t().delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    async toggle(id, status) {
      const { error } = await t().update({ status, resolved_at: status === "done" ? new Date().toISOString() : null }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    subscribe: (cb) => realtime(sb, "vehicle_layout_feedback", `project_id=eq.${o.projectId}`, cb),
    isOwn: (c) => c.author_type === "employee",
  };
}
