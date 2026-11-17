import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CanvasRuntime } from './canvas';
import { Store } from './db';
import { artifact, commit, FakeRuntime, gitRepo, noForge, removeDir, until } from './testing';
import { git } from './git';

let store: Store;
let dir: string, repo: string, runtime: FakeRuntime, canvas: CanvasRuntime;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-project-scheduling-'));
  repo = join(dir, 'project');
  gitRepo(repo, { 'source.txt': 'original\n', 'other.txt': 'other\n', 'docs/guide.md': 'guide\n', '.gitignore': '.env\n' });
  runtime = new FakeRuntime();
  store = new Store(':memory:');
  canvas = await CanvasRuntime.start({ repos: [{ path: repo, settings: { workspaces: 'project-folder', land: 'main', softPaths: ['docs/'] } }] }, { store, home: dir, runtime, forge: noForge });
});
afterEach(async () => { await canvas.shutdown(); await removeDir(dir); });
const workers = () => canvas.repos[0]!.workers;
const spaces = () => canvas.repos[0]!.workspaces;
const create = (title: string, place: 'project-folder' | 'workspace' = 'project-folder') => {
  const card = canvas.board.create({ title, x: 0, y: 0 });
  canvas.board.work(card.id, { work_in: place });
  return card;
};
const session = (id: string) => runtime.sessions.find((s) => s.spec.spendOn === id && s.spec.role === 'worker')!;
const activeScope = () => runtime.withTool('scope').findLast((s) => !s.closed);
async function scope(files: string[]) {
  await until(() => !!activeScope());
  const s = activeScope()!;
  s.call('scope', { files, conflicts_with: [], builds_on: [], reason: 'Can run alongside other work.' });
  s.emit({ type: 'idle' });
  await until(() => !canvas.coordinator.deciding);
  await workers().prepared();
}
async function start(title: string, place: 'project-folder' | 'workspace' = 'project-folder', files = ['source.txt']) {
  const card = create(title, place);
  canvas.coordinator.request(card.id);
  await scope(files);
  return card;
}
const handover = (id: string) => session(id).call('ready_for_review', { summary: 'Ready.', demo: artifact() });
const edit = async (id: string, file = 'source.txt', text = 'task\n') => {
  await until(() => !!session(id));
  await session(id).use('Write', { file_path: join(repo, file) }, () => writeFileSync(join(repo, file), text));
};

for (const [first, second] of [['project-folder', 'workspace'], ['workspace', 'project-folder'], ['project-folder', 'project-folder']] as const) {
  test(`${first} first, ${second} second: scopes and actual edits, including soft paths, hold the queue`, async () => {
    const a = await start('Earlier task', first, ['other.txt']);
    if (first === 'project-folder') await edit(a.id, 'docs/guide.md', 'in place\n');
    else commit(canvas.board.row(a.id).workspace!, 'docs/guide.md', 'isolated\n', 'Update guide');
    const b = create('Later task', second);
    canvas.coordinator.request(b.id);
    await until(() => !!activeScope());
    const brief = activeScope()!.inbox[0]!;
    expect(brief).toContain('docs/guide.md');
    expect(brief).toContain('shared project folder');
    if (first === 'workspace' || second === 'workspace') expect(brief).toContain('a workspace of its own');
    expect(brief).not.toContain('Changes under docs/ never count');
    await scope(['docs/guide.md']);
    expect(canvas.board.item(b.id)?.queue).toMatchObject({ behind: [a.id] });
    expect(canvas.board.item(b.id)?.state).toBe('planned');
  });
}

test('inverse order also protects estimated future edits before either task writes', async () => {
  const a = await start('Workspace task', 'workspace', ['docs/guide.md']);
  const b = create('In-place task');
  canvas.coordinator.request(b.id);
  await scope(['docs/guide.md']);
  expect(canvas.board.item(b.id)?.queue).toMatchObject({ behind: [a.id] });
});

test('disjoint tasks run in parallel in both locations', async () => {
  const a = await start('In-place task');
  await edit(a.id);
  const b = await start('Isolated task', 'workspace', ['other.txt']);
  const c = await start('Other in-place task', 'project-folder', ['docs/guide.md']);
  expect([a, b, c].map((x) => canvas.board.item(x.id)?.state)).toEqual(['working', 'working', 'working']);
  expect(canvas.board.row(c.id).workspace).toBe(repo);
  expect(canvas.board.row(b.id).workspace).not.toBe(repo);
});

