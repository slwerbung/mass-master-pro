// Bereich „Projekte“: alle Daten ueber die Edge Function `project-api` (Mail-App-Sitzung).
import { invokeFn } from "./api";

export type PCategory = "kunde" | "auftrag" | "termine" | "pflege";

export interface ProjectView {
  heroId: number; stepId: number | null; nr: string; name: string; kunde: string; kundeEmail: string; kundeTelefon: string; ort: string; gewerk: string; stepName: string; days: number; assignees: string[];
}
export type AutopilotMode = "off" | "suggest" | "auto";
export interface FollowupDraft { id: string; to: string; subject: string; body: string; stage: number; error: string | null }
export interface HeroTaskInfo { id: string; kind: string; label: string; checklist: string[]; by: string; mine: boolean; lockedUntil: string | null }
export interface ProjectCard {
  id: string; ruleKey: string; ruleLabel: string; suggestion: string; channel: string; followupDays: number | null; followupReason: string;
  category: PCategory; reasons: { text?: string; days?: number; stepName?: string; messageId?: string | null; subject?: string }; project: ProjectView;
  /** Nachfassen: Autopilot dieser Regel am Projekt (Projekt vor Regel), Override am Projekt, Entwurf. */
  autopilot: AutopilotMode; autopilotOverride: AutopilotMode | null; draft: FollowupDraft | null;
  /** Arbeitsmodus: Karte ist in HERO gesperrt (`in_hero`), offene Aufgabe und Hinweis aus der letzten Rückkehr. */
  state: "open" | "in_hero"; heroTask: HeroTaskInfo | null; hint: string | null;
}
export interface FollowupItem { id: string; dueAt: string; reason: string; stage: number; project: ProjectView }
export interface ProjectList { bundleAfterDays: number; stack: ProjectCard[]; cleanup: ProjectCard[]; followups: FollowupItem[] }
export interface RunInfo { created_at: string; ok: boolean; error: string | null; stats: Record<string, number> }
export interface ProjectOverview {
  shadow: boolean; cards: number; cleanup: number; followups: number; lastSync: RunInfo | null; lastEvaluate: RunInfo | null; now: string; autoSent: number;
}
export interface AutopilotOverview {
  rules: { key: string; label: string; suggestion: string; autopilot: AutopilotMode; active: boolean }[];
  window: { days: number[]; from: number; to: number }; maxPerRun: number; maxPerDay: number; shadow: boolean; autoSentToday: number; autoSentTotal: number;
}
export interface ProjectDetail { project: ProjectView; events: { at: string; text: string }[]; summary: string }

export interface StepSetting { step_id: number; name: string; key: string; target_days: number; excluded: boolean; closeness: number; wip_limit: number | null }
export interface ProjectRule {
  key: string; label: string; category: PCategory; threshold_days: number | null; suggestion: string; channel: string;
  followup_days: number | null; followup_reason: string; autopilot: "off" | "suggest" | "auto"; sort: number; active: boolean;
}
export interface FollowupTemplate { rule_key: string; stage: number; subject: string; body: string }
export interface ProjectSettings {
  steps: StepSetting[]; rules: ProjectRule[]; templates: FollowupTemplate[]; bundleAfterDays: number; writeEnabled: boolean;
  window: { days: number[]; from: number; to: number }; limits: { perRun: number; perDay: number };
  checklists: Record<string, { label: string; items: string[] }>;
}

/** Fluss-Ansicht: je Status Anzahl, Verweildauer und Ampel gegen das WIP-Limit. */
export interface FlowStep {
  stepId: number; name: string; count: number; cards: number; avgDays: number; maxDays: number; targetDays: number; overdue: number;
  excluded: boolean; closeness: number; wipLimit: number | null; signal: "none" | "green" | "amber" | "red";
}
export interface FlowData { steps: FlowStep[]; total: number }

export const papi = <T = unknown>(action: string, params: Record<string, unknown> = {}) => invokeFn<T>("project-api", { action, ...params });

export const CATEGORY_NAMES: Record<PCategory, string> = { kunde: "Kunde", auftrag: "Auftrag", termine: "Termine", pflege: "Pflege" };
export const CATEGORY_STYLE: Record<PCategory, string> = {
  kunde: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
  auftrag: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  termine: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  pflege: "bg-muted text-muted-foreground",
};
export const tageText = (n: number) => (n === 1 ? "1 Tag" : `${n} Tage`);

// ------------------------------------------------------------------ Aktionen (project-action)
export interface ActionResult { ok: true; shadow: boolean; message: string; warnings?: string[]; done?: (number | string)[]; failed?: { heroId?: number; draftId?: string; error: string }[] }
export const pact = <T = ActionResult>(action: string, params: Record<string, unknown> = {}) => invokeFn<T>("project-action", { action, ...params });

export interface StepsInfo { shadow: boolean; current: number | null; steps: { id: number; name: string; key: string }[] }
export interface EventSetup {
  types: { id: string; name: string; durationMinutes: number; gapDays: number; defaultEmployeeId: string | null }[];
  employees: { id: string; name: string }[];
}
export interface EventRow { title: string; date: string; time: string; durationMinutes: number; employeeId: string }
