import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { Button, Card, CardContent, CardHeader, CardTitle, ErrorBox, Field, Input } from "@/components/ui";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError("Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.");
    setBusy(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader><CardTitle>Mail-Assistent</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <Field label="E-Mail"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <Field label="Passwort"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            {error && <ErrorBox error={error} />}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "…" : "Anmelden"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