for (const state of ['waiting', 'stopped', 'approved'] as const) {
  for (const clear of ['commit', 'discard'] as const) {
    test(`${state} in-place changes hold a task until ${clear}, regardless of the earlier card's state`, async () => {
      const a = await start('Earlier task');
      await edit(a.id);
      await handover(a.id);
      if (state === 'stopped') await workers().stop(a.id);
      if (state === 'approved') await canvas.act(a.id, { action: 'approve' });
      const b = create('Isolated task', 'workspace');
      canvas.coordinator.request(b.id);
      await scope(['source.txt']);
      expect(canvas.board.item(b.id)?.queue).toMatchObject({ behind: [a.id] });
      if (state === 'approved') expect(canvas.board.item(a.id)?.state).toBe('done');
      if (clear === 'commit') { git(repo, 'add', 'source.txt'); git(repo, 'commit', '-qm', 'Keep changes'); }
      else git(repo, 'restore', 'source.txt');
      canvas.board.changed();
      await until(() => canvas.board.item(b.id)?.state === 'working');
      await workers().prepared();
      expect((await spaces().projectChanges!()).has(a.id)).toBe(false);
    });
  }
}

test('committed or replaced task changes do not attribute later owner work to that task', async () => {
  const a = await start('Earlier task');
  await edit(a.id);
  git(repo, 'add', 'source.txt'); git(repo, 'commit', '-qm', 'Keep task');
  writeFileSync(join(repo, 'source.txt'), 'owner later\n');
  expect((await spaces().projectChanges!()).has(a.id)).toBe(false);
  writeFileSync(join(repo, 'owner.txt'), 'owner unrelated\n');
  const b = await start('Isolated task', 'workspace', ['other.txt']);
  commit(canvas.board.row(b.id).workspace!, 'owner.txt', 'incoming\n', 'Incoming owner file');
  await handover(b.id);
  const error = await workers().approve(b.id).catch((e) => e);
  expect(error.code).toBe('landMerge');
  expect(error.message).not.toContain('Changes left in the project folder by');
});

test('overlapping open tool windows are read before completion; Start anyway still cannot land over them', async () => {
  const a = await start('Earlier task');
  const c = create('Concurrent task');
  await workers().start(c.id); await workers().prepared();
  await until(() => !!session(c.id));
  const callA = { id: 'window-a', name: 'Bash', input: { command: 'update' } };
  const callC = { ...callA, id: 'window-c' };
  await session(a.id).spec.watch!.before(callA);
  await session(c.id).spec.watch!.before(callC);
  writeFileSync(join(repo, 'source.txt'), 'both tools\n');
  const b = create('Isolated task', 'workspace');
  canvas.coordinator.request(b.id);
  await scope(['source.txt']);
  expect(canvas.board.item(b.id)?.queue).toMatchObject({ behind: expect.arrayContaining([a.id, c.id]) });
  await session(a.id).spec.watch!.after(callA);
  await session(c.id).spec.watch!.after(callC);
  // A task unrelated to the affected files must not be named by the landing refusal.
  const d = create('Unrelated task');
  await workers().start(d.id); await workers().prepared();
  await edit(d.id, 'other.txt', 'unrelated\n');
  writeFileSync(join(repo, 'owner.txt'), 'owner\n');
  canvas.coordinator.force(b.id);
  await workers().prepared(); await until(() => !!session(b.id));
  commit(canvas.board.row(b.id).workspace!, 'source.txt', 'isolated\n', 'Isolated change');
  commit(canvas.board.row(b.id).workspace!, 'owner.txt', 'incoming\n', 'Incoming file');
  await handover(b.id);
  const error = await workers().approve(b.id).catch((e) => e);
  expect(error.code).toBe('landMerge');
  expect(error.message).toContain('Earlier task');
  expect(error.message).toContain('Concurrent task');
  expect(error.message).not.toContain('Unrelated task');
  expect(error.message).toContain('source.txt');
  expect(canvas.board.item(b.id)?.state).toBe('waiting');
  expect(git(repo, 'show', 'HEAD:source.txt')).toBe('original');
});

