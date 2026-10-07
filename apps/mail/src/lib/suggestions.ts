import type { Category } from "./shared";

export interface Candidate { id: number; nr: string; name: string; stepName: string | null }

export interface SuggestionMessage {
  id: string; subject: string; from_addr: string; from_name: string; summary: string | null; category: Category | null;
  confidence: number | null; sent_at: string | null; direction: "in" | "out"; hero_project_match_id: number | null;
  has_attachments: boolean;
}

export interface Suggestion {
  id: string;
  type: "create_project" | "link_project" | "log_entry" | "change_step" | "upload_attachments" | "prepare_offer";
  // Der Inhalt ist je nach Art verschieden und wird in der Karte ausgelesen.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  status: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
  created_at: string;
  message: SuggestionMessage;
  attachments: { id: string; filename: string; mime: string; size: number; role: string | null; is_ignored: boolean; url: string | null }[];
}
