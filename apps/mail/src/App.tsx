import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { Spinner } from "@/components/ui";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Decide from "@/pages/Decide";
import Messages from "@/pages/Messages";
import MessageDetail from "@/pages/MessageDetail";
import Settings from "@/pages/Settings";
import Compose from "@/pages/Compose";
import Topics from "@/pages/Topics";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Klick auf eine Benachrichtigung bei offener App: dorthin wechseln und frisch laden.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== "open") return;
      qc.invalidateQueries();
      navigate(String(e.data.url || "/"));
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [navigate, qc]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return <div className="flex h-screen items-center justify-center"><Spinner /></div>;
  }
  if (!session) return <Login />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Decide />} />
        <Route path="/themen" element={<Topics />} />
        <Route path="/mails" element={<Messages />} />
        <Route path="/mails/:id" element={<MessageDetail />} />
        <Route path="/verfassen" element={<Compose />} />
        <Route path="/einstellungen/*" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
