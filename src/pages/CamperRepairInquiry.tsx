import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ImagePlus, X, Loader2, CheckCircle2, Plus, CalendarClock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CompanyHeader } from "@/components/CompanyHeader";
import { FileDropZone, dropToChange } from "@/components/FileDropZone";
import { formatPlate, isValidPlate } from "@/lib/licensePlate";

// Public form for camper repair shops that need a repair lettering
// ("Reparaturbeschriftung"). Deliberately smaller than /fahrzeug-anfrage:
// only Kennzeichen, Hersteller, Modell + email, images optional. We come by
// for the detailed survey at the vehicle afterwards, so the success view
// announces an appointment instead of offering layout/design next steps.
//
// Submits via submit-vehicle-request with inquiryType "wohnmobil_reparatur".
// Email matching (exact address, else a known company domain behind the @)
// and the signup fallback are the same as in the vehicle form.

const MAX_IMAGES = 10;

type RepairField = "kennzeichen" | "hersteller" | "modell";

const CamperRepairInquiry = () => {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ projectNumber: string; plate: string } | null>(null);
  const [needsSignup, setNeedsSignup] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hasAttempted, setHasAttempted] = useState(false);

  const [email, setEmail] = useState("");
  const [fields, setFields] = useState<Record<RepairField, string>>({ kennzeichen: "", hersteller: "", modell: "" });

  // Signup fields - only asked when HERO doesn't know the email or its domain
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

  const [images, setImages] = useState<{ dataUrl: string; filename: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setField = (key: RepairField, value: string) => setFields(p => ({ ...p, [key]: value }));

  // ---- Validation ----
  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!email.trim()) e.email = "Bitte E-Mail eingeben";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) e.email = "Keine gültige E-Mail-Adresse";

    const plate = fields.kennzeichen.trim();
    if (!plate) e.kennzeichen = "Bitte Kennzeichen eingeben";
    else if (!isValidPlate(plate)) e.kennzeichen = "Bitte im Format XX-XX 1234 eingeben";
    if (!fields.hersteller.trim()) e.hersteller = "Bitte Hersteller eingeben";
    if (!fields.modell.trim()) e.modell = "Bitte Modell eingeben";

    if (needsSignup) {
      if (!lastName.trim()) e.lastName = "Bitte Nachname eingeben";
      if (!phone.trim() && !mobile.trim()) e.phone = "Bitte mindestens eine Telefonnummer eingeben";
      // HERO's Lead API refuses new contacts without a postal address.
      if (!street.trim()) e.street = "Bitte Straße eingeben";
      if (!zip.trim()) e.zip = "Bitte Postleitzahl eingeben";
      if (!city.trim()) e.city = "Bitte Ort eingeben";
    }
    if (!consent) e.consent = "Bitte der Datenschutzerklärung zustimmen";
    return e;
  };

  // Live re-validation after first submit attempt
  useEffect(() => {
    if (!hasAttempted) return;
    setErrors(validate());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, fields, lastName, phone, mobile, street, zip, city, consent, needsSignup, hasAttempted]);

  // ---- Image handling (same compression as the vehicle form) ----
  const compressImage = async (file: File): Promise<string> => {
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
      const el = document.getElementById(Object.keys(v)[0]);
      if (el) { el.focus(); el.scrollIntoView({ behavior: "smooth", block: "center" }); }
      return;
    }

    setSubmitting(true);
    try {
      const payload: any = {
        inquiryType: "wohnmobil_reparatur",
        email: email.trim(),
        repairFields: {
          kennzeichen: fields.kennzeichen.trim(),
          hersteller: fields.hersteller.trim(),
          modell: fields.modell.trim(),
        },
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

      const { data, error } = await supabase.functions.invoke("submit-vehicle-request", { body: payload });
      if (error) throw error;
      if (!data?.ok && data?.needs_signup) {
        setNeedsSignup(true);
        toast.info("Bitte ergänzen Sie Ihre Kontaktdaten, damit wir die Anfrage zuordnen können.");
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
      setSubmitted({ projectNumber: data.project_number, plate: fields.kennzeichen.trim() });
      window.scrollTo({ top: 0 });
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
          <CardContent className="pt-8 pb-8 space-y-5">
            <div className="text-center space-y-3">
              <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto" />
              <h2 className="text-2xl font-bold">Auftrag erhalten</h2>
              <p className="text-muted-foreground">
                Vielen Dank! Die Reparaturbeschriftung für <strong>{submitted.plate}</strong> ist
                unter der Projektnummer <strong>{submitted.projectNumber}</strong> bei uns eingegangen.
              </p>
            </div>

            <div className="rounded-lg border bg-muted/40 p-4 flex gap-3">
              <CalendarClock className="h-6 w-6 text-primary shrink-0 mt-0.5" />
              <div className="space-y-1 text-sm">
                <p className="font-semibold">Wie geht es weiter?</p>
                <p className="text-muted-foreground">
                  Wir kommen für die detaillierte Abnahme direkt bei Ihnen am Fahrzeug vorbei.
                  Dafür melden wir uns mit einem Terminvorschlag – in der Regel noch am selben Tag.
                </p>
              </div>
            </div>

            <div className="border-t pt-5 space-y-3">
              <Button
                variant="outline"
                className="w-full min-h-16 h-auto py-3 justify-start gap-3 text-left"
                onClick={() => {
                  // Email + contact data stay filled in - same shop, next vehicle.
                  setSubmitted(null);
                  setFields({ kennzeichen: "", hersteller: "", modell: "" });
                  setImages([]);
                  setHasAttempted(false);
                  setErrors({});
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                <Plus className="h-6 w-6 text-primary shrink-0" />
                <div className="min-w-0 flex-1 whitespace-normal">
                  <div className="font-semibold break-words">WEITERES WOHNMOBIL EINREICHEN</div>
                  <div className="text-xs text-muted-foreground break-words">Noch ein Fahrzeug für eine Reparaturbeschriftung anmelden</div>
                </div>
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => navigate("/")}>
                Zur Startseite
              </Button>
            </div>
          </CardContent>
        </Card>
        </div>
      </div>
    );
  }

  const fieldInput = (key: RepairField, label: string, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="space-y-2">
      <Label htmlFor={key}>{label} *</Label>
      <Input
        id={key}
        value={fields[key]}
        onChange={e => setField(key, key === "kennzeichen" ? formatPlate(e.target.value) : e.target.value)}
        required
        aria-invalid={!!errors[key]}
        className={errors[key] ? "border-red-500 focus-visible:ring-red-500" : ""}
        {...extra}
      />
      {key === "kennzeichen" && !errors[key] && (
        <p className="text-xs text-muted-foreground">Format: XX-XX 1234</p>
      )}
      {errors[key] && <p className="text-sm text-red-600">{errors[key]}</p>}
    </div>
  );

  return (
    <div className="min-h-screen bg-muted/30">
      <CompanyHeader />
      <div className="max-w-2xl mx-auto py-8 px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Wohnmobil-Reparaturbeschriftung</h1>
          <p className="text-muted-foreground">
            Kennzeichen, Hersteller und Modell genügen – die Details nehmen wir vor Ort am Fahrzeug auf.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Ihr Auftrag</CardTitle>
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

              <div className="space-y-4 pt-2">
                <h3 className="font-medium">Fahrzeug</h3>
                {fieldInput("kennzeichen", "Kennzeichen", {
                  placeholder: "XX-XX 1234",
                  autoCapitalize: "characters",
                  maxLength: 12,
                })}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {fieldInput("hersteller", "Hersteller", { placeholder: "z.B. Hymer" })}
                  {fieldInput("modell", "Modell", { placeholder: "z.B. B-Klasse MasterLine" })}
                </div>
              </div>

              {/* Images - optional here, the survey happens on site */}
              <FileDropZone accept="image/*" multiple onFiles={dropToChange(handleImageSelect)} label="Bilder hier ablegen" className="space-y-2 pt-2">
                <Label>Bilder (optional, max. {MAX_IMAGES})</Label>
                <p className="text-xs text-muted-foreground">
                  Hilfreich sind Fotos der beschädigten Stelle und der Beschriftung drumherum.
                </p>
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
                <p className="hidden sm:block text-xs text-muted-foreground">Bilder können auch direkt hierher gezogen werden.</p>
              </FileDropZone>

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
                      <Label htmlFor="companyName">Firma</Label>
                      <Input id="companyName" value={companyName} onChange={e => setCompanyName(e.target.value)} autoComplete="organization" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="legalForm">Rechtsform</Label>
                      <Input id="legalForm" value={legalForm} onChange={e => setLegalForm(e.target.value)} placeholder="z.B. GmbH" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="salutation">Anrede</Label>
                      <Input id="salutation" value={salutation} onChange={e => setSalutation(e.target.value)} placeholder="Herr / Frau" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="firstName">Vorname</Label>
                      <Input id="firstName" value={firstName} onChange={e => setFirstName(e.target.value)} autoComplete="given-name" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Nachname Ansprechpartner *</Label>
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
                    Ich habe die <a href="https://www.slwerbung.de/datenschutz" target="_blank" rel="noreferrer" className="underline text-primary">Datenschutzerklärung</a> gelesen und bin mit der Verarbeitung meiner Daten einverstanden. *
                  </Label>
                </div>
                {errors.consent && <p className="text-sm text-red-600 mt-2">{errors.consent}</p>}
              </div>

              <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {submitting ? "Wird gesendet..." : "Auftrag senden"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CamperRepairInquiry;
