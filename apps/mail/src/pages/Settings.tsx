import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import Accounts from "./settings/Accounts";
import Rules from "./settings/Rules";
import Knowledge from "./settings/Knowledge";
import ReferenceDocs from "./settings/ReferenceDocs";
import Company from "./settings/Company";
import Ai from "./settings/Ai";
import Log from "./settings/Log";
import Users from "./settings/Users";
import Notifications from "./settings/Notifications";

const tabs = [
  { to: "benachrichtigungen", label: "Benachrichtigungen", all: true },
  { to: "postfaecher", label: "Postfächer" },
  { to: "benutzer", label: "Benutzer" },
  { to: "wissen", label: "Wissen" },
  { to: "referenz", label: "Referenzwissen" },
  { to: "regeln", label: "Absenderregeln" },
  { to: "firma", label: "Firma & HERO" },
  { to: "ki", label: "KI" },
  { to: "protokoll", label: "Protokoll" },
];

export default function Settings() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ admin: boolean }>("me"), retry: false });
  if (me.isLoading) return null;
  const admin = !!me.data?.admin;
  // Mitarbeiter sehen nur ihre eigenen Benachrichtigungen; der Rest ist Betrieb (Admin).
  const visible = tabs.filter((t) => admin || ("all" in t && t.all));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Einstellungen</h1>
      <div className="flex flex-wrap gap-1 border-b">
        {visible.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => cn("-mb-px border-b-2 px-3 py-2 text-sm", isActive ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </NavLink>
        ))}
      </div>
      <Routes>
        <Route index element={<Navigate to={admin ? "postfaecher" : "benachrichtigungen"} replace />} />
        <Route path="benachrichtigungen" element={<Notifications />} />
        {!admin && <Route path="*" element={<Navigate to="benachrichtigungen" replace />} />}
        {admin && (
          <>
            <Route path="postfaecher" element={<Accounts />} />
            <Route path="benutzer" element={<Users />} />
            <Route path="wissen" element={<Knowledge />} />
            <Route path="referenz" element={<ReferenceDocs />} />
            <Route path="regeln" element={<Rules />} />
            <Route path="firma" element={<Company />} />
            <Route path="ki" element={<Ai />} />
            <Route path="protokoll" element={<Log />} />
          </>
        )}
      </Routes>
    </div>
  );
}
