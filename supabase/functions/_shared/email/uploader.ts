// Anhaenge aus dem privaten Storage nach HERO hochladen (Stufe „Automatisch" der Anhaenge).

import * as H from "./hero.ts";
import type { UploadItem } from "./attachments.ts";

export const ATTACHMENT_BUCKET = "email-attachments";

export function storageDownloader(sb: any) {
  return async (path: string): Promise<Uint8Array> => {
    const { data, error } = await sb.storage.from(ATTACHMENT_BUCKET).download(path);
    if (error || !data) throw new Error(`Anhang nicht lesbar: ${error?.message ?? "leer"}`);
    return new Uint8Array(await data.arrayBuffer());
  };
}

export function directUploader(sb: any, apiKey: string) {
  const download = storageDownloader(sb);
  return {
    async upload(projectId: number, items: UploadItem[], messageId: string): Promise<{ uploaded: number; failed: string[] }> {
      const { data } = await sb.from("email_attachments").select("id, filename, mime, storage_path")
        .eq("message_id", messageId).in("id", items.map((i) => i.attachmentId)).not("storage_path", "is", null);
      const byId = new Map<string, any>((data || []).map((r: any) => [r.id, r]));
      let uploaded = 0;
      const failed: string[] = [];
      for (const i of items) {
        const f = byId.get(i.attachmentId);
        if (!f) { failed.push(`${i.filename}: nicht gefunden`); continue; }
        try {
          const r = await H.uploadDocument(apiKey, projectId, { bytes: await download(f.storage_path), filename: f.filename, mime: f.mime }, i.documentTypeId);
          await sb.from("email_attachments").update({ hero_file_upload_id: r.uploadId, hero_uploaded_at: new Date().toISOString() }).eq("id", f.id);
          uploaded++;
        } catch (e) {
          failed.push(`${i.filename}: ${(e as Error).message}`.slice(0, 160));
        }
      }
      return { uploaded, failed };
    },
  };
}
