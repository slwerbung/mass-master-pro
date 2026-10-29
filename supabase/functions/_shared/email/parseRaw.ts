// mailparser-Aufruf, getrennt von `parse.ts`, weil `npm:`-Importe unter vitest nicht laufen.
import { Buffer } from "node:buffer";
import { simpleParser } from "mailparser";
import { type ParsedMail, toParsed } from "./parse.ts";

export async function parseRaw(source: Uint8Array): Promise<ParsedMail> {
  // mailparser erkennt nur einen echten Buffer als Daten (ein nacktes Uint8Array haelt er fuer einen Stream).
  return toParsed(await simpleParser((Buffer.isBuffer(source) ? source : Buffer.from(source)) as any));
}
