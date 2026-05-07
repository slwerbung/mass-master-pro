import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ImagePlus, X, Loader2, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CompanyHeader } from "@/components/CompanyHeader";
import { PrivacyLink } from "@/components/PrivacyLink";

// Public-facing form for customers to request vehicle lettering. Submits
// via the submit-vehicle-request edge function, which:
//  - matches the email against HERO contacts (if HERO is active)
//  - creates a project (and HERO project_match) when a match is found
//  - asks for signup details when no match - we render those inline as a
//    second step rather than redirecting away
//
// Field config is loaded from vehicle_field_config so what's asked here
// always mirrors what the admin has set up in the app.

interface VehicleFieldConfig {
  field_key: string;
  field_label: string;
  is_active: boolean;
  is_required: boolean;
  sort_order: number;
}

const VehicleInquiry = () => {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ projectNumber: string } | null>(null);
  const [needsSignup, setNeedsSignup] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hasAttempted, setHasAttempted] = useState(false);

  // Field configs come from the same table the app uses, so when admin
  // adds/removes a field there it shows up here automatically.
  const [fieldConfigs, setFieldConfigs] = useState<VehicleFieldConfig[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  // Email + signup fields (lastName + email mandatory; rest optional)
  const [email, setEmail] = useState("");
  const [salutation, setSalutation] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [legalForm, setLegalForm] = useState("");
  const [phone, setPhone] = useState("");
  const [mobile, setMobile] = useState("");
  const [street, setStreet] = useState("");
  const [zip, setZip] = useState("");
  const [city, setCity] = useState("");

  const [consent, setConsent] = useState(false);
  // Honeypot - hidden field, real users never touch it. Bots fill all fields.
  const [website, setWebsite] = useState("");

  // Images: stored as { dataUrl, filename } pairs. Compressed in browser
  // before being submitted so the payload doesn't blow up.
  const [images, setImages] = useState<{ dataUrl: string; filename: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const MAX_IMAGES = 10;

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("vehicle_field_config")
        .select("field_key, field_label, is_active, is_required, sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      setFieldConfigs((data || []) as VehicleFieldConfig[]);
    })();
  }, []);

  // ---- Validation ----
  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!email.trim()) e.email = "Bitte E-Mail eingeben";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) e.email = "Keine gültige E-Mail-Adresse";
    if (!consent) e.consent = "Bitte der Datenschutzerklärung zustimmen";
    // Required-flagged fields from vehicle_field_config. Picking these
    // up automatically means the admin can flip a field's is_required in
    // settings and the public form respects it without a code change.
    for (const f of fieldConfigs) {
      if (f.is_required && !(fieldValues[f.field_key] || "").trim()) {
        e[`field-${f.field_key}`] = `Bitte ${f.field_label} eingeben`;
      }
    }
    if (needsSignup) {
      if (!lastName.trim()) e.lastName = "Bitte Nachname eingeben";
      if (!phone.trim() && !mobile.trim()) e.phone = "Bitte mindestens eine Telefonnummer eingeben";
      // Address is mandatory for new contacts because HERO's Lead API
      // refuses to create contacts without a postal address ("Fehlende
      // Postleitzahl"). Existing customers don't need this since we re-
      // use their stored HERO address.
      if (!street.trim()) e.street = "Bitte Straße eingeben";
      if (!zip.trim()) e.zip = "Bitte Postleitzahl eingeben";
      if (!city.trim()) e.city = "Bitte Ort eingeben";
    }
    return e;
  };

  // Live re-validation after first submit attempt
  useEffect(() => {
    if (!hasAttempted) return;
    setErrors(validate());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, lastName, phone, mobile, street, zip, city, consent, needsSignup, hasAttempted, fieldValues, fieldConfigs]);

  // ---- Image handling ----
  const compressImage = async (file: File): Promise<string> => {
    // Browser-side compression to ~1600px max side, JPEG quality 0.85.
    // Keeps payload reasonable for mobile uploads (5-10 MB phone photos
    // become ~300-500 KB).
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const maxSide = 1600;
          let w = img.width;
          let h = img.height;
          if (w > maxSide || h > maxSide) {
            if (w > h) { h = (h / w) * maxSide; w = maxSide; }
            else       { w = (w / h) * maxSide; h = maxSide; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.85));
        };
        img.onerror = reject;
        img.src = reader.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const newImages: typeof images = [];
    for (const file of Array.from(e.target.files)) {
      if (images.length + newImages.length >= MAX_IMAGES) {
        toast.warning(`Maximal ${MAX_IMAGES} Bilder`);
        break;
      }
      try {
        const dataUrl = await compressImage(file);
        newImages.push({ dataUrl, filename: file.name });
      } catch {
        toast.error(`Bild konnte nicht verarbeitet werden: ${file.name}`);
      }
    }
    setImages(prev => [...prev, ...newImages]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeImage = (idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx));
  };

  // ---- Submit ----
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setHasAttempted(true);
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length > 0) {
      const firstBad = Object.keys(v)[0];
      const el = document.getElementById(firstBad);
      if (el) { el.focus(); el.scrollIntoView({ behavior: "smooth", block: "center" }); }
      return;
    }

    setSubmitting(true);
    try {
      const payload: any = {
        email: email.trim(),
        vehicleFields: fieldValues,
        images,
        website,
      };
      if (needsSignup) {
        payload.signupData = {
          salutation: salutation.trim() || undefined,
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim(),
          companyName: companyName.trim() || undefined,
          legalForm: legalForm.trim() || undefined,
          phone: phone.trim() || undefined,
          mobile: mobile.trim() || undefined,
          street: street.trim() || undefined,
          zip: zip.trim() || undefined,
          city: city.trim() || undefined,
        };
      }

      const { data, error } = await supabase.functions.invoke("submit-vehicle-request", {
        body: payload,
      });

      if (error) throw error;
      if (!data?.ok && data?.needs_signup) {
        // First submit, no HERO match - reveal the signup fields
        setNeedsSignup(true);
        toast.info("Bitte ergänzen Sie Ihre Kontaktdaten, damit wir die Anfrage zuordnen können.");
        // Scroll to first new field
        setTimeout(() => {
          const el = document.getElementById("lastName");
          if (el) { el.focus(); el.scrollIntoView({ behavior: "smooth", block: "center" }); }
        }, 100);
        return;
      }
      if (!data?.ok) {
        toast.error(data?.error || "Fehler beim Senden");
        return;
      }
      setSubmitted({ projectNumber: data.project_number });
    } catch (err: any) {
      toast.error("Fehler: " + (err.message || String(err)));
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Success view ----
  if (submitted) {
    return (
      <div className="min-h-screen bg-muted/30">
        <CompanyHeader />
        <div className="flex items-center justify-center p-4 pt-12">
          <Card className="max-w-lg w-full">
            <CardContent className="pt-8 pb-8 text-center space-y-4">
              <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto" />
              <h2 className="text-2xl font-bold">Anfrage erhalten</h2>
              <p className="text-muted-foreground">
                Vielen Dank! Ihre Anfrage wurde übermittelt und unter der Projektnummer
                <strong> {submitted.projectNumber}</strong> registriert.
              </p>
              <p className="text-sm text-muted-foreground">
                Wir melden uns zeitnah bei Ihnen unter der angegebenen E-Mail-Adresse.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <CompanyHeader />
      <div className="py-8 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-2">Anfrage Fahrzeugbeschriftung</h1>
            <p className="text-muted-foreground">
              Schicken Sie uns die Daten zu Ihrem Fahrzeug — wir melden uns zur Beratung.
            </p>
          </div>

        <Card>
          <CardHeader>
            <CardTitle>Ihre Anfrage</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Honeypot - hidden via CSS, real users won't see/fill */}
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={e => setWebsite(e.target.value)}
                style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
                aria-hidden="true"
              />

              <div className="space-y-2">
                <Label htmlFor="email">E-Mail *</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  aria-invalid={!!errors.email}
                  className={errors.email ? "border-red-500 focus-visible:ring-red-500" : ""}
                />
                {errors.email && <p className="text-sm text-red-600">{errors.email}</p>}
              </div>

              {/* Dynamic vehicle fields */}
              {fieldConfigs.length > 0 && (
                <div className="space-y-4 pt-2">
                  <h3 className="font-medium">Fahrzeug-Daten</h3>
                  {fieldConfigs.map(f => {
                    const errKey = `field-${f.field_key}`;
                    const fieldErr = errors[errKey];
                    return (
                      <div key={f.field_key} className="space-y-2">
                        <Label htmlFor={errKey}>
                          {f.field_label}{f.is_required && " *"}
                        </Label>
                        <Input
                          id={errKey}
                          value={fieldValues[f.field_key] || ""}
                          onChange={e => setFieldValues(p => ({ ...p, [f.field_key]: e.target.value }))}
                          required={f.is_required}
                          aria-invalid={!!fieldErr}
                          className={fieldErr ? "border-red-500 focus-visible:ring-red-500" : ""}
                        />
                        {fieldErr && <p className="text-sm text-red-600">{fieldErr}</p>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Image upload */}
              <div className="space-y-2 pt-2">
                <Label>Bilder Ihres Fahrzeugs (max. {MAX_IMAGES})</Label>
                <div className="flex flex-wrap gap-2">
                  {images.map((img, i) => (
                    <div key={i} className="relative w-24 h-24 rounded-lg overflow-hidden border bg-muted">
                      <img src={img.dataUrl} alt={img.filename} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        className="absolute top-0.5 right-0.5 bg-background/80 rounded-full p-0.5 hover:bg-background"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {images.length < MAX_IMAGES && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-24 h-24 rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center text-muted-foreground hover:text-primary transition-colors"
                    >
                      <ImagePlus className="h-6 w-6 mb-1" />
                      <span className="text-xs">Hinzufügen</span>
                    </button>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleImageSelect}
                />
              </div>

              {/* Signup fields - shown only when HERO didn't match */}
              {needsSignup && (
                <div className="space-y-4 pt-4 border-t">
                  <div>
                    <h3 className="font-medium">Ihre Kontaktdaten</h3>
                    <p className="text-sm text-muted-foreground">
                      Wir konnten Sie nicht in unserer Datenbank finden. Bitte ergänzen Sie kurz Ihre Daten.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="salutation">Anrede</Label>
                      <Input id="salutation" value={salutation} onChange={e => setSalutation(e.target.value)} placeholder="Herr / Frau" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="firstName">Vorname</Label>
                      <Input id="firstName" value={firstName} onChange={e => setFirstName(e.target.value)} autoComplete="given-name" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Nachname *</Label>
                      <Input
                        id="lastName"
                        value={lastName}
                        onChange={e => setLastName(e.target.value)}
                        autoComplete="family-name"
                        aria-invalid={!!errors.lastName}
                        className={errors.lastName ? "border-red-500" : ""}
                      />
                      {errors.lastName && <p className="text-sm text-red-600">{errors.lastName}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="companyName">Firma (falls gewerblich)</Label>
                      <Input id="companyName" value={companyName} onChange={e => setCompanyName(e.target.value)} autoComplete="organization" />
                    </div>
                    {companyName.trim() && (
                      <div className="space-y-2">
                        <Label htmlFor="legalForm">Rechtsform</Label>
                        <Input id="legalForm" value={legalForm} onChange={e => setLegalForm(e.target.value)} placeholder="z.B. GmbH" />
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="phone">Telefon</Label>
                      <Input
                        id="phone"
                        type="tel"
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        autoComplete="tel"
                        aria-invalid={!!errors.phone}
                        className={errors.phone ? "border-red-500" : ""}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="mobile">Mobil</Label>
                      <Input id="mobile" type="tel" value={mobile} onChange={e => setMobile(e.target.value)} autoComplete="tel" />
                    </div>
                    {errors.phone && <p className="text-sm text-red-600 sm:col-span-2 -mt-3">{errors.phone}</p>}
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="street">Straße &amp; Hausnummer *</Label>
                      <Input
                        id="street"
                        value={street}
                        onChange={e => setStreet(e.target.value)}
                        autoComplete="street-address"
                        required
                        aria-invalid={!!errors.street}
                        className={errors.street ? "border-red-500" : ""}
                      />
                      {errors.street && <p className="text-sm text-red-600">{errors.street}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="zip">PLZ *</Label>
                      <Input
                        id="zip"
                        value={zip}
                        onChange={e => setZip(e.target.value)}
                        autoComplete="postal-code"
                        inputMode="numeric"
                        required
                        aria-invalid={!!errors.zip}
                        className={errors.zip ? "border-red-500" : ""}
                      />
                      {errors.zip && <p className="text-sm text-red-600">{errors.zip}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="city">Ort *</Label>
                      <Input
                        id="city"
                        value={city}
                        onChange={e => setCity(e.target.value)}
                        autoComplete="address-level2"
                        required
                        aria-invalid={!!errors.city}
                        className={errors.city ? "border-red-500" : ""}
                      />
                      {errors.city && <p className="text-sm text-red-600">{errors.city}</p>}
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-2 border-t">
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="consent"
                    checked={consent}
                    onCheckedChange={c => setConsent(!!c)}
                    aria-invalid={!!errors.consent}
                    className={errors.consent ? "border-red-500 data-[state=unchecked]:border-red-500" : ""}
                  />
                  <Label htmlFor="consent" className="text-sm leading-relaxed cursor-pointer">
                    Ich habe die <PrivacyLink /> gelesen und bin mit der Verarbeitung meiner Daten einverstanden. *
                  </Label>
                </div>
                {errors.consent && <p className="text-sm text-red-600 mt-2">{errors.consent}</p>}
              </div>

              <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {submitting ? "Wird gesendet..." : "Anfrage senden"}
              </Button>
            </form>
          </CardContent>
        </Card>
        </div>
      </div>
    </div>
  );
};

export default VehicleInquiry;
