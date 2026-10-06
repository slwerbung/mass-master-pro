// IMAP-Verbindung, die erst aufgebaut wird, wenn wirklich etwas im Postfach zu tun ist
// (Verschieben, Schlagwoerter). Viele Laeufe brauchen sie gar nicht.

import type { ImapFlow } from "imapflow";
import { addKeywords, makeClient, moveMessage, type ImapCreds } from "./imap.ts";
import type { ActImap } from "./act.ts";

export class LazyImap implements ActImap {
  private client: ImapFlow | null = null;
  constructor(private creds: ImapCreds) {}

  private async get(): Promise<ImapFlow> {
    if (!this.client) {
      const c = makeClient(this.creds);
      c.on("error", () => {});
      await c.connect();
      this.client = c;
    }
    return this.client;
  }

  async move(folder: string, uid: number, dest: string): Promise<number | null> {
    return await moveMessage(await this.get(), folder, uid, dest);
  }

  async addKeywords(folder: string, uid: number, keywords: string[]): Promise<void> {
    await addKeywords(await this.get(), folder, uid, keywords);
  }

  /** Fuer Phase 3: Zugriff auf die offene Verbindung (Entwuerfe schreiben). */
  async raw(): Promise<ImapFlow> {
    return await this.get();
  }

  get connected(): boolean {
    return this.client !== null;
  }

  async close(): Promise<void> {
    if (this.client) {
      try { await this.client.logout(); } catch { /* schon getrennt */ }
      this.client = null;
    }
  }
}
