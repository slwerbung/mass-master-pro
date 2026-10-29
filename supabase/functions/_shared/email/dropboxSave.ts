// Anhaenge einer Mail per Klick in den Projektordner der Firmen-Dropbox legen.
//
// Der Projektordner ist derselbe, den die Dropbox-Automation beim Anlegen eines HERO-Projekts baut
// (`_shared/automations.ts`): Basis-Pfad -> (Buchstabe) -> Kundenordner -> „{projektnr} {projektname}“ -> Unterordner.
// Gesucht wird in dieser Reihenfolge: gemerkter Pfad (dropbox_synced) -> Ordner im Kundenordner, der mit der
// Projektnummer beginnt -> nach Muster neu (wird dann mit der Unterordner-Vorlage angelegt).
// Hochgeladen wird nur hinzu (mode add, autorename) – nie etwas ueberschrieben oder geloescht.

import { buildName, normalizePath, resolveCustomerFolder, sanitizeSegment, type DropboxSettings } from "../dropbox.ts";

export interface DropboxProject { id: number; nr: string; name: string; customerId: number | null; customerName: string }

export interface DropboxApi {
  listFolders(path: string): Promise<{ name: string; path: string }[]>;
  ensureTree(path: string, subfolders: string[]): Promise<{ ok: boolean; error?: string }>;
  upload(path: string, bytes: Uint8Array): Promise<{ path: string }>;
}

export interface ProjectFolder {
  path: string;
  /** gemerkt | im Kundenordner gefunden | wird neu angelegt */
  source: "gemerkt" | "gefunden" | "neu";
}

/** Ordner im Kundenordner, der mit der Projektnummer beginnt („WER-753 Bikepark“, auch „WER-753_…“). */
export function matchProjectFolder(folders: { name: string; path: string }[], nr: string): { name: string; path: string } | null {
  const n = String(nr || "").trim().toLowerCase();
  if (!n) return null;
  return folders.find((f) => {
    const name = f.name.trim().toLowerCase();
    return name === n || (name.startsWith(n) && !/[0-9a-z]/.test(name.charAt(n.length)));
  }) ?? null;
}

/** Unterordner relativ zum Projektordner; leer = Projektordner selbst. Nur Ordner aus der Vorlage oder leer. */
export function subfolderPath(projectPath: string, sub: string, allowed: string[]): string {
  const rel = String(sub || "").split("/").map(sanitizeSegment).filter(Boolean).join("/");
  if (!rel) return projectPath;
  const ok = allowed.map((a) => a.split("/").map(sanitizeSegment).filter(Boolean).join("/"));
  if (!ok.includes(rel)) throw new Error(`Unbekannter Unterordner „${sub}“.`);
  return `${projectPath}/${rel}`;
}

/** Dropbox-API-Arg steht im HTTP-Header: Nicht-ASCII (Umlaute im Pfad) muss als \uXXXX kodiert sein. */
export function dropboxApiArg(o: unknown): string {
  return JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export async function findProjectFolder(
  sb: any, token: string, settings: DropboxSettings, p: DropboxProject, api: DropboxApi,
): Promise<ProjectFolder> {
  const { data: known } = await sb.from("dropbox_synced").select("dropbox_path").eq("kind", "project").eq("hero_id", p.id).maybeSingle();
  if (known?.dropbox_path) return { path: String(known.dropbox_path), source: "gemerkt" };
  const customer = await resolveCustomerFolder(sb, token, settings, { customerName: p.customerName, heroCustomerId: p.customerId });
  if (customer.matched !== "new") {
    const hit = matchProjectFolder(await api.listFolders(customer.path), p.nr);
    if (hit?.path) return { path: hit.path, source: "gefunden" };
  }
  const folder = buildName(settings.projectPattern, { projektnr: p.nr, projektname: p.name, kunde: p.customerName });
  return { path: normalizePath(`${customer.path}/${folder}`), source: "neu" };
}

export interface SaveFile { name: string; bytes: Uint8Array }

/** Ordner sicherstellen, Dateien hochladen, Pfad fuer das Projekt merken. Gibt die tatsaechlichen Pfade zurueck. */
export async function saveToProjectFolder(
  sb: any, settings: DropboxSettings, p: DropboxProject, folder: ProjectFolder, sub: string, files: SaveFile[], api: DropboxApi,
): Promise<{ folder: string; files: string[] }> {
  const target = subfolderPath(folder.path, sub, settings.subfolders);
  // Neuer Projektordner: mit der Vorlage anlegen (wie die Automation); sonst nur den Zielordner sicherstellen.
  const tree = folder.source === "neu"
    ? await api.ensureTree(folder.path, settings.subfolders)
    : await api.ensureTree(target, []);
  if (!tree.ok) throw new Error(`Dropbox-Ordner: ${tree.error ?? "unbekannter Fehler"}`);
  if (folder.source === "neu" && target !== folder.path) {
    const t2 = await api.ensureTree(target, []);
    if (!t2.ok) throw new Error(`Dropbox-Ordner: ${t2.error ?? "unbekannter Fehler"}`);
  }
  const out: string[] = [];
  for (const f of files) {
    const r = await api.upload(`${target}/${sanitizeSegment(f.name) || "Anhang"}`, f.bytes);
    out.push(r.path);
  }
  if (folder.source !== "gemerkt") {
    await sb.from("dropbox_synced").upsert({ kind: "project", hero_id: p.id, dropbox_path: folder.path }, { onConflict: "kind,hero_id" });
  }
  return { folder: target, files: out };
}
