import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { trackingHooks } from './runtime';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmodSync, statSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CanvasRuntime } from './canvas';
import { Store } from './db';
import { FolderWorkspaces, walkGit } from './folder';
import { projectWorkspaces } from './project-workspaces';
import { commitShared } from './shared-settings';
import { artifact, FakeRuntime, gitClone, gitRepo, noForge, removeDir } from './testing';
import { git, Workspaces } from './workspaces';

let dir: string, repo: string, store: Store, runtime: FakeRuntime, canvas: CanvasRuntime;
const files = { '.gitignore': 'node_modules/\ndist/\n.env\n', 'source.txt': 'original\n', 'other.txt': 'other\n' };
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-project-folder-'));
  repo = join(dir, 'project');
  gitRepo(repo, files);
  store = new Store(':memory:');
  runtime = new FakeRuntime();
  canvas = await CanvasRuntime.start({ repos: [{ path: repo, settings: { workspaces: 'project-folder', setup: 'echo setup-must-not-run', checks: ['echo ordinary-check'], app: { stop: 'echo stop-must-not-run' } } }] }, { store, home: dir, runtime, forge: noForge });
});
afterEach(async () => { await canvas.shutdown(); await removeDir(dir); });
const start = async (title = 'Update the project') => {
  const card = canvas.board.create({ title, x: 0, y: 0 });
  await canvas.repos[0]!.workers.start(card.id);
  await canvas.repos[0]!.workers.prepared();
  for (let n = 0; n < 200 && !runtime.sessions.some((s) => s.spec.spendOn === card.id); n++) await Bun.sleep(10);
  const session = runtime.sessions.find((s) => s.spec.spendOn === card.id);
  if (!session) throw new Error('worker did not start');
  const prepared = { id: 'prepared', name: 'Write', input: { file_path: join(dir, 'outside') } };
  await session.spec.watch?.before(prepared);
  await session.spec.watch?.after(prepared);
  return { card, session };
};
const changes = async (id: string) => (await canvas.diff(id, false))!.folder!.changes.map((x) => x.path);
const handover = (session: FakeRuntime['last']) => session.call('ready_for_review', { summary: 'Updated the project.', demo: artifact() });

test('dirty and untracked input survives: checkout, no branch, no commit, normal checks, required demo, approval to done', async () => {
  writeFileSync(join(repo, 'source.txt'), 'owner dirty\n');
  writeFileSync(join(repo, 'owner.txt'), 'owner untracked\n');
  const head = git(repo, 'rev-parse', 'HEAD');
  const { card, session } = await start();
  expect(session.spec.cwd).toBe(repo);
  expect(session.spec.system).toContain('Make no commit or branch switch unless the task explicitly asks');
  expect(session.inbox[0]).toContain('ordinary-check');
  expect(session.inbox[0]).not.toContain('echo setup-must-not-run');
  expect(session.inbox[0]).not.toContain('echo stop-must-not-run');
  await session.use('Bash', { command: 'echo updated > source.txt' }, () => writeFileSync(join(repo, 'source.txt'), 'task\n'));
  expect(await changes(card.id)).toEqual(['source.txt']);
  expect(await session.call('ready_for_review', { summary: 'Updated.' })).toContain('every handover brings a demo');
  expect(await handover(session)).toContain('Recorded');
  expect((await canvas.diff(card.id, true))!.patch).toContain('-owner dirty');
  await canvas.act(card.id, { action: 'undo' });
  expect(readFileSync(join(repo, 'source.txt'), 'utf8')).toBe('owner dirty\n');
  expect(readFileSync(join(repo, 'owner.txt'), 'utf8')).toBe('owner untracked\n');
  await session.use('Write', { file_path: join(repo, 'result.txt') }, () => writeFileSync(join(repo, 'result.txt'), 'result\n'));
  await handover(session);
  await canvas.act(card.id, { action: 'approve' });
  expect(canvas.board.item(card.id)).toMatchObject({ state: 'done', projectFolder: true });
  expect(git(repo, 'branch', '--list')).toBe('* main');
  expect(git(repo, 'rev-parse', 'HEAD')).toBe(head);
  expect(existsSync(join(repo, 'result.txt'))).toBe(true);
  expect(store.card(card.id)!.branch).toBeNull();
  expect(store.card(card.id)!.parked).toBeNull();
});