test('an underestimated workspace change is still stopped on landing and names an approved task', async () => {
  const a = await start('Approved task');
  await edit(a.id); await handover(a.id); await workers().approve(a.id);
  const b = await start('Underestimated task', 'workspace', ['other.txt']);
  commit(canvas.board.row(b.id).workspace!, 'source.txt', 'incoming\n', 'Unexpected overlap');
  await handover(b.id);
  const error = await workers().approve(b.id).catch((e) => e);
  expect(error.code).toBe('landMerge');
  expect(error.message).toContain('Approved task');
  expect(canvas.board.events(b.id).some((e) => e.kind === 'error' && !e.code && e.text.includes('Approved task'))).toBe(true);
});

test('in-place work and isolated work share the same slot limit', async () => {
  await canvas.shutdown();
  runtime = new FakeRuntime();
  canvas = await CanvasRuntime.start({ repos: [{ path: repo, slots: 1, settings: { workspaces: 'project-folder' } }] }, { store: new Store(':memory:'), home: dir, runtime, forge: noForge });
  const a = await start('Busy task');
  const b = await start('Isolated task', 'workspace', ['other.txt']);
  expect(canvas.board.item(b.id)?.queue).toMatchObject({ workspace: 'slots' });
  const c = await start('In-place task', 'project-folder', ['docs/guide.md']);
  expect(canvas.board.item(c.id)?.queue).toMatchObject({ workspace: 'slots' });
  expect(canvas.board.item(a.id)?.state).toBe('working');
});


test('archiving an approved task keeps its obstacle and its name in a refused landing', async () => {
  const a = await start('Archived task');
  await edit(a.id); await handover(a.id); await workers().approve(a.id);
  await workers().stop(a.id);
  canvas.board.archive([a.id]);
  const b = create('Later workspace', 'workspace');
  canvas.coordinator.request(b.id); await scope(['source.txt']);
  expect(canvas.board.item(b.id)?.queue).toMatchObject({ behind: [a.id], titles: { [a.id]: 'Archived task' } });
  canvas.coordinator.force(b.id); await workers().prepared(); await until(() => !!session(b.id));
  commit(canvas.board.row(b.id).workspace!, 'source.txt', 'incoming\n', 'Overlap');
  await handover(b.id);
  const error = await workers().approve(b.id).catch((e) => e);
  expect(error.code).toBe('landMerge');
  expect(error.message).toContain('Archived task');
});

test('project checks leave the git index untouched and retain direct ignored edits across restart', async () => {
  const a = await start('Local config task', 'project-folder', ['.env']);
  await edit(a.id, '.env', 'direct config\n');
  const index = join(repo, '.git', 'index'), before = readFileSync(index);
  const later = new Date(Date.now() + 5000);
  utimesSync(join(repo, 'other.txt'), later, later);
  expect((await spaces().projectChanges!()).get(a.id)?.map((c) => c.file)).toEqual(['.env']);
  expect(readFileSync(index).equals(before)).toBe(true);
  const tracker = spaces().folderFor!(a.id)!;
  const { FolderWorkspaces } = await import('./folder');
  const fresh = new FolderWorkspaces(store, { path: repo, dir: tracker.dir, git: true });
  expect((await fresh.projectChanges()).get(a.id)?.map((c) => c.file)).toEqual(['.env']);
  fresh.dispose();
});

for (const action of ['cancel', 'shutdown'] as const) {
  test(`a batch awaiting actual file checks respects ${action}`, async () => {
    await start('Earlier isolated task', 'workspace');
    const b = create('Batch task'), c = create('Other batch task');
    const key = 'freed:test';
    for (const card of [b, c]) canvas.board.work(card.id, { queue: JSON.stringify({ checking: true, together: key, since: new Date().toISOString() }) });
    const workspace = spaces();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    workspace.changedFiles = async () => { entered(); await gate; return []; };
    canvas.coordinator.resume();
    await until(() => runtime.withTool('schedule').some((s) => !s.closed));
    const scheduling = runtime.withTool('schedule').findLast((s) => !s.closed)!;
    scheduling.call('schedule', { workstreams: [b, c].map((card) => ({ card: `K${card.number}`, files: ['other.txt'], builds_on: [], conflicts_with: [], reason: 'Disjoint.' })) });
    scheduling.emit({ type: 'idle' });
    await started;
    const stopping = action === 'shutdown' ? canvas.shutdown() : undefined;
    if (action === 'cancel') canvas.coordinator.dequeue(b.id);
    release();
    await stopping;
    await until(() => !canvas.coordinator.deciding);
    await workers().prepared();
    expect(canvas.board.item(b.id)?.state).toBe('planned');
  });
}

