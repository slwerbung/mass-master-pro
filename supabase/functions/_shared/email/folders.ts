// Ordnerplan eines Postfachs: welche Ordner gibt es schon, welche muss der
// Assistent anlegen. Sonderordner (Gesendet, Entwuerfe, Papierkorb) werden ueber
// das IMAP-Kennzeichen erkannt, nie ueber den Namen.

import type { FolderInfo } from "./imap.ts";
import { FOLDER_KEYS, type FolderKey, type FolderMap, type FolderNames } from "./types.ts";

export interface FolderPlan {
  map: FolderMap;
  /** Zielordner, die es noch nicht gibt (volle Pfade, mit Praefix). */
  toCreate: string[];
  warnings: string[];
}

function lastSegment(path: string, delim: string): string {
  const i = delim ? path.lastIndexOf(delim) : -1;
  return i >= 0 ? path.slice(i + 1) : path;
}

/**
 * Manche Server (Cyrus, Courier) legen alles unter „INBOX." ab. Das Praefix wird
 * aus der Lage der Sonderordner abgeleitet: liegt „Sent" unter „INBOX.Sent",
 * liegen auch unsere Ordner unter „INBOX.".
 */
export function detectPrefix(folders: FolderInfo[], delim: string): string {
  const special = folders.find((f) => f.specialUse === "\\Sent" || f.specialUse === "\\Drafts");
  if (!special || !delim) return "";
  const i = special.path.lastIndexOf(delim);
  return i >= 0 ? special.path.slice(0, i + 1) : "";
}

export function planFolders(folders: FolderInfo[], names: FolderNames, delim = "/"): FolderPlan {
  const warnings: string[] = [];
  const pick = (use: string) => folders.find((f) => f.specialUse === use)?.path;
  const inbox = folders.find((f) => f.specialUse === "\\Inbox" || f.path.toUpperCase() === "INBOX")?.path ?? "INBOX";
  const sent = pick("\\Sent");
  const drafts = pick("\\Drafts");
  const trash = pick("\\Trash");
  if (!sent) warnings.push("Kein Gesendet-Ordner erkannt (kein \\Sent-Kennzeichen) – ausgehende Mails koennen nicht protokolliert werden.");
  if (!drafts) warnings.push("Kein Entwuerfe-Ordner erkannt (kein \\Drafts-Kennzeichen) – Antwortentwuerfe sind nicht moeglich.");
  if (!trash) warnings.push("Kein Papierkorb erkannt (kein \\Trash-Kennzeichen) – ueberholte Entwuerfe koennen nicht aufgeraeumt werden.");

  const prefix = detectPrefix(folders, delim);
  const out: Partial<Record<FolderKey, string>> = {};
  const toCreate: string[] = [];
  for (const key of FOLDER_KEYS) {
    const name = names[key];
    const existing = folders.find((f) => f.path === name || f.path === prefix + name || lastSegment(f.path, delim) === name);
    if (existing) out[key] = existing.path;
    else {
      out[key] = prefix + name;
      toCreate.push(prefix + name);
    }
  }
  return { map: { inbox, sent, drafts, trash, folders: out }, toCreate, warnings };
}
