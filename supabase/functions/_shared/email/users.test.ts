import { describe, expect, it } from "vitest";
import { checkUpdate, parseUserInput } from "./users.ts";

const self = { id: "me" };
const base = { id: null, name: null, email: null, password: null, role: null, active: null, accountIds: null };

describe("Benutzer anlegen/aendern: Eingaben", () => {
  it("Neues Konto braucht Name, E-Mail und Passwort", () => {
    expect(() => parseUserInput({ name: "Anna", email: "anna@x.de" })).toThrow(/Passwort/);
    expect(() => parseUserInput({ name: "Anna", email: "anna", password: "0123456789" })).toThrow(/E-Mail/);
    expect(() => parseUserInput({ name: "Anna", email: "anna@x.de", password: "kurz" })).toThrow(/mindestens/);
    const ok = parseUserInput({ name: " Anna ", email: "Anna@X.de", password: "0123456789", accountIds: ["a1", "a1", ""] });
    expect(ok).toMatchObject({ id: null, name: "Anna", email: "anna@x.de", role: null, accountIds: ["a1"] });
  });

  it("Aendern: fehlende Felder bleiben unveraendert, E-Mail ist fest", () => {
    expect(parseUserInput({ id: "u1", email: "neu@x.de" })).toEqual({ ...base, id: "u1" });
    expect(parseUserInput({ id: "u1", accountIds: [] }).accountIds).toEqual([]);
    expect(() => parseUserInput({ id: "u1", role: "kunde" })).toThrow(/Rolle/);
  });
});

describe("Benutzer aendern: Schutzregeln", () => {
  const user = { id: "u1", role: "mitarbeiter", is_active: true, employee_id: null };
  it("sich selbst nicht aussperren", () => {
    const me = { ...user, id: "me", role: "admin" };
    expect(() => checkUpdate({ ...base, id: "me", role: "mitarbeiter" }, me, self, 3)).toThrow(/eigene Rolle/);
    expect(() => checkUpdate({ ...base, id: "me", active: false }, me, self, 3)).toThrow(/eigene Konto/);
  });

  it("letzter Admin bleibt Admin", () => {
    const other = { ...user, role: "admin" };
    expect(() => checkUpdate({ ...base, id: "u1", role: "mitarbeiter" }, other, self, 1)).toThrow(/mindestens ein aktiver Admin/);
    expect(() => checkUpdate({ ...base, id: "u1", role: "mitarbeiter" }, other, self, 2)).not.toThrow();
  });

  it("CaptFix-Mitarbeiter: Passwort und aktiv nur in CaptFix, Postfaecher hier", () => {
    const cf = { ...user, employee_id: "e1" };
    expect(() => checkUpdate({ ...base, id: "u1", password: "0123456789" }, cf, self, 1)).toThrow(/CaptFix/);
    expect(() => checkUpdate({ ...base, id: "u1", active: false }, cf, self, 1)).toThrow(/CaptFix/);
    expect(() => checkUpdate({ ...base, id: "u1", accountIds: ["a1"] }, cf, self, 1)).not.toThrow();
  });

  it("Kundenkonten sind hier nicht aenderbar", () => {
    expect(() => checkUpdate({ ...base, id: "k" }, { ...user, id: "k", role: "kunde" }, self, 1)).toThrow(/kein Mitarbeiter-Konto/);
  });
});
