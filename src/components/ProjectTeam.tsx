import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Star, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getSession } from "@/lib/session";
import { initials, loadEmployees, projectTeam, type ProjectTeamData } from "@/lib/projectTeam";

const NONE = "__none__";

/** Initialen-Kreis (28 px); Hauptverantwortlicher mit Stern. */
export function TeamBadge({ name, owner = false }: { name: string; owner?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-full border border-background bg-primary/10 text-[11px] font-semibold text-primary">
          {initials(name)}
          {owner && <Star className="absolute -right-1 -top-1 h-3 w-3 fill-amber-400 text-amber-500" />}
        </span>
      </TooltipTrigger>
      <TooltipContent>{owner ? `${name} (hauptverantwortlich)` : name}</TooltipContent>
    </Tooltip>
  );
}

/** Team im Projektkopf: Anzeige für alle, Bearbeiten für Admin und Hauptverantwortlichen. */
export default function ProjectTeam({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [team, setTeam] = useState<ProjectTeamData | null>(null);
  const [open, setOpen] = useState(false);
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [owner, setOwner] = useState<string>(NONE);
  const [members, setMembers] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    projectTeam("get", projectId).then((t) => alive && setTeam(t)).catch(() => {});
    return () => { alive = false; };
  }, [projectId]);

  const openDialog = async () => {
    if (!team) return;
    setOwner(team.ownerId ?? NONE);
    setMembers(new Set(team.members.map((m) => m.employeeId)));
    setOpen(true);
    if (!employees.length) setEmployees(await loadEmployees());
  };

  const save = async () => {
    if (!team) return;
    setSaving(true);
    try {
      const newOwner = owner === NONE ? null : owner;
      let cur = team;
      if (newOwner !== cur.ownerId) cur = await projectTeam("set_owner", projectId, newOwner);
      const want = new Set([...members].filter((id) => id !== newOwner));
      const have = new Set(cur.members.map((m) => m.employeeId));
      for (const id of want) if (!have.has(id)) cur = await projectTeam("add_member", projectId, id);
      for (const id of have) if (!want.has(id)) cur = await projectTeam("remove_member", projectId, id);
      cur = await projectTeam("get", projectId);
      setTeam(cur);
      setOpen(false);
      toast.success("Team gespeichert");
      const s = getSession();
      if (s?.role === "employee" && cur.ownerId !== s.id && !cur.members.some((m) => m.employeeId === s.id) && cur.ownerId !== null) {
        toast.info("Du bist nicht mehr im Team");
        navigate("/projects");
      }
    } catch (e: any) {
      toast.error(e?.message || "Team konnte nicht gespeichert werden");
      projectTeam("get", projectId).then(setTeam).catch(() => {});
    } finally {
      setSaving(false);
    }
  };

  if (!team) return null;
  const people = [
    ...(team.ownerId && team.ownerName ? [{ id: team.ownerId, name: team.ownerName, owner: true }] : []),
    ...team.members.map((m) => ({ id: m.employeeId, name: m.name, owner: false })),
  ];
  const ownerValue = owner === NONE ? null : owner;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center gap-1.5">
        <div className="flex -space-x-1.5">
          {people.map((p) => <TeamBadge key={p.id} name={p.name} owner={p.owner} />)}
        </div>
        {!people.length && <span className="text-xs text-muted-foreground">Kein Team</span>}
        {team.canEdit && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={openDialog} title="Projektteam bearbeiten">
            <Users className="mr-1 h-3.5 w-3.5" /> Team
          </Button>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Projektteam</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Hauptverantwortlich</Label>
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger><SelectValue placeholder="Mitarbeiter wählen" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>– niemand –</SelectItem>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Weitere Mitarbeiter</Label>
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
                {employees.filter((e) => e.id !== ownerValue).map((e) => (
                  <label key={e.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent">
                    <Checkbox
                      checked={members.has(e.id)}
                      onCheckedChange={(v) => {
                        const next = new Set(members);
                        if (v) next.add(e.id); else next.delete(e.id);
                        setMembers(next);
                      }}
                    />
                    {e.name}
                  </label>
                ))}
                {!employees.length && <p className="p-1 text-xs text-muted-foreground">Mitarbeiter werden geladen …</p>}
              </div>
              <p className="text-xs text-muted-foreground">Alle im Team sehen das Projekt unter „Meine“ und können es bearbeiten.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Abbrechen</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Speichern …" : "Speichern"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
