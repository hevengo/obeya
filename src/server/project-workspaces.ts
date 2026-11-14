// A repository can mix checkout tasks and isolated workspaces. Resolve once at start, then route
// every lifecycle call by that persisted choice, even after its repository default changes.
import type { Store } from './db';
import { FolderWorkspaces } from './folder';
import { WorkspaceError } from './git';
import type { CardWorkspaces, Workspaces } from './workspaces';

const cardMethods = new Set(['leasedBy', 'lease', 'hasWork', 'release', 'evict', 'retake', 'forkPoint', 'addedFiles', 'landOnMain', 'pushToMain', 'removeLanded', 'discard', 'transfer', 'followUpTree', 'changes', 'diff', 'fileOf', 'changedFiles']);
export function projectWorkspaces(store: Store, isolated: Workspaces, folder: FolderWorkspaces, defaultInPlace: boolean, eligibleLocation = true): CardWorkspaces {
  const places = new Map<string, boolean>();
  const inPlace = (id: string) => {
    if (!places.has(id)) places.set(id, store.card(id)?.work_place === 'project-folder');
    return places.get(id)!;
  };
  return new Proxy(isolated, {
    get(target, property) {
      if (property === 'folderFor') return (id: string) => inPlace(id) ? folder : null;
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (!cardMethods.has(String(property))) return value.bind(target);
      return (id: string, ...args: unknown[]) => {
        if (property === 'lease') {
          const row = store.card(id);
          const eligible = row && eligibleLocation && row.kind === 'task' && !row.parent_id && !row.prototype_of && !row.contribution && !row.built_on && !row.adopted && !row.upstream;
          const place = row?.work_place ?? (defaultInPlace && eligible && !row?.branch && !row?.workspace ? 'project-folder' : 'workspace');
          const options = args[1] as { overSlots?: boolean } | undefined;
          if (place === 'project-folder' && !options?.overSlots && !isolated.hasLocalSlot()) throw new WorkspaceError('All slots are taken.', 'noSlot');
          const lease = place === 'project-folder' ? folder.lease(id) : isolated.lease(id, args[0] as string, options);
          if (row && !row.work_place) store.update(id, { work_place: place });
          places.set(id, place === 'project-folder');
          return lease;
        }
        const impl = inPlace(id) ? folder : target;
        return (Reflect.get(impl, property, impl) as Function).call(impl, id, ...args);
      };
    },
  });
}