test('touching a committed task file does not resurrect its obstacle', async () => {
  const a = await start('Committed task'); await edit(a.id);
  git(repo, 'add', 'source.txt'); git(repo, 'commit', '-qm', 'Keep task');
  expect((await spaces().projectChanges!()).has(a.id)).toBe(false);
  const later = new Date(Date.now() + 5000); utimesSync(join(repo, 'source.txt'), later, later);
  expect((await spaces().projectChanges!()).has(a.id)).toBe(false);
});

test('discarded attribution never returns when an owner independently writes the same bytes', async () => {
  const a = await start('Discarded task'); await edit(a.id);
  git(repo, 'restore', 'source.txt');
  expect((await spaces().projectChanges!()).has(a.id)).toBe(false);
  writeFileSync(join(repo, 'source.txt'), 'task\n');
  expect((await spaces().projectChanges!()).has(a.id)).toBe(false);
  const b = await start('Later workspace', 'workspace', ['other.txt']);
  commit(canvas.board.row(b.id).workspace!, 'source.txt', 'incoming\n', 'Overlap owner');
  await handover(b.id);
  const error = await workers().approve(b.id).catch((e) => e);
  expect(error.code).toBe('landMerge'); expect(error.message).not.toContain('Discarded task');
});

test('a jointly scheduled batch checks retained archived files even when the estimate omits the conflict', async () => {
  const a = await start('Archived task'); await edit(a.id); await handover(a.id); await workers().approve(a.id); await workers().stop(a.id);
  canvas.board.archive([a.id]);
  const b = create('Overlapping batch task', 'workspace'), c = create('Disjoint batch task');
  for (const card of [b, c]) canvas.board.work(card.id, { queue: JSON.stringify({ checking: true, together: 'freed:archive', since: new Date().toISOString() }) });
  canvas.coordinator.resume();
  await until(() => runtime.withTool('schedule').some((s) => !s.closed));
  const scheduling = runtime.withTool('schedule').findLast((s) => !s.closed)!;
  scheduling.call('schedule', { workstreams: [b, c].map((card) => ({ card: `K${card.number}`, files: [card.id === b.id ? 'source.txt' : 'other.txt'], builds_on: [], conflicts_with: [], reason: 'Disjoint.' })) });
  scheduling.emit({ type: 'idle' });
  await until(() => !canvas.coordinator.deciding); await workers().prepared();
  expect(canvas.board.item(b.id)?.queue).toMatchObject({ behind: [a.id] });
  expect(canvas.board.item(c.id)?.state).toBe('working');
});

test('a new edit after an Obeya landing is again an obstacle, even when the older undo is superseded', async () => {
  const a = await start('In-place task'); await edit(a.id);
  git(repo, 'restore', 'source.txt');
  const b = create('Landing task', 'workspace'); await workers().start(b.id); await workers().prepared(); await until(() => !!session(b.id));
  commit(canvas.board.row(b.id).workspace!, 'source.txt', 'landed\n', 'Land source');
  expect(await spaces().landOnMain(b.id, canvas.board.row(b.id).branch!)).not.toHaveProperty('code');
  await edit(a.id, 'source.txt', 'new task edit\n');
  expect((await spaces().projectChanges!()).get(a.id)?.map((c) => c.file)).toContain('source.txt');
});

test('a staged task version still obstructs work when the working file was restored', async () => {
  const a = await start('Staged task'); await edit(a.id);
  git(repo, 'add', 'source.txt');
  writeFileSync(join(repo, 'source.txt'), 'original\n');
  expect((await spaces().projectChanges!()).get(a.id)?.map((c) => c.file)).toContain('source.txt');
});

test('an earlier recorded task version remains attributable while it is staged', async () => {
  const a = await start('Staged versions task');
  await edit(a.id, 'source.txt', 'version A\n'); git(repo, 'add', 'source.txt');
  await edit(a.id, 'source.txt', 'version B\n');
  writeFileSync(join(repo, 'source.txt'), 'original\n');
  expect((await spaces().projectChanges!()).get(a.id)?.map((c) => c.file)).toContain('source.txt');
});
