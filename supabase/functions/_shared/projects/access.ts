// Zugriff und Schattenmodus der Projekte-Functions (gemeinsam fuer project-api und project-action).

export interface ProjectUser { role: string; email: string | null }

/** Mitarbeiter sehen Projekte, bei denen sie Bearbeiter sind oder noch niemand zugewiesen ist; Admin sieht alle. */
export const canSee = (u: ProjectUser, p: { assignee_emails: string[] | null }): boolean =>
  u.role === "admin" || !p.assignee_emails?.length || (!!u.email && p.assignee_emails.includes(u.email.toLowerCase()));

/** Schattenmodus: solange projects_write_enabled nicht exakt "true" ist, wird nichts nach HERO geschrieben. */
export async function isShadow(sb: any): Promise<boolean> {
  const { data } = await sb.from("app_config").select("value").eq("key", "projects_write_enabled").maybeSingle();
  return data?.value !== "true";
}
