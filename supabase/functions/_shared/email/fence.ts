// Eigenes Modul, damit Functions, die nur `fence` brauchen, nicht die ganze Klassifikation (Schemas) mitbuendeln.

/** `</mail>` im Mailtext entschaerfen, damit der Fremdtext die Abgrenzung nicht verlassen kann. */
export function fence(text: string): string {
  return String(text).replace(/<\s*\/?\s*mail\s*>/gi, (m) => m.replace("<", "‹").replace(">", "›"));
}
