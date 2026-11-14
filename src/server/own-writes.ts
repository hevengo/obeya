// Only the concrete files git wrote are excluded from project-folder attribution. Keeping this
// hook beside git execution covers landings, pulls and settings without muting a worker's window.
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

type Observer = <T>(args: string[], run: () => Promise<T>) => Promise<T>;
const observers = new Map<string, Set<Observer>>();
const key = async (path: string) => { try { return await realpath(path); } catch { return resolve(path); } };
export function observeOwnWrites(path: string, observer: Observer): () => void {
  const root = resolve(path);
  const set = observers.get(root) ?? new Set();
  set.add(observer);
  observers.set(root, set);
  return () => { set.delete(observer); if (!set.size) observers.delete(root); };
}
export async function ownGitWrite<T>(path: string, run: () => Promise<T>, args: string[] = []): Promise<T> {
  if (!observers.size) return run();
  let next = run;
  for (const observer of observers.get(await key(path)) ?? []) {
    const inner = next;
    next = () => observer(args, inner);
  }
  return next();
}
