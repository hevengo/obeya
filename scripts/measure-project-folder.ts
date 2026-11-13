// Measures the actual project-folder manifest and undo path. Run in a live checkout whose
// dependencies and build output are present; never writes to it. Undo copies go into a temp dir.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { Store } from '../src/server/db';
import { FolderWorkspaces, walkGit } from '../src/server/folder';

const root = resolve(process.argv[2] ?? '.');
const temp = await mkdtemp(join(tmpdir(), 'obeya-project-cost-'));
const samples: { files: number; bytes: number; manifestMs: number; snapshotMs: number; undo: string | null }[] = [];
try {
  for (let i = 0; i < 5; i++) {
    const a = performance.now();
    const manifest = await walkGit(root);
    const manifestMs = performance.now() - a;
    const store = new Store(':memory:');
    store.ensureCanvas('measure', 'Measurement');
    const card = store.insert([{ canvas_id: 'measure', kind: 'task', x: 0, y: 0 }])[0]!;
    const tracker = new FolderWorkspaces(store, { path: root, dir: join(temp, String(i)), git: true });
    await tracker.read;
    const b = performance.now();
    tracker.lease(card.id);
    await tracker.watch(card.id).before({ id: 'measure', name: 'Write', input: { file_path: join(temp, 'outside') } });
    const snapshotMs = performance.now() - b;
    samples.push({ files: [...manifest.values()].filter((e) => !e.dir).length, bytes: [...manifest.values()].reduce((n, e) => n + e.size, 0), manifestMs, snapshotMs, undo: (await tracker.diff(card.id, false))?.folder?.undo ?? null });
    tracker.dispose();
    store.db.close();
  }
  console.log(JSON.stringify({ root, samples }, null, 2));
} finally { await rm(temp, { recursive: true, force: true }); }