test('ignores script output, snapshots only git-visible files, but a direct ignored edit is listed and undoable', async () => {
  mkdirSync(join(repo, 'node_modules'), { recursive: true });
  writeFileSync(join(repo, 'node_modules', 'huge.js'), 'dependency');
  writeFileSync(join(repo, '.env'), 'owner secret\n');
  expect([...await walkGit(repo)].map(([p]) => p)).not.toContain('node_modules');
  const { card, session } = await start();
  await session.use('Bash', { command: 'build' }, () => {
    mkdirSync(join(repo, 'dist'));
    writeFileSync(join(repo, 'dist', 'output.js'), 'generated');
    writeFileSync(join(repo, '.env'), 'script local\n');
  });
  expect(await changes(card.id)).toEqual([]);
  await session.use('Edit', { file_path: join(repo, '.env') }, () => writeFileSync(join(repo, '.env'), 'direct local\n'));
  await session.use('Bash', { command: 'build' }, () => writeFileSync(join(repo, 'dist', 'output.js'), 'generated again'));
  expect(await changes(card.id)).toEqual(['.env']);
  await handover(session);
  await canvas.act(card.id, { action: 'undo' });
  expect(readFileSync(join(repo, '.env'), 'utf8')).toBe('script local\n');
  expect(readFileSync(join(repo, 'dist/output.js'), 'utf8')).toBe('generated again');
  expect(existsSync(join(dir, 'undo', canvas.board.canvas.id, canvas.repos[0]!.ref.id, card.id.slice(0, 8), 'snapshot', 'node_modules'))).toBe(false);
});

test('resolved place survives a repository restart and default change in both directions', async () => {
  const { card, session } = await start();
  await session.use('Write', { file_path: join(repo, 'result.txt') }, () => writeFileSync(join(repo, 'result.txt'), 'before restart'));
  await canvas.shutdown();
  runtime = new FakeRuntime();
  canvas = await CanvasRuntime.start({ repos: [{ path: repo, settings: { workspaces: 'worktrees' } }] }, { store, home: dir, runtime, forge: noForge });
  const resumed = runtime.withTool('ready_for_review').at(-1)!;
  expect(resumed.spec.cwd).toBe(repo);
  expect(resumed.spec.watch).toBeDefined();
  expect(await changes(card.id)).toEqual(['result.txt']);
  const fresh = await start('Isolated task');
  expect(fresh.session.spec.cwd).not.toBe(repo);
  const isolated = fresh.session.spec.cwd;
  await canvas.shutdown();
  runtime = new FakeRuntime();
  canvas = await CanvasRuntime.start({ repos: [{ path: repo, settings: { workspaces: 'project-folder' } }] }, { store, home: dir, runtime, forge: noForge });
  expect(runtime.withTool('ready_for_review').some((s) => s.spec.cwd === isolated)).toBe(true);
});

test('overlapping scripts cannot undo shared changes, and later owner edits stay', async () => {
  const a = await start('First task');
  const b = await start('Second task');
  const wa = a.session.spec.watch!, wb = b.session.spec.watch!;
  const ca = { id: 'a', name: 'Bash', input: { command: 'update' } }, cb = { ...ca, id: 'b' };
  await wa.before(ca); await wb.before(cb);
  writeFileSync(join(repo, 'source.txt'), 'overlap\n');
  await wa.after(ca); await wb.after(cb);
  await handover(a.session); await handover(b.session);
  const shared = await canvas.repos[0]!.workers.undo(a.card.id);
  expect(shared.shared).toContain('source.txt');
  await a.session.use('Write', { file_path: join(repo, 'later.txt') }, () => writeFileSync(join(repo, 'later.txt'), 'task'));
  writeFileSync(join(repo, 'later.txt'), 'owner later');
  const later = await canvas.repos[0]!.workers.undo(a.card.id);
  expect(later.changedSince).toContain('later.txt');
  expect(readFileSync(join(repo, 'later.txt'), 'utf8')).toBe('owner later');
});

