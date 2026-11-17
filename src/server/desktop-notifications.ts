// The shell pulls card transitions even when its window is asleep. A bounded journal lets a
// running app finish its batch across a server restart, while a new app starts at the tip.

import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Language } from '../core/locale';
import type { Store } from './db';
import { cardUrl, waitingText, type Waits } from './push';

const MAX_EVENTS = 512;
const HOLD_MS = 50_000;
type Wait = Omit<Waits, 'still'> & { since: string };
type Entry = Wait & { id: number };
interface Journal {
  instance: string;
  seen: number;
  events: Entry[];
}

const emptyJournal = (): Journal => ({ instance: crypto.randomUUID(), seen: 0, events: [] });

async function readJournal(file: string): Promise<Journal> {
  try {
    const journal = JSON.parse(await readFile(file, 'utf8')) as Journal;
    if (typeof journal.instance === 'string' && Number.isSafeInteger(journal.seen) && Array.isArray(journal.events)) return journal;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Obeya: desktop notification history could not be read:', e);
  }
  return emptyJournal();
}

/** Keep the same length limit as phone notifications and avoid splitting a surrogate pair. */
const validUnicode = (text: string) => text.replace(/[\uD800-\uDBFF](?=…$)/u, '').toWellFormed();

export class DesktopNotifications {
  private readonly listeners = new Set<() => void>();
  private saving = Promise.resolve();

  constructor(private store: Store, private language: () => Language, private readonly file?: string, private readonly journal = emptyJournal()) {}

  static async open(store: Store, language: () => Language, home: string) {
    const file = join(home, 'desktop-notification-events.json');
    return new DesktopNotifications(store, language, file, await readJournal(file));
  }

  /** A graceful restart leaves the app's pending notifications in the journal. */
  saved() {
    return this.saving;
  }

  waits(cards: Wait[]) {
    if (!cards.length) return;
    const replaced = new Set(cards.map((w) => w.card));
    const { journal, file } = this;
    journal.events = [...journal.events.filter((w) => !replaced.has(w.card)), ...cards.map((w) => ({ ...w, id: ++journal.seen }))].slice(-MAX_EVENTS);
    if (file) {
      const contents = JSON.stringify(journal);
      this.saving = this.saving.then(async () => {
        await writeFile(`${file}.tmp`, contents, { mode: 0o600 });
        await rename(`${file}.tmp`, file);
      }).catch((e) => {
        console.warn('Obeya: desktop notification history could not be saved:', e);
      });
    }
    for (const wake of [...this.listeners]) wake();
  }

  /** A card may start waiting again while an older notification is still in the queue. */
  private current(w: Entry, hasCanvas: (id: string) => boolean) {
    const row = this.store.card(w.card);
    return !!row && hasCanvas(row.canvas_id) && row.waiting_since === w.since && !row.archived_at;
  }

  async poll(url: URL, signal: AbortSignal, hasCanvas: (id: string) => boolean) {
    const { journal } = this;
    const instance = url.searchParams.get('instance');
    const seen = Number(url.searchParams.get('seen'));
    const hold = Math.min(HOLD_MS, Math.max(0, Number(url.searchParams.get('hold') ?? HOLD_MS) || 0));
    if (instance === journal.instance && seen === journal.seen && hold > 0 && !signal.aborted) {
      await new Promise<void>((resolve) => {
        const wake = () => {
          this.listeners.delete(wake);
          signal.removeEventListener('abort', wake);
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(wake, hold);
        this.listeners.add(wake);
        signal.addEventListener('abort', wake);
      });
    }
    // A new app starts at the tip. A cursor from a journal that had to be reset can start over.
    const after = !instance ? journal.seen : instance === journal.instance ? seen : 0;
    const events = journal.events.flatMap((w) => w.id > after && this.current(w, hasCanvas) ? [{ id: w.id, card: w.card }] : []);
    return { instance: journal.instance, seen: journal.seen, events };
  }

  /** Rechecks the exact waiting transition at delivery, including after batching. */
  message({ instance, ids }: Record<string, unknown>, hasCanvas: (id: string) => boolean) {
    if (instance !== this.journal.instance || !Array.isArray(ids) || ids.length > MAX_EVENTS) return;
    const wanted = new Set(ids);
    const waits = this.journal.events.filter((w) => wanted.has(w.id) && this.current(w, hasCanvas));
    if (!waits.length) return;
    const { title, body } = waitingText(waits, this.language());
    return {
      title: validUnicode(title),
      body: validUnicode(body),
      next: waits.length === 1 ? cardUrl(this.store, waits[0]!.card) : '/?needs-you',
    };
  }
}
