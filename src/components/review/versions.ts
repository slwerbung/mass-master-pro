// Spec D1: Versionen für den Prüfmodus aus den Tabellenzeilen bauen (reine Funktionen, getestet).
import { groupVersions, type VersionedRow } from "@/lib/fileVersions";
import type { ReviewFile, ReviewVersion } from "./types";

/** Zeilen (location_pdfs / vehicle_layouts) → Versionen mit Dateien; Dateien ohne Link werden weggelassen. */
export function buildReviewVersions(
  rows: VersionedRow[], urlFor: (path: string) => string | null | undefined, kindOf: (row: VersionedRow) => "pdf" | "image" | null,
): ReviewVersion[] {
  return groupVersions(rows).map((g) => {
    const first = g.files[0];
    return {
      version: g.version, current: g.current,
      uploadedAt: first?.uploaded_at ?? null, uploadedBy: first?.uploaded_by ?? null, note: first?.version_note ?? null,
      files: g.files.flatMap((r): ReviewFile[] => {
        const kind = kindOf(r);
        const url = urlFor(r.storage_path);
        return kind && url ? [{ kind, storagePath: r.storage_path, url, name: r.file_name }] : [];
      }),
    };
  });
}

/** Version, zu der eine Datei gehört (für „Klick wechselt zur Version“). */
export function versionOfPath(versions: ReviewVersion[] | undefined, path: string | null | undefined): ReviewVersion | null {
  if (!versions || !path) return null;
  return versions.find((v) => v.files.some((f) => f.storagePath === path)) ?? null;
}

/** „v3 · aktuell · 12.10. · Max“ */
export function versionLabel(v: ReviewVersion): string {
  const date = v.uploadedAt ? new Date(v.uploadedAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) : null;
  return [`v${v.version}`, v.current ? "aktuell" : null, date, v.uploadedBy || null].filter(Boolean).join(" · ");
}
