import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

// All German legal forms (Rechtsformen), including non-profits and public bodies.
const LEGAL_FORMS = [
  // Kapitalgesellschaften
  "GmbH",
  "UG (haftungsbeschränkt)",
  "AG",
  "KGaA",
  "SE (Europäische Gesellschaft)",
  // Personengesellschaften
  "GbR",
  "OHG",
  "KG",
  "GmbH & Co. KG",
  "Partnerschaftsgesellschaft (PartG)",
  "PartG mbB",
  // Einzelunternehmen & Freiberufler
  "Einzelunternehmen",
  "e.K. (eingetragener Kaufmann)",
  "Freiberufler",
  // Genossenschaften & Vereine
  "eG (eingetragene Genossenschaft)",
  "e.V. (eingetragener Verein)",
  "Verein",
  // Stiftungen & Anstalten
  "Stiftung",
  "rechtsfähige Stiftung",
  "Stiftung bürgerlichen Rechts",
  // Öffentlich
  "Körperschaft des öffentlichen Rechts",
  "Anstalt des öffentlichen Rechts",
  // Privat
  "Privatperson",
  "Sonstige",
];

const SALUTATIONS = ["Herr", "Frau", "Divers", "Keine Angabe"];

// OSM Nominatim address suggestion (free, no key, rate-limited to ~1 req/s)
interface NominatimResult {
  display_name: string;
  address: {
    road?: string;
    house_number?: string;
    postcode?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    suburb?: string;
  };
}

