// mailparser-Aufruf, getrennt von `parse.ts`, weil `npm:`-Importe unter vitest nicht laufen.
import { simpleParser } from "mailparser";
import { type ParsedMail, toParsed } from "./parse.ts";

export async function parseRaw(source: Uint8Array): Promise<ParsedMail> {
  return toParsed(await simpleParser(source as any));
}
