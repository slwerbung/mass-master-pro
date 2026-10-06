import { describe, expect, it } from "vitest";
import { detectPrefix, planFolders } from "./folders.ts";
import { DEFAULT_FOLDER_NAMES } from "./types.ts";
import type { FolderInfo } from "./imap.ts";

const f = (path: string, specialUse: string | null = null): FolderInfo => ({ path, name: path, specialUse, flags: [] });

describe("planFolders", () => {
  it("erkennt Sonderordner am Kennzeichen, nicht am Namen", () => {
    const p = planFolders([f("INBOX", "\\Inbox"), f("Gesendete Objekte", "\\Sent"), f("Entwürfe", "\\Drafts"), f("Gelöschte Elemente", "\\Trash")], DEFAULT_FOLDER_NAMES);
    expect(p.map).toMatchObject({ inbox: "INBOX", sent: "Gesendete Objekte", drafts: "Entwürfe", trash: "Gelöschte Elemente" });
    expect(p.warnings).toEqual([]);
  });
  it("legt alle acht Zielordner an, wenn keiner existiert", () => {
    const p = planFolders([f("INBOX", "\\Inbox"), f("Sent", "\\Sent"), f("Drafts", "\\Drafts"), f("Trash", "\\Trash")], DEFAULT_FOLDER_NAMES);
    expect(p.toCreate).toHaveLength(8);
    expect(p.toCreate).toContain("1 Kunden & Projekte");
    expect(p.map.folders!.aussortiert).toBe("9 Aussortiert");
  });
  it("nutzt vorhandene Ordner und legt nur Fehlendes an (idempotent)", () => {
    const have = Object.values(DEFAULT_FOLDER_NAMES).slice(0, 5).map((n) => f(n));
    const p = planFolders([f("INBOX", "\\Inbox"), f("Sent", "\\Sent"), ...have], DEFAULT_FOLDER_NAMES);
    expect(p.toCreate).toEqual(Object.values(DEFAULT_FOLDER_NAMES).slice(5));
  });
  it("beachtet ein INBOX.-Praefix des Servers", () => {
    const folders = [f("INBOX", "\\Inbox"), f("INBOX.Sent", "\\Sent"), f("INBOX.Drafts", "\\Drafts")];
    expect(detectPrefix(folders, ".")).toBe("INBOX.");
    const p = planFolders(folders, DEFAULT_FOLDER_NAMES, ".");
    expect(p.map.folders!.kunden).toBe("INBOX.1 Kunden & Projekte");
    expect(p.toCreate[0]).toBe("INBOX.1 Kunden & Projekte");
  });
  it("kein Praefix, wenn die Sonderordner oben liegen", () => {
    expect(detectPrefix([f("Sent", "\\Sent")], "/")).toBe("");
  });
  it("warnt, wenn Sonderordner fehlen", () => {
    const p = planFolders([f("INBOX")], DEFAULT_FOLDER_NAMES);
    expect(p.warnings).toHaveLength(3);
  });
  it("eigene Ordnernamen aus den Einstellungen", () => {
    const p = planFolders([f("INBOX"), f("Sent", "\\Sent")], { ...DEFAULT_FOLDER_NAMES, kunden: "Kunden" });
    expect(p.map.folders!.kunden).toBe("Kunden");
  });
});
