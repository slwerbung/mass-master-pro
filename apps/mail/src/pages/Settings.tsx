import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { cn } from "@/lib/utils";
import Accounts from "./settings/Accounts";
import Rules from "./settings/Rules";
import Company from "./settings/Company";
import Ai from "./settings/Ai";
import Log from "./settings/Log";

const tabs = [
  { to: "postfaecher", label: "Postfächer" },
  { to: "regeln", label: "Absenderregeln" },
  { to: "firma", label: "Firma & HERO" },
  { to: "ki", label: "KI" },
  { to: "protokoll", label: "Protokoll" },
];

export default function Settings() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Einstellungen</h1>
      <div className="flex flex-wrap gap-1 border-b">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => cn("-mb-px border-b-2 px-3 py-2 text-sm", isActive ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </NavLink>
        ))}
      </div>
      <Routes>
        <Route index element={<Navigate to="postfaecher" replace />} />
        <Route path="postfaecher" element={<Accounts />} />
        <Route path="regeln" element={<Rules />} />
        <Route path="firma" element={<Company />} />
        <Route path="ki" element={<Ai />} />
        <Route path="protokoll" element={<Log />} />
      </Routes>
    </div>
  );
}
