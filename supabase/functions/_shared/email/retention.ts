// Aufbewahrung: Anhang-Dateien ueber die Storage-API loeschen, danach Mailtexte und Protokolle in SQL
// (public.email_retention). Direkt auf storage.objects loeschen geht nicht – Supabase sperrt das per Trigger
// (storage.protect_delete), dann bricht die ganze SQL-Funktion ab.

export interface RetentionDeps {
  /** Anhaenge, deren Mail aelter als die Frist ist und deren Datei noch liegt. */
  due(limit: number): Promise<{ id: string; storage_path: string }[]>;
  /** Dateien im Bucket loeschen; wirft bei Fehler. */
  remove(paths: string[]): Promise<void>;
  /** storage_path der geloeschten Dateien leeren. */
  clear(ids: string[]): Promise<void>;
  /** Mailtexte, HTML-Ansicht und alte Protokolle (SQL). */
  finish(): Promise<void>;
}

export const RETENTION_BATCH = 100;
const MAX_BATCHES = 20;

export async function runRetention(deps: RetentionDeps, batch = RETENTION_BATCH): Promise<{ files: number; more: boolean }> {
  let files = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const rows = await deps.due(batch);
    if (!rows.length) {
      await deps.finish();
      return { files, more: false };
    }
    // Erst die Dateien, dann die Verweise: schlaegt das Loeschen fehl, bleibt der Verweis und der naechste Lauf versucht es erneut.
    await deps.remove(rows.map((r) => r.storage_path));
    await deps.clear(rows.map((r) => r.id));
    files += rows.length;
  }
  // Sehr viel auf einmal faellig: Rest beim naechsten Lauf; Texte trotzdem schon kuerzen.
  await deps.finish();
  return { files, more: true };
}
