import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CompanyHeader } from "@/components/CompanyHeader";

/**
 * Built-in Datenschutz page rendered at /datenschutz.
 *
 * Used as the default fallback for the privacy link in customer-facing
 * forms when the admin has not configured an external privacy policy URL.
 * The responsible-party block is filled from app_config (set in the admin
 * area), so each tenant can have a working privacy notice with their own
 * details without writing the page themselves.
 *
 * Important: This page describes only the technical processing performed
 * by the app itself (form submission, database storage, transactional
 * email). If the app is used in contexts beyond what's described here, the
 * tenant must replace this page with their own privacy policy by setting
 * the privacy_policy_url in the admin settings.
 */
type LegalInfo = {
  companyName?: string;
  street?: string;
  zip?: string;
  city?: string;
  email?: string;
  phone?: string;
  representative?: string;
};

const PrivacyPolicy = () => {
  const [info, setInfo] = useState<LegalInfo | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("admin-manage", {
          body: { action: "get_legal_info" },
        });
        setInfo((data?.info as LegalInfo) || {});
      } catch {
        setInfo({});
      }
      setLoaded(true);
    })();
  }, []);

  const hasInfo = !!(info && (info.companyName || info.email || info.street));

  return (
    <div className="min-h-screen bg-background">
      <CompanyHeader />
      <div className="container max-w-3xl mx-auto px-4 py-8 md:py-12 space-y-6">
        <h1 className="text-3xl md:text-4xl font-bold">Datenschutzerklärung</h1>

        {loaded && !hasInfo && (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 p-4 text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              Hinweis: Verantwortliche/r noch nicht hinterlegt
            </p>
            <p className="text-amber-800 dark:text-amber-300 mt-1">
              Der Betreiber dieser Anwendung sollte im Admin-Bereich seine Kontaktdaten als Verantwortliche/r nach Art. 13 DSGVO hinterlegen.
            </p>
          </div>
        )}

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">1. Verantwortliche/r für die Datenverarbeitung</h2>
          {hasInfo ? (
            <div className="text-base leading-relaxed">
              {info?.companyName && <p className="font-medium">{info.companyName}</p>}
              {info?.representative && <p>Vertreten durch: {info.representative}</p>}
              {info?.street && <p>{info.street}</p>}
              {(info?.zip || info?.city) && <p>{[info?.zip, info?.city].filter(Boolean).join(" ")}</p>}
              {info?.email && (
                <p>E-Mail: <a href={`mailto:${info.email}`} className="text-primary underline">{info.email}</a></p>
              )}
              {info?.phone && <p>Telefon: {info.phone}</p>}
            </div>
          ) : (
            <p className="text-muted-foreground">[Wird vom Betreiber im Admin-Bereich hinterlegt]</p>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">2. Welche Daten werden erhoben</h2>
          <p>Bei der Nutzung unserer Online-Formulare erheben wir die Daten, die Sie aktiv eingeben:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Kontaktdaten (Name, E-Mail-Adresse, Telefonnummer)</li>
            <li>Anschrift, sofern angegeben</li>
            <li>Projektbezogene Angaben (Fahrzeugdaten, Standortdaten, Bilder)</li>
            <li>Inhalte Ihrer Anfrage</li>
          </ul>
          <p>Zusätzlich verarbeitet unser Hosting-Anbieter zu technischen Zwecken sogenannte Server-Logfiles (z.&nbsp;B. IP-Adresse, Zeitstempel, abgerufene Seite). Diese werden zur Sicherstellung des Betriebs gespeichert und nach kurzer Zeit gelöscht.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">3. Zweck der Verarbeitung</h2>
          <p>Wir verarbeiten Ihre Daten ausschließlich, um Ihre Anfrage zu bearbeiten, mit Ihnen zu kommunizieren und das angefragte Projekt umzusetzen. Eine Weitergabe an Dritte zu Werbezwecken erfolgt nicht.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">4. Rechtsgrundlage</h2>
          <p>Die Verarbeitung erfolgt auf Grundlage Ihrer Einwilligung (Art.&nbsp;6 Abs.&nbsp;1 lit.&nbsp;a DSGVO) sowie zur Durchführung vorvertraglicher Maßnahmen und zur Erfüllung eines Vertrags (Art.&nbsp;6 Abs.&nbsp;1 lit.&nbsp;b DSGVO).</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">5. Auftragsverarbeiter und Empfänger</h2>
          <p>Zur Bereitstellung dieses Dienstes setzen wir folgende Auftragsverarbeiter ein:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Vercel Inc.</strong>, USA – Hosting der Anwendung</li>
            <li><strong>Supabase Inc.</strong> – Datenbank und Datei-Speicher (Server in Frankfurt, Deutschland)</li>
            <li><strong>Resend Inc.</strong>, USA – Versand von Benachrichtigungs-E-Mails</li>
          </ul>
          <p>Mit allen Anbietern bestehen entsprechende Auftragsverarbeitungs-Verträge bzw. die Übermittlung erfolgt auf Grundlage der EU-Standardvertragsklauseln.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">6. Speicherdauer</h2>
          <p>Wir speichern Ihre Daten nur solange, wie es für die Bearbeitung Ihrer Anfrage und für gesetzliche Aufbewahrungspflichten (z.&nbsp;B. Steuerrecht) erforderlich ist. Danach werden die Daten gelöscht.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">7. Ihre Rechte</h2>
          <p>Sie haben jederzeit das Recht auf:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Auskunft über die zu Ihrer Person gespeicherten Daten (Art.&nbsp;15 DSGVO)</li>
            <li>Berichtigung unrichtiger Daten (Art.&nbsp;16 DSGVO)</li>
            <li>Löschung Ihrer Daten (Art.&nbsp;17 DSGVO)</li>
            <li>Einschränkung der Verarbeitung (Art.&nbsp;18 DSGVO)</li>
            <li>Widerruf erteilter Einwilligungen (Art.&nbsp;7 Abs.&nbsp;3 DSGVO)</li>
            <li>Datenübertragbarkeit (Art.&nbsp;20 DSGVO)</li>
            <li>Beschwerde bei der zuständigen Aufsichtsbehörde (Art.&nbsp;77 DSGVO)</li>
          </ul>
          <p>Zur Ausübung dieser Rechte wenden Sie sich bitte an die oben genannte verantwortliche Stelle.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">8. Cookies</h2>
          <p>Diese Anwendung setzt nur technisch notwendige Cookies (z.&nbsp;B. Sitzungs-Cookie zur Anmeldung) ein. Tracking- oder Marketing-Cookies werden nicht verwendet.</p>
        </section>

        <p className="text-sm text-muted-foreground pt-6 border-t">
          Stand: {new Date().toLocaleDateString("de-DE", { year: "numeric", month: "long" })}
        </p>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
