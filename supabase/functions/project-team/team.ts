// Reine Regeln des Projektteams (ohne Datenbank), getestet in team.test.ts.

/** Team aendern: Admin, der Hauptverantwortliche selbst, oder jeder Mitarbeiter, solange es keinen gibt. */
export function canEditTeam(p: { isAdmin: boolean; selfId: string | null; ownerId: string | null }): boolean {
  return p.isAdmin || !p.ownerId || (!!p.selfId && p.selfId === p.ownerId);
}

/**
 * Hauptverantwortung uebergeben: der neue Hauptverantwortliche verlaesst die Mitgliederliste, der bisherige wird
 * Mitglied (damit er das Projekt nicht verliert).
 */
export function ownerChangePlan(oldOwner: string | null, newOwner: string | null): { removeMember: string | null; addMember: string | null } {
  if (oldOwner === newOwner) return { removeMember: null, addMember: null };
  return { removeMember: newOwner, addMember: oldOwner };
}