test('landing and settings writes during an open command are not assigned to the task; landing guard stays', async () => {
  const { card, session } = await start();
  const spaces = canvas.repos[0]!.workspaces;
  const landing = canvas.board.create({ title: 'Landing task', x: 0, y: 0 });
  store.update(landing.id, { work_place: 'workspace' });
  const lease = spaces.lease(landing.id, 'test-landing');
  await lease.ready;
  writeFileSync(join(lease.path, 'other.txt'), 'landed\n');
  git(lease.path, 'add', '.'); git(lease.path, 'commit', '-qm', 'Change other');
  const call = { id: 'open', name: 'Bash', input: { command: 'update' } };
  await session.spec.watch!.before(call);
  expect(await spaces.landOnMain(landing.id, 'test-landing')).toHaveProperty('to');
  await commitShared(repo, { checks: ['echo check'] });
  writeFileSync(join(repo, 'source.txt'), 'concurrent task\n');
  await session.spec.watch!.after(call);
  expect(await changes(card.id)).toEqual(['source.txt']);
  writeFileSync(join(lease.path, 'source.txt'), 'conflicting landing\n');
  git(lease.path, 'add', '.'); git(lease.path, 'commit', '-qm', 'Conflict');
  expect(await spaces.landOnMain(landing.id, 'test-landing')).toHaveProperty('worker', false);
  expect(readFileSync(join(repo, 'source.txt'), 'utf8')).toBe('concurrent task\n');
});

test('a pull during an open command is excluded', async () => {
  const origin = join(dir, 'remote.git'); gitClone(repo, origin, { bare: true });
  git(repo, 'remote', 'add', 'origin', origin);
  const elsewhere = join(dir, 'elsewhere'); gitClone(origin, elsewhere);
  git(elsewhere, 'config', 'user.email', 'test@example.com'); git(elsewhere, 'config', 'user.name', 'Test');
  writeFileSync(join(elsewhere, 'other.txt'), 'remote change\n');
  git(elsewhere, 'commit', '-qam', 'Remote change'); git(elsewhere, 'push', '-q', 'origin', 'main');
  const { card, session } = await start();
  const call = { id: 'open', name: 'Bash', input: { command: 'update' } };
  await session.spec.watch!.before(call);
  const isolated = new Workspaces(store, 'pull', { mode: 'worktrees', repoPath: repo, dir: join(dir, 'pull') });
  expect(await isolated.pullMain()).toHaveProperty('to');
  writeFileSync(join(repo, 'source.txt'), 'task\n');
  await session.spec.watch!.after(call);
  expect(await changes(card.id)).toEqual(['source.txt']);
});

test('exceptional card kinds and leased checkouts resolve to a separate workspace', async () => {
  const isolated = new Workspaces(store, canvas.board.canvas.id, { mode: 'worktrees', repoPath: repo, dir: join(dir, 'exception') });
  const tracker = new FolderWorkspaces(store, { path: repo, dir: join(dir, 'undo-exception'), git: true });
  const spaces = projectWorkspaces(store, isolated, tracker, true);
  const parent = canvas.board.create({ title: 'Parent', x: 0, y: 0 });
  for (const patch of [{ parent_id: parent.id }, { prototype_of: parent.id }, { contribution: '{}' }, { built_on: parent.id }]) {
    const card = canvas.board.create({ title: 'Exceptional', x: 0, y: 0 });
    // Test persisted card kinds without provisioning the unrelated review/idea flows.
    store.db.run(`UPDATE cards SET ${Object.keys(patch)[0]} = ? WHERE id = ?`, [Object.values(patch)[0]!, card.id]);
    const lease = spaces.lease(card.id, `test-${card.id}`); await lease.ready;
    expect(lease.path).not.toBe(repo);
  }
  const card = canvas.board.create({ title: 'Leased checkout', x: 0, y: 0 });
  const guarded = projectWorkspaces(store, isolated, tracker, true, false);
  const lease = guarded.lease(card.id, 'test-leased'); await lease.ready;
  expect(lease.path).not.toBe(repo);
  tracker.dispose();
});

