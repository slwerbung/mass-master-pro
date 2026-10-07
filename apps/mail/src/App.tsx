import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { Spinner } from "@/components/ui";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Decide from "@/pages/Decide";
import Messages from "@/pages/Messages";
import MessageDetail from "@/pages/MessageDetail";
import Settings from "@/pages/Settings";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

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
        <Route path="/mails" element={<Messages />} />
        <Route path="/mails/:id" element={<MessageDetail />} />
        <Route path="/einstellungen/*" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
