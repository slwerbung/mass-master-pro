import { describe, expect, it } from "vitest";
import { canEditTeam, ownerChangePlan } from "./team.ts";

describe("Projektteam", () => {
  it("canEditTeam: Admin, Hauptverantwortlicher oder niemand verantwortlich", () => {
    expect(canEditTeam({ isAdmin: true, selfId: null, ownerId: "a" })).toBe(true);
    expect(canEditTeam({ isAdmin: false, selfId: "a", ownerId: "a" })).toBe(true);
    expect(canEditTeam({ isAdmin: false, selfId: "b", ownerId: "a" })).toBe(false);
    expect(canEditTeam({ isAdmin: false, selfId: "b", ownerId: null })).toBe(true);
  });
  it("ownerChangePlan: bisheriger bleibt Mitglied, neuer verlaesst die Liste", () => {
    expect(ownerChangePlan("a", "b")).toEqual({ removeMember: "b", addMember: "a" });
    expect(ownerChangePlan(null, "b")).toEqual({ removeMember: "b", addMember: null });
    expect(ownerChangePlan("a", null)).toEqual({ removeMember: null, addMember: "a" });
    expect(ownerChangePlan("a", "a")).toEqual({ removeMember: null, addMember: null });
  });
});