test('Claude SDK tracking hooks bracket ignored edits and failed commands', async () => {
  const { card, session } = await start();
  const hooks = trackingHooks(session.spec.watch);
  const call = { hook_event_name: 'PreToolUse', tool_use_id: 'edit', tool_name: 'Write', tool_input: { file_path: join(repo, '.env') } } as HookInput;
  await hooks.PreToolUse[0]!.hooks[0]!(call);
  writeFileSync(join(repo, '.env'), 'local configuration');
  await hooks.PostToolUse[0]!.hooks[0]!({ ...call, hook_event_name: 'PostToolUse' } as HookInput);
  const command = { hook_event_name: 'PreToolUse', tool_use_id: 'cmd', tool_name: 'Bash', tool_input: { command: 'build' } } as HookInput;
  await hooks.PreToolUse[0]!.hooks[0]!(command);
  writeFileSync(join(repo, 'source.txt'), 'before a command failed');
  await hooks.PostToolUseFailure[0]!.hooks[0]!({ ...command, hook_event_name: 'PostToolUseFailure' } as HookInput);
  expect(await changes(card.id)).toEqual(['.env', 'source.txt']);
});

test('stopping and resuming stays in place, never parks or stops the existing app', async () => {
  const { card, session } = await start();
  const workers = canvas.repos[0]!.workers;
  await session.use('Write', { file_path: join(repo, 'result.txt') }, () => writeFileSync(join(repo, 'result.txt'), 'work'));
  await workers.stop(card.id);
  expect(canvas.board.item(card.id)).toMatchObject({ state: 'planned', projectFolder: true });
  await workers.start(card.id);
  expect(runtime.last.spec.cwd).toBe(repo);
  expect(await changes(card.id)).toEqual(['result.txt']);
  await handover(runtime.last);
  // Exercise the timer callback as well as its scheduling guard, without waiting five minutes.
  await (workers as unknown as { park(id: string): Promise<void> }).park(card.id);
  expect(store.card(card.id)!.parked).toBeNull();
  expect(workers.evictable(card.id)).toBe(false);
});


test('an ignored script edit during another command stays excluded when a direct editor next opens it', async () => {
  writeFileSync(join(repo, '.env'), 'initial');
  const a = await start('Direct editor');
  const b = await start('Broad command');
  const call = { id: 'broad', name: 'Bash', input: { command: 'build' } };
  await b.session.spec.watch!.before(call);
  writeFileSync(join(repo, '.env'), 'script');
  await a.session.use('Edit', { file_path: join(repo, '.env') }, () => writeFileSync(join(repo, '.env'), 'direct'));
  await b.session.spec.watch!.after(call);
  expect(await changes(a.card.id)).toEqual(['.env']);
  expect(await changes(b.card.id)).toEqual([]);
});


test('the complete review change includes deletions and both sides of a rename', async () => {
  const { card, session } = await start();
  await session.use('Bash', { command: 'update' }, () => {
    renameSync(join(repo, 'source.txt'), join(repo, 'source.md'));
    unlinkSync(join(repo, 'other.txt'));
  });
  const all = await canvas.repos[0]!.workspaces.changedFiles(card.id, undefined, true);
  expect(all.sort()).toEqual(['other.txt', 'source.md', 'source.txt']);
});

async function duringLanding(write: () => void, operation: string) {
  const { ownGitWrite } = await import('./own-writes');
  let release!: () => void, ready!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const landing = ownGitWrite(repo, async () => {
    git(repo, 'merge', '--ff-only', operation);
    ready();
    await held;
  }, ['merge', '--ff-only', operation]);
  await started;
  write();
  release();
  await landing;
}