async function searchAddress(query: string): Promise<NominatimResult[]> {
  if (!query.trim() || query.length < 3) return [];
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "de,at,ch");
  url.searchParams.set("limit", "5");
  url.searchParams.set("accept-language", "de");
  try {
    const res = await fetch(url.toString(), {
      headers: {
        // Nominatim usage policy requires an identifying User-Agent.
        // Browsers forbid setting User-Agent explicitly, but Referer is
        // automatically sent and identifies us. We still set Accept to be tidy.
        "Accept": "application/json",
      },
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

const NewCustomerSignup = () => {
  const [formLoadedAt] = useState<number>(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // Track which fields have validation errors. After the first submit
  // attempt, errors update live as the user types (the relevant entry
  // gets cleared when the field becomes valid) so they see the fix
  // take effect immediately instead of having to re-submit to check.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [legalForm, setLegalForm] = useState("");
  const [salutation, setSalutation] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [mobile, setMobile] = useState("");

  const [street, setStreet] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [addressSuggestions, setAddressSuggestions] = useState<NominatimResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const addressDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState(""); // invisible to real users

  // Debounced address search as user types in the street field
  useEffect(() => {
    if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current);
    if (!street || street.length < 3) {
      setAddressSuggestions([]);
      return;
    }
    // 400ms debounce to stay well under Nominatim's 1 req/s policy
    addressDebounceRef.current = setTimeout(async () => {
      setLoadingSuggestions(true);
      // Include city in the query for better results if it's already filled
      const q = city ? `${street}, ${postalCode} ${city}` : street;
      const results = await searchAddress(q);
      setAddressSuggestions(results);
      setLoadingSuggestions(false);
    }, 400);
    return () => {
      if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [street]);

  const pickAddressSuggestion = (s: NominatimResult) => {
    const a = s.address;
    const streetParts = [a.road, a.house_number].filter(Boolean).join(" ");
    if (streetParts) setStreet(streetParts);
    if (a.postcode) setPostalCode(a.postcode);
    const cityName = a.city || a.town || a.village || a.municipality || a.suburb;
    if (cityName) setCity(cityName);
    setShowSuggestions(false);
    setAddressSuggestions([]);
  };

  // Central validator - returns a map of field -> error message.
  // Empty map means the form is valid.
  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!lastName.trim()) e.lastName = "Bitte Nachname eingeben";
    if (!email.trim()) {
      e.email = "Bitte E-Mail eingeben";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      e.email = "Keine gültige E-Mail-Adresse (Beispiel: name@firma.de)";
    }
    if (!phone.trim()) e.phone = "Bitte Telefonnummer eingeben";
    if (!consent) e.consent = "Bitte der Datenschutzerklärung zustimmen";
    return e;
  };

  // After the first submit attempt, re-run validation every time any
  // relevant field changes - this makes errors disappear as the user
  // fixes them, without waiting for another submit click.
  useEffect(() => {
    if (!hasAttemptedSubmit) return;
    setErrors(validate());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastName, email, phone, consent, hasAttemptedSubmit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setHasAttemptedSubmit(true);
    const validationErrors = validate();
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      // Focus the first invalid field so the user is taken right to it -
      // especially helpful on mobile where the user might not see the
      // error without scrolling.
      const firstBadField = Object.keys(validationErrors)[0];
      const el = document.getElementById(firstBadField);
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-new-customer", {
        body: {
          companyName: companyName.trim() || undefined,
          legalForm: legalForm || undefined,
          salutation: salutation || undefined,
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          mobile: mobile.trim() || undefined,
          street: street.trim() || undefined,
          postalCode: postalCode.trim() || undefined,
          city: city.trim() || undefined,
          consent: true,
          honeypot,
          formLoadedAt,
        },
      });
      if (error || data?.error) {
        toast.error(data?.error || "Es gab ein Problem beim Absenden. Bitte versuche es nochmal.");
        return;
      }
      setSubmitted(true);
    } catch {
      toast.error("Verbindungsfehler. Bitte versuche es nochmal.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto" />
            <h1 className="text-2xl font-semibold">Vielen Dank!</h1>
            <p className="text-muted-foreground">
              Ihre Anfrage ist bei uns eingegangen. Wir melden uns in Kürze bei Ihnen.
            </p>
            <p className="text-sm text-muted-foreground pt-4">
              SL Werbung<br />
              <a href="mailto:info@slwerbung.de" className="text-primary hover:underline">info@slwerbung.de</a>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto px-4 py-8 md:py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold mb-2">Neukunden-Anmeldung</h1>
          <p className="text-muted-foreground">
            Schön, dass Sie uns kennenlernen möchten. Bitte füllen Sie das Formular aus – wir melden uns bei Ihnen.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Ihre Daten</CardTitle>
            <CardDescription>Felder mit * sind Pflichtfelder.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Honeypot - hidden from humans but visible to bots */}
              <div
                style={{ position: "absolute", left: "-9999px", top: "-9999px" }}
                aria-hidden="true"
              >
                <label>
                  Website
                  <input
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                  />
                </label>
              </div>

              {/* Firma */}
              <div className="space-y-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Firma</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="companyName">Firmenname</Label>
                    <Input id="companyName" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Muster GmbH" />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="legalForm">Firmierung / Rechtsform</Label>
                    <Select value={legalForm} onValueChange={setLegalForm}>
                      <SelectTrigger id="legalForm"><SelectValue placeholder="Bitte wählen" /></SelectTrigger>
                      <SelectContent>
                        {LEGAL_FORMS.map((form) => (
                          <SelectItem key={form} value={form}>{form}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Ansprechpartner */}
              <div className="space-y-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Ansprechpartner</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="salutation">Anrede</Label>
                    <Select value={salutation} onValueChange={setSalutation}>
                      <SelectTrigger id="salutation"><SelectValue placeholder="Bitte wählen" /></SelectTrigger>
                      <SelectContent>
                        {SALUTATIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="firstName">Vorname</Label>
                    <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Nachname *</Label>
                    <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" required aria-invalid={!!errors.lastName} className={errors.lastName ? "border-red-500 focus-visible:ring-red-500" : ""} />
                    {errors.lastName && <p className="text-sm text-red-600">{errors.lastName}</p>}
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="email">E-Mail *</Label>
                    <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required aria-invalid={!!errors.email} className={errors.email ? "border-red-500 focus-visible:ring-red-500" : ""} />
                    {errors.email && <p className="text-sm text-red-600">{errors.email}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Telefon *</Label>
                    <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" required aria-invalid={!!errors.phone} className={errors.phone ? "border-red-500 focus-visible:ring-red-500" : ""} />
                    {errors.phone && <p className="text-sm text-red-600">{errors.phone}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mobile">Mobil</Label>
                    <Input id="mobile" type="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} autoComplete="tel" />
                  </div>
                </div>
              </div>

              {/* Adresse */}
              <div className="space-y-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Adresse</h2>
                <div className="grid gap-4 sm:grid-cols-[2fr_1fr_2fr]">
                  <div className="space-y-2 sm:col-span-3 relative">
                    <Label htmlFor="street">Straße &amp; Hausnummer</Label>
                    <Input
                      id="street"
                      value={street}
                      onChange={(e) => { setStreet(e.target.value); setShowSuggestions(true); }}
                      onFocus={() => { if (addressSuggestions.length > 0) setShowSuggestions(true); }}
                      onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                      autoComplete="street-address"
                      placeholder="Beispielstraße 12"
                    />
                    {showSuggestions && (addressSuggestions.length > 0 || loadingSuggestions) && (
                      <div className="absolute z-50 w-full mt-1 border rounded-lg shadow-lg bg-background overflow-hidden max-h-72 overflow-y-auto">
                        {loadingSuggestions && (
                          <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" /> Suche Adressen...
                          </div>
                        )}
                        {addressSuggestions.map((s, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); pickAddressSuggestion(s); }}
                            className="w-full text-left px-3 py-2 hover:bg-muted/60 border-b last:border-b-0 text-sm transition-colors"
                          >
                            {s.display_name}
                          </button>
                        ))}
                        <p className="px-3 py-1.5 text-xs text-muted-foreground border-t bg-muted/20">
                          Adressen von OpenStreetMap
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="postalCode">PLZ</Label>
                    <Input id="postalCode" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} autoComplete="postal-code" inputMode="numeric" />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="city">Ort</Label>
                    <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" />
                  </div>
                </div>
              </div>

              {/* DSGVO-Consent */}
              <div className="pt-2 border-t">
                <div className="flex items-start gap-2">
                  <Checkbox id="consent" checked={consent} onCheckedChange={(c) => setConsent(!!c)} aria-invalid={!!errors.consent} className={errors.consent ? "border-red-500 data-[state=unchecked]:border-red-500" : ""} />
                  <Label htmlFor="consent" className="text-sm leading-relaxed cursor-pointer">
                    Ich habe die <a href="https://www.slwerbung.de/datenschutz" target="_blank" rel="noreferrer" className="underline text-primary">Datenschutzerklärung</a> gelesen und bin mit der Verarbeitung meiner Daten einverstanden. *
                  </Label>
                </div>
                {errors.consent && <p className="text-sm text-red-600 mt-2">{errors.consent}</p>}
              </div>

              <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                {submitting ? "Wird gesendet..." : "Absenden"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          SL Werbung · <a href="mailto:info@slwerbung.de" className="hover:underline">info@slwerbung.de</a>
        </p>
      </div>
    </div>
  );
};

export default NewCustomerSignup;
