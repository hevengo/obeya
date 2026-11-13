// What the owner changed in the configuration's dialog but has not saved yet (the canvases with
// their repositories, the demo settings), written down per tab as it changes, so that it outlives
// closing the dialog and a page load: Obeya's restart, say, which reloads the page mid-edit.

import { type CanvasConfig, layerSettings } from '../core/types';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The dialog's drafts that are saved with a button of their own. */
export type ConfigDraftName = 'canvases' | 'demo';

const key = (name: ConfigDraftName) => `obeya-config-draft-${name}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Adopt generated code-video defaults without overwriting edits made while Save was in flight. */
export function savedConfigDraft(before: CanvasConfig[], saved: CanvasConfig[], current: CanvasConfig[]): CanvasConfig[] {
  if (current === before) return saved;
  const original = new Map(before.flatMap((c) => c.repos.map((r) => [r.path.trim(), r] as const)));
  const defaults = new Map(saved.flatMap((c) => c.repos.flatMap((r) => {
    const was = original.get(r.path);
    const code = r.settings?.demo?.code;
    return was && was.settings?.demo?.code === undefined && code !== undefined ? [[r.path, code] as const] : [];
  })));
  return current.map((c) => ({ ...c, repos: c.repos.map((r) => {
    const code = defaults.get(r.path.trim());
    return code !== undefined && r.settings?.demo?.code === undefined
      ? { ...r, settings: layerSettings(r.settings, { demo: { code } }) }
      : r;
  }) }));
}

/** Writes down `draft` while it differs from what is saved (`saved`), else forgets it. */
export function keepConfigDraft<T>(store: Store, name: ConfigDraftName, draft: T, saved: unknown, pick: (d: T) => unknown = (d) => d) {
  try {
    if (same(pick(draft), saved)) store.removeItem(key(name));
    else store.setItem(key(name), JSON.stringify(draft));
  } catch {}
}

/** The draft written down, if it still differs from what is saved (`saved`). */
export function keptConfigDraft<T>(store: Store, name: ConfigDraftName, saved: unknown, pick: (d: T) => unknown = (d) => d): T | null {
  try {
    const raw = store.getItem(key(name));
    const d = raw ? (JSON.parse(raw) as T) : null;
    return d && !same(pick(d), saved) ? d : null;
  } catch {
    return null;
  }
}