test('a concurrent edit is compared with and discarded to the landed version', async () => {
  git(repo, 'checkout', '-qb', 'incoming');
  writeFileSync(join(repo, 'source.txt'), 'landed\n');
  chmodSync(join(repo, 'source.txt'), 0o755);
  git(repo, 'commit', '-qam', 'Incoming change');
  git(repo, 'checkout', '-q', 'main');
  const { card, session } = await start();
  await session.use('Bash', { command: 'update' }, () => duringLanding(() => writeFileSync(join(repo, 'source.txt'), 'worker\n'), 'incoming'));
  const diff = (await canvas.diff(card.id, true))!;
  expect(diff.patch).toContain('-landed');
  expect(diff.patch).not.toContain('-original');
  await handover(session);
  await canvas.act(card.id, { action: 'undo' });
  expect(readFileSync(join(repo, 'source.txt'), 'utf8')).toBe('landed\n');
  if (process.platform !== 'win32') expect(statSync(join(repo, 'source.txt')).mode & 0o777).toBe(0o755);
});

test('a worker recreating a path deleted by a landing is tracked as an addition', async () => {
  git(repo, 'checkout', '-qb', 'incoming');
  git(repo, 'rm', '-q', 'other.txt');
  git(repo, 'commit', '-qm', 'Remove other');
  git(repo, 'checkout', '-q', 'main');
  const { card, session } = await start();
  await session.use('Bash', { command: 'update' }, () => duringLanding(() => writeFileSync(join(repo, 'other.txt'), 'worker\n'), 'incoming'));
  expect((await canvas.diff(card.id, true))!.folder!.changes).toContainEqual(expect.objectContaining({ path: 'other.txt', kind: 'added' }));
  await handover(session);
  await canvas.act(card.id, { action: 'undo' });
  expect(existsSync(join(repo, 'other.txt'))).toBe(false);
});

test('shared tasks honor local slots, and a refused start does not resolve its place', async () => {
  await canvas.shutdown();
  runtime = new FakeRuntime();
  canvas = await CanvasRuntime.start({ repos: [{ path: repo, slots: 1, settings: { workspaces: 'project-folder' } }] }, { store, home: dir, runtime, forge: noForge });
  const first = await start('First task');
  const second = canvas.board.create({ title: 'Second task', x: 0, y: 0 });
  expect(() => canvas.repos[0]!.workers.start(second.id)).toThrow();
  expect(store.card(second.id)!.work_place).toBeNull();
  await canvas.repos[0]!.workers.stop(first.card.id);
  await canvas.repos[0]!.workers.start(second.id);
  expect(store.card(second.id)!.workspace).toBe(repo);
  const tracker = canvas.repos[0]!.workspaces.folderFor!(second.id)!;
  const prepared = { id: 'prepared-second', name: 'Write', input: { file_path: join(dir, 'outside') } };
  await tracker.watch(second.id).before(prepared);
  await tracker.watch(second.id).after(prepared);
});

test('a stopped project-folder task without work can be archived', async () => {
  const { card } = await start();
  await canvas.repos[0]!.workers.stop(card.id);
  canvas.board.archive([card.id]);
  expect(store.card(card.id)!.archived_at).not.toBeNull();
});

for (const background of [false, true]) test(`stopping settles ${background ? 'background' : 'foreground'} writes before releasing the folder`, async () => {
  const { card, session } = await start('Stopped task');
  if (background) session.emit({ type: 'background', tasks: [{ id: 'background', description: 'Generate files' }] });
  else await session.spec.watch!.before({ id: 'unfinished', name: 'Bash', input: { command: 'generate' } });
  writeFileSync(join(repo, 'source.txt'), 'stopped worker\n');
  await canvas.repos[0]!.workers.stop(card.id);
  expect(await changes(card.id)).toEqual(['source.txt']);
  expect(store.card(card.id)!.workspace).toBe(repo);
  const next = await start('Later task');
  await next.session.use('Write', { file_path: join(repo, 'other.txt') }, () => writeFileSync(join(repo, 'other.txt'), 'later worker\n'));
  const diff = (await canvas.diff(next.card.id, false))!;
  expect(diff.folder!.changes[0]!.undo).toBe('yes');
});

