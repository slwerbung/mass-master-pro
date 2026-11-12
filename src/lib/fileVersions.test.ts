import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/session", () => ({ getSession: () => ({ name: "Max", authToken: "T" }) }));

import { deleteConfirmText, deleteCurrentVersion, groupVersions, isNewForViewer, safeStorageName, uploadLocationPrintVersion, uploadVehicleLayoutVersion } from "./fileVersions";
import { activeApprovals } from "./approvalEvents";
import { buildReviewVersions, versionLabel, versionOfPath } from "@/components/review/versions";

function client(o: { uploadError?: string; rpcError?: string; rpcData?: any } = {}) {
  const log: string[] = [];
  const removed: string[][] = [];
  const invoked: any[] = [];
  const sb: any = {
    storage: { from: () => ({
      upload: async (path: string) => { log.push(`upload:${path.split("/")[0]}`); return { error: o.uploadError ? { message: o.uploadError } : null }; },
      remove: async (paths: string[]) => { removed.push(paths); log.push("remove"); return { error: null }; },
    }) },
    rpc: async (fn: string, args: any) => { log.push(`rpc:${fn}`); (sb.lastArgs = args); return o.rpcError ? { data: null, error: { message: o.rpcError } } : { data: o.rpcData ?? { version: 2, previous_version: 1, reset: 1, assignments: ["A1", "A2"] }, error: null }; },
    functions: { invoke: async (fn: string, { body }: any) => { invoked.push([fn, body]); return { data: {}, error: null }; } },
  };
  return { sb, log, removed, invoked };
}

describe("Dateiversionen (Spec D1)", () => {
  it("groupVersions: neueste zuerst, aktuelle markiert, mehrere Dateien je Version", () => {
    const g = groupVersions([
      { version: 1, superseded_at: "x", id: "a" }, { version: 2, superseded_at: null, id: "b" }, { version: 2, superseded_at: null, id: "c" },
    ]);
    expect(g.map((v) => [v.version, v.current, v.files.length])).toEqual([[2, true, 2], [1, false, 1]]);
  });

  it("Upload: erst Datei, dann EINE Datenbankfunktion; Freigabe-Reset stösst die Abschluss-Prüfung je Kunde an", async () => {
    const t = client();
    const r = await uploadLocationPrintVersion("L1", [{ blob: new Blob(["x"]), name: "Logo größer (final).pdf" }], { resetApproval: true, note: " neu ", resolveOpen: true }, t.sb);
    expect(t.log).toEqual(["upload:pdfs", "rpc:add_file_version"]);
    expect(t.sb.lastArgs).toMatchObject({ p_kind: "location", p_owner: "L1", p_reset: true, p_note: "neu", p_actor: "Max", p_resolve_open: true });
    expect(t.sb.lastArgs.p_files[0].storage_path).toMatch(/^pdfs\/L1\/\d+_[^/]+_Logo_groesser_final_.pdf$/);
    expect(t.sb.lastArgs.p_files[0].file_name).toBe("Logo größer (final).pdf");
    expect(r).toEqual({ version: 2, previousVersion: 1, reset: 1, assignments: ["A1", "A2"] });
    expect(t.invoked.map(([fn, b]) => [fn, b.assignmentId, b.event])).toEqual([["send-notification", "A1", "completion"], ["send-notification", "A2", "completion"]]);
    expect(t.removed).toEqual([]);
  });

  it("Fehler in der Datenbankfunktion: gerade hochgeladene Datei wird wieder entfernt, Vorversion bleibt", async () => {
    const t = client({ rpcError: "Keine Berechtigung." });
    await expect(uploadVehicleLayoutVersion("P1", new File(["x"], "layout.png", { type: "image/png" }), { resetApproval: false }, t.sb)).rejects.toThrow("Keine Berechtigung.");
    expect(t.log).toEqual(["upload:vehicle-layouts", "rpc:add_file_version", "remove"]);
    expect(t.removed[0][0]).toMatch(/^vehicle-layouts\/P1\//);
    expect(t.invoked).toEqual([]);
  });

  it("Upload-Fehler: keine Datenbankänderung", async () => {
    const t = client({ uploadError: "Bucket voll" });
    await expect(uploadLocationPrintVersion("L1", [{ blob: new Blob(["x"]), name: "a.pdf" }], { resetApproval: true }, t.sb)).rejects.toThrow("Bucket voll");
    expect(t.log).toEqual(["upload:pdfs"]);
  });

  it("deleteCurrentVersion: v2 gelöscht → v1 wieder aktuell, Dateien der v2 entfernt", async () => {
    const t = client({ rpcData: { deleted_version: 2, restored_version: 1, paths: ["pdfs/L1/v2.pdf"] } });
    expect(await deleteCurrentVersion("location", "L1", t.sb)).toEqual({ deleted: 2, restored: 1 });
    expect(t.removed).toEqual([["pdfs/L1/v2.pdf"]]);
    expect(deleteConfirmText(3, 3)).toBe("Version v3 löschen? Die vorige Version wird wieder aktuell.");
    expect(deleteConfirmText(1, 1)).toBe("Datei löschen?");
  });

  it("Dateiname für Storage und „Neu“-Logik", () => {
    expect(safeStorageName("Übersicht Ä (1).pdf")).toBe("Uebersicht_Ae_1_.pdf");
    expect(isNewForViewer("x", 3, 2)).toBe(true);
    expect(isNewForViewer("x", 1, null)).toBe(false);
  });

  it("aktive Freigaben: Reset durch neue Version hebt alle auf, Rücknahme nur die eigene", () => {
    const ev = (id: string, action: any, at: string, assignment_id: string | null = "A", version: number | null = 1) =>
      ({ id, action, version, storage_paths: null, actor_name: id, assignment_id, created_at: at });
    expect(activeApprovals([ev("1", "approve", "1"), ev("2", "approve", "2", "B")]).map((e) => e.id)).toEqual(["2", "1"]);
    expect(activeApprovals([ev("1", "approve", "1"), ev("2", "approve", "2", "B"), ev("3", "revoke", "3", "B")]).map((e) => e.id)).toEqual(["1"]);
    expect(activeApprovals([ev("1", "approve", "1"), ev("2", "reset_new_version", "2", null, 2)])).toEqual([]);
    expect(activeApprovals([ev("1", "approve", "1"), ev("2", "reset_new_version", "2", null, 2), ev("3", "approve", "3", "A", 2)]).map((e) => e.version)).toEqual([2]);
  });

  it("Versionen für den Prüfmodus", () => {
    const rows = [
      { storage_path: "b.pdf", file_name: "b.pdf", version: 2, superseded_at: null, uploaded_at: "2026-10-12T10:00:00Z", uploaded_by: "Max", version_note: "Logo" },
      { storage_path: "a.pdf", file_name: "a.pdf", version: 1, superseded_at: "2026-10-12T10:00:00Z" },
      { storage_path: "z.ai", file_name: "z.ai", version: 1, superseded_at: "2026-10-12T10:00:00Z" },
    ];
    const v = buildReviewVersions(rows, (p) => (p === "z.ai" ? null : `https://x/${p}`), (r) => (r.file_name.endsWith(".pdf") ? "pdf" : null));
    expect(v.map((x) => [x.version, x.current, x.files.map((f) => f.storagePath)])).toEqual([[2, true, ["b.pdf"]], [1, false, ["a.pdf"]]]);
    expect(versionLabel(v[0])).toBe("v2 · aktuell · 12.10. · Max");
    expect(versionOfPath(v, "a.pdf")?.version).toBe(1);
    expect(versionOfPath(v, "weg.pdf")).toBeNull();
  });
});
