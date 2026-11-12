// Prüfmodus (Spec C): gemeinsame Typen für Standorte und Fahrzeuglayouts.
import type { Markup, MediaRef } from "@/lib/markup";

export interface ReviewComment {
  id: string;
  parent_id?: string | null;
  message: string;
  author_name: string;
  author_type?: string | null;          // 'employee' | 'customer'
  author_customer_id?: string | null;
  status?: string | null;               // 'open' | 'done' (nur Top-Level)
  created_at: string;
  markup?: Markup | null;
  media_ref?: MediaRef | null;
  legacy?: boolean;
}

/** Eine prüfbare Datei: Druck-PDF, Foto oder Fahrzeuglayout (Bild/PDF). storagePath = Dateiversion. */
export interface ReviewFile { kind: "pdf" | "image"; storagePath: string; url: string; name: string }

/** Spec D1: eine Dateiversion (v1, v2, …). Ältere Versionen: ansehen und antworten ja, neu markieren nein. */
export interface ReviewVersion {
  version: number;
  current: boolean;
  uploadedAt?: string | null;
  uploadedBy?: string | null;
  note?: string | null;
  files: ReviewFile[];
}

export interface ReviewCreateInput { message: string; parentId?: string; markup?: Markup; mediaRef?: MediaRef }

/** Schmale Datenquelle: Standort×Kunde, Standort×Mitarbeiter, Fahrzeug×Kunde, Fahrzeug×Mitarbeiter (sources.ts). */
export interface ReviewSource {
  kind: "location" | "vehicle";
  viewerSide: "customer" | "employee";
  /** Dateien der aktuellen Ansicht (aktuelle Version + Fotos ohne Version) */
  files: ReviewFile[];
  /** Spec D1: alle Versionen der versionierten Dateien (neueste zuerst); fehlt = keine Versionswahl */
  versions?: ReviewVersion[];
  list(): Promise<ReviewComment[]>;
  create(input: ReviewCreateInput): Promise<ReviewComment | null>;
  update(id: string, patch: { message?: string; markup?: Markup }): Promise<void>;
  remove(id: string): Promise<void>;
  /** nur Mitarbeiter */
  toggle?(id: string, status: "open" | "done"): Promise<void>;
  /** Realtime; gibt die Abmeldung zurück */
  subscribe?(onChange: () => void): () => void;
  /** Eigene, offene Kommentare darf man ändern/löschen */
  isOwn(c: ReviewComment): boolean;
}

export const isTopLevel = (c: ReviewComment) => !c.parent_id;
export const isOpenTop = (c: ReviewComment) => !c.parent_id && !c.legacy && (c.status ?? "open") !== "done";
