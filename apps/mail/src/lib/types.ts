import type { Autopilot, Category, MessageStatus } from "./shared";

export interface MessageRow {
  id: string;
  account_id: string;
  thread_id: string | null;
  direction: "in" | "out";
  from_addr: string;
  from_name: string;
  subject: string;
  sent_at: string | null;
  status: MessageStatus;
  category: Category | null;
  confidence: number | null;
  summary: string | null;
  hero_project_match_id: number | null;
  match_method: string | null;
  has_attachments: boolean;
  draft_message_id: string | null;
  current_folder: string | null;
  error: string | null;
  hero_logged_at: string | null;
  beleg_state: "weiterleiten_offen" | "weitergeleitet" | "portal_offen" | "portal_erledigt" | null;
  beleg_vendor: string | null;
  correction_note: string | null;
  trashed_at: string | null;
  /** Beantwortet (aus der Mail-App oder einem anderen Mailprogramm – erkannt an In-Reply-To) */
  answered_at: string | null;
  /** Vom Menschen weitergeleitet (nicht die Beleg-Weiterleitung an Lexware, die ist `forwarded_at`) */
  user_forwarded_at: string | null;
}

export interface Account {
  id: string;
  label: string;
  address: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string | null;
  smtp_port: number;
  username: string;
  has_password: boolean;
  folder_map: { inbox?: string; sent?: string; drafts?: string; trash?: string; folders?: Record<string, string> };
  signature: string;
  autopilot: Autopilot;
  shadow_mode: boolean;
  enabled: boolean;
  backfill: number;
  last_sync_at: string | null;
  last_error: string | null;
}

/** email-send `accounts` */
export interface SendAccount { id: string; label: string; address: string; signatureHtml: string; smtp: boolean; sentFolder: string | null; enabled: boolean }

/** email-send `prepare` */
export interface ComposePrefill {
  accountId: string; to: string[]; cc: string[]; bcc: string[]; subject: string; quoteText: string; hasDraft: boolean; draftText: string | null;
  attachments: { id: string; filename: string; mime: string; size: number; available: boolean; ignored: boolean }[];
}

export interface Overview {
  statusCounts: Record<string, number>;
  openSuggestions: number;
  neuronsToday: number;
  costMonthUsd: number;
  budgetUsd: number | null;
  budgetExceeded: boolean;
}

export interface Run {
  id: string;
  account_id: string | null;
  kind: string;
  started_at: string;
  finished_at: string | null;
  fetched: number;
  processed: number;
  errors: number;
  tokens_in: number;
  tokens_out: number;
  neurons: number;
  note: string | null;
}

export interface Rule { id: string; pattern: string; category: Category; target_folder: string | null; protect: boolean; source: string }

export interface Provider { id: string; name: string; type: "cloudflare" | "anthropic" | "openai"; base_url: string | null; account_id: string | null; enabled: boolean; has_key: boolean }
export interface AiSetting {
  task: string; provider_id: string | null; model: string; fallback_provider_id: string | null; fallback_model: string | null;
  shadow_provider_id: string | null; shadow_model: string | null; on_limit: "ausweichen" | "warten"; daily_neuron_limit: number;
}

export interface KnowledgeRow {
  id: string;
  text: string;
  /** null = gilt fuer alle Mails; sonst Adresse oder @domain */
  from_pattern: string | null;
  source: "manuell" | "korrektur";
  message_id: string | null;
  message_subject: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}
