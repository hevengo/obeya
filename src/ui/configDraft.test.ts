import { expect, test } from 'bun:test';
import { keepConfigDraft, keptConfigDraft, savedConfigDraft } from './configDraft';
import type { CanvasConfig } from '../core/types';

const store = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

test('saving adopts generated code guidance and retains edits made during the request', () => {
  const before: CanvasConfig[] = [{ repos: [{ path: '/new', settings: { setup: 'first' } }] }];
  const saved: CanvasConfig[] = [{ repos: [{ path: '/new', settings: { setup: 'first', demo: { code: 'Explain the boundaries.' } } }] }];
  expect(savedConfigDraft(before, saved, before)).toBe(saved);
  const edited: CanvasConfig[] = [{ name: 'Renamed', repos: [{ path: '/new', settings: { setup: 'typed while saving' } }, { path: '/another' }] }];
  const result = savedConfigDraft(before, saved, edited);
  expect(result).toEqual([{ name: 'Renamed', repos: [
    { path: '/new', settings: { setup: 'typed while saving', demo: { code: 'Explain the boundaries.' } } },
    { path: '/another' },
  ] }]);
  expect(edited[0]!.repos[0]!.settings?.demo).toBeUndefined();
  for (const code of ['', 'Custom guidance']) {
    const changed: CanvasConfig[] = [{ repos: [{ path: '/new', settings: { demo: { code } } }] }];
    expect(savedConfigDraft(before, saved, changed)).toEqual(changed);
  }
  expect(savedConfigDraft(before, saved, [{ repos: [] }])).toEqual([{ repos: [] }]);
});

test('a draft not saved yet comes back after a reload, until it is saved', () => {
  const s = store();
  const saved = { voice: 'say' };
  keepConfigDraft(s, 'demo', { voice: 'piper' }, saved);
  expect(keptConfigDraft<{ voice: string }>(s, 'demo', saved)).toEqual({ voice: 'piper' });
  // saved meanwhile: what is saved now is the draft, nothing to bring back
  expect(keptConfigDraft(s, 'demo', { voice: 'piper' })).toBeNull();
  keepConfigDraft(s, 'demo', { voice: 'piper' }, { voice: 'piper' });
  expect(s.m.size).toBe(0);
});

test('the canvases keep their draft with the ids they had, and each draft its own place', () => {
  const s = store();
  type K = { draft: { name: string }[]; origin: (string | null)[] };
  const of = (k: K) => k.draft;
  const saved = [{ name: 'obeya' }];
  const k: K = { draft: [{ name: 'Obeya' }], origin: ['obeya'] };
  keepConfigDraft(s, 'canvases', k, saved, of);
  expect(keptConfigDraft(s, 'demo', {})).toBeNull();
  expect(keptConfigDraft<K>(s, 'canvases', saved, of)).toEqual(k);
  // put back as saved: forgotten
  keepConfigDraft(s, 'canvases', { draft: saved, origin: ['obeya'] }, saved, of);
  expect(keptConfigDraft<K>(s, 'canvases', saved, of)).toBeNull();
});