test('stop waits for the session to exit before taking its final change snapshot', async () => {
  const { card, session } = await start();
  await session.spec.watch!.before({ id: 'terminating', name: 'Bash', input: { command: 'generate' } });
  let exit!: () => void;
  let closing = false;
  session.done = new Promise<void>((resolve) => { exit = resolve; });
  session.close = () => {
    if (closing) return;
    closing = true;
    setTimeout(() => {
      writeFileSync(join(repo, 'source.txt'), 'last write while exiting\n');
      exit();
    }, 20);
  };
  await canvas.repos[0]!.workers.stop(card.id);
  await session.done;
  expect(await changes(card.id)).toEqual(['source.txt']);
  expect(store.card(card.id)!.workspace).toBe(repo);
});

test('shutdown drains a blocked tracker before a replacement resumes the card', async () => {
  const { ownGitWrite } = await import('./own-writes');
  const { card, session } = await start();
  await session.spec.watch!.before({ id: 'open', name: 'Bash', input: { command: 'generate' } });
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const operation = ownGitWrite(repo, async () => { entered(); await gate; });
  await ready;
  writeFileSync(join(repo, 'source.txt'), 'before shutdown\n');
  let drained = false;
  const stopping = canvas.shutdown().then(() => { drained = true; });
  await Bun.sleep(10);
  expect(drained).toBe(false);
  release();
  await operation;
  await stopping;
  runtime = new FakeRuntime();
  canvas = await CanvasRuntime.start({ repos: [{ path: repo, settings: { workspaces: 'project-folder' } }] }, { store, home: dir, runtime, forge: noForge });
  for (let n = 0; n < 200 && !runtime.sessions.some((s) => s.spec.spendOn === card.id); n++) await Bun.sleep(10);
  const resumed = runtime.sessions.find((s) => s.spec.spendOn === card.id)!;
  await resumed.use('Write', { file_path: join(repo, 'other.txt') }, () => writeFileSync(join(repo, 'other.txt'), 'after restart\n'));
  expect((await changes(card.id)).sort()).toEqual(['other.txt', 'source.txt']);
});

test('an immediate resume waits for termination-time writes and the previous tracker', async () => {
  const { card, session } = await start();
  await session.spec.watch!.before({ id: 'open', name: 'Bash', input: { command: 'generate' } });
  let exited!: () => void;
  let closing = false;
  session.done = new Promise<void>((resolve) => { exited = resolve; });
  session.close = () => {
    if (closing) return;
    closing = true;
    setTimeout(() => { writeFileSync(join(repo, 'source.txt'), 'while exiting\n'); exited(); }, 30);
  };
  const workers = canvas.repos[0]!.workers;
  workers.pause(card.id);
  workers.resume(card.id);
  await workers.prepared();
  expect(runtime.last).not.toBe(session);
  await runtime.last.use('Write', { file_path: join(repo, 'other.txt') }, () => writeFileSync(join(repo, 'other.txt'), 'resumed\n'));
  expect((await changes(card.id)).sort()).toEqual(['other.txt', 'source.txt']);
});

test('retiring a canvas waits for its last shared-folder snapshot', async () => {
  const { ownGitWrite } = await import('./own-writes');
  const { card, session } = await start();
  await session.spec.watch!.before({ id: 'open', name: 'Bash', input: { command: 'generate' } });
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const operation = ownGitWrite(repo, async () => { entered(); await gate; });
  await ready;
  writeFileSync(join(repo, 'source.txt'), 'before retirement\n');
  let retired = false;
  canvas.retire(() => { retired = true; });
  canvas.restartNow();
  await Bun.sleep(10);
  const premature = retired;
  release();
  await operation;
  for (let n = 0; n < 200 && !retired; n++) await Bun.sleep(10);
  expect(premature).toBe(false);
  expect(retired).toBe(true);
  expect(JSON.parse(store.folderCard(card.id)!).changes.map((c: { path: string }) => c.path)).toContain('source.txt');
});
