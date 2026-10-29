// Dropbox-Ablage fuer die Mail-App (email-action `dropbox_targets` / `dropbox_save`): echte Dropbox-Aufrufe.

import { dbxEnsureTree, dbxListFolders, getDropboxAccessToken, loadDropboxSettings } from "../dropbox.ts";
import * as H from "./hero.ts";
import { storageDownloader } from "./uploader.ts";
import { dropboxApiArg, findProjectFolder, saveToProjectFolder, type DropboxApi, type DropboxProject } from "./dropboxSave.ts";

const MAX_FILES = 20;

export function dropboxApi(token: string): DropboxApi {
  return {
    listFolders: (path) => dbxListFolders(token, path),
    ensureTree: (path, subs) => dbxEnsureTree(token, path, subs),
    async upload(path, bytes) {
      const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": dropboxApiArg({ path, mode: "add", autorename: true, mute: false }),
        },
        body: bytes as Uint8Array<ArrayBuffer>,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Dropbox-Upload (HTTP ${res.status}): ${text.slice(0, 200)}`);
      const j = JSON.parse(text);
      return { path: String(j.path_display || path) };
    },
  };
}

async function context(sb: any, key: string | null, messageId: string) {
  const { data: m } = await sb.from("email_messages").select("id, direction, hero_project_match_id, match_info").eq("id", messageId).maybeSingle();
  if (!m) throw new Error("Mail nicht gefunden.");
  const settings = await loadDropboxSettings(sb);
  if (!settings.enabled) throw new Error("Die Dropbox-Anbindung ist aus (CaptFix-Admin → Integrationen).");
  if (!m.hero_project_match_id) throw new Error("Die Mail ist keinem HERO-Projekt zugeordnet – erst zuordnen, dann ablegen.");
  if (!key) throw new Error("HERO ist nicht aktiviert.");
  const p = await H.projectById(key, Number(m.hero_project_match_id));
  if (!p) throw new Error("HERO-Projekt nicht gefunden.");
  const tok = await getDropboxAccessToken(sb);
  if ("error" in tok) throw new Error(tok.error);
  const project: DropboxProject = { id: p.id, nr: p.nr, name: p.name, customerId: p.customerId, customerName: p.customerName };
  return { m, settings, token: tok.token, project };
}

/** Wohin abgelegt wuerde (nur lesen) + die Anhaenge der Mail. */
export async function dropboxTargets(sb: any, key: string | null, messageId: string) {
  const { m, settings, token, project } = await context(sb, key, messageId);
  const folder = await findProjectFolder(sb, token, settings, project, dropboxApi(token));
  const { data: atts } = await sb.from("email_attachments")
    .select("id, filename, mime, size, storage_path, is_ignored, dropbox_path, dropbox_saved_at").eq("message_id", m.id).order("created_at");
  return {
    projectNr: project.nr, projectName: project.name, folder,
    subfolders: settings.subfolders,
    // Was ein Kunde schickt, gehoert in den ersten Unterordner („01 Gelieferte Daten“).
    defaultSubfolder: m.direction === "in" ? settings.subfolders[0] ?? "" : "",
    attachments: (atts || []).map((a: any) => ({
      id: a.id, filename: a.filename, mime: a.mime, size: a.size, ignored: a.is_ignored, stored: !!a.storage_path,
      savedPath: a.dropbox_path ?? null, savedAt: a.dropbox_saved_at ?? null,
    })),
  };
}

export async function dropboxSave(sb: any, key: string | null, messageId: string, attachmentIds: string[], subfolder: string) {
  const ids = [...new Set(attachmentIds.map(String))].slice(0, MAX_FILES);
  if (!ids.length) throw new Error("Keine Datei gewählt.");
  const { m, settings, token, project } = await context(sb, key, messageId);
  const { data: atts } = await sb.from("email_attachments").select("id, filename, storage_path").eq("message_id", m.id).in("id", ids);
  const rows = (atts || []).filter((a: any) => a.storage_path);
  if (rows.length !== ids.length) throw new Error("Mindestens eine Datei ist nicht gespeichert (zu groß oder ausgeblendet) und kann nicht abgelegt werden.");
  const download = storageDownloader(sb);
  const files = [];
  for (const a of rows) files.push({ name: a.filename, bytes: await download(a.storage_path) });
  const api = dropboxApi(token);
  const folder = await findProjectFolder(sb, token, settings, project, api);
  const r = await saveToProjectFolder(sb, settings, project, folder, subfolder, files, api);
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i++) {
    await sb.from("email_attachments").update({ dropbox_path: r.files[i], dropbox_saved_at: now }).eq("id", rows[i].id);
  }
  return { projectNr: project.nr, folder: r.folder, files: r.files, created: folder.source === "neu" };
}
