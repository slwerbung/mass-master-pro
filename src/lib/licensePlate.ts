// German license plate ("Kennzeichen") handling for the vehicle form.
//
// Target format: "XX-XX 1234" — 1-3 letters (Unterscheidungszeichen), dash,
// 1-2 letters (Erkennungsnummer), space, 1-4 digits. Optionally followed by
// an E (Elektro) or H (Historisch) suffix, which are common in practice.

const PLATE_RE = /^[A-ZÄÖÜ]{1,3}-[A-ZÄÖÜ]{1,2} \d{1,4}[EH]?$/;

/** True when the value matches the "XX-XX 1234" format. */
export function isValidPlate(value: string): boolean {
  return PLATE_RE.test(value.trim().toUpperCase());
}

/**
 * Formats free input into "XX-XX 1234" while typing.
 * "wnvs1519" / "wn vs 1519" / "WN-VS1519" all become "WN-VS 1519".
 *
 * A dash typed by the user is authoritative (it says where the
 * Unterscheidungszeichen ends). Without one we only split the letters once
 * digits appear — otherwise typing "WN" would immediately become "W-N".
 * Input that can't be parsed is passed through uppercased, so the user is
 * never blocked; validation catches the rest.
 */
export function formatPlate(raw: string): string {
  const upper = raw.toUpperCase();
  const hadDash = upper.includes("-");
  const cleaned = upper.replace(/[^A-ZÄÖÜ0-9-]/g, "");
  if (!cleaned) return "";

  let city: string;
  let rest: string;
  if (hadDash) {
    // Respect the user's own split point.
    const [head, ...tail] = cleaned.split("-");
    city = head.replace(/[^A-ZÄÖÜ]/g, "").slice(0, 3);
    rest = tail.join("").replace(/-/g, "");
  } else {
    const plain = cleaned.replace(/-/g, "");
    const letters = (plain.match(/^[A-ZÄÖÜ]+/) || [""])[0];
    const hasDigits = /\d/.test(plain);
    if (!hasDigits) {
      // Still typing the letter part — don't guess a split point yet.
      return letters.slice(0, 5);
    }
    // Digits present, so the letter block is complete: the last 1-2 letters
    // are the Erkennungsnummer, the rest is the Unterscheidungszeichen.
    const seriesLen = letters.length >= 4 ? 2 : 1;
    city = letters.slice(0, Math.max(1, letters.length - seriesLen)).slice(0, 3);
    rest = plain.slice(letters.length ? letters.length - seriesLen : 0);
  }

  const m = rest.match(/^([A-ZÄÖÜ]{0,2})(\d{0,4})([EH]?)/);
  const series = m?.[1] || "";
  const digits = m?.[2] || "";
  const suffix = m?.[3] || "";

  let out = city;
  if (series) out += `-${series}`;
  if (digits) out += ` ${digits}`;
  if (digits && suffix) out += suffix;
  return out;
}

/** Matches a vehicle field config that represents the license plate. */
export function isPlateField(fieldKey: string, fieldLabel?: string): boolean {
  const k = (fieldKey || "").toLowerCase();
  const l = (fieldLabel || "").toLowerCase();
  return ["kennzeichen", "nummernschild", "kennz", "amtliches"].some(
    (n) => k.includes(n) || l.includes(n),
  );
}
