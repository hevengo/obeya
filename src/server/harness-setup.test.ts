import { expect, test } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmdirSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './db';
import { claudeStateFile, copySetup, HarnessSetups, ownerSetup, saveSetupToken, setupAlias, setupEnv, setupLoginCommand } from './harness-setup';
import { Config } from './config';
import { MachineSetup } from './machine';
import { Harnesses } from './harnesses';
import { type AgentEvent, type AgentSpec, withRest } from './runtime';
import { findTranscript, threadsDirs, transcriptsDir } from './transcript';

const tempDir = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

test('a saved setup is initially empty and each session keeps its own folder on rest, restart and transcript lookup', async () => {
  const dir = tempDir('agent-setups-');
  const database = join(dir, 'db.sqlite');
  let store = new Store(database);
  let setups = new HarnessSetups(dir, store);
  const specs: AgentSpec[] = [];
  const events: AgentEvent[] = [];
  const spec: AgentSpec = { cwd: dir, system: '', tools: [], onEvent: (e) => events.push(e) };
  const fake = withRest({ start(given) {
    specs.push(given);
    let end!: () => void;
    return { send() {}, close: () => end(), done: new Promise<void>((resolve) => (end = resolve)) };
  } }, 1);
  const start = (more: Partial<AgentSpec> = {}) => setups.runtime(fake).start({ ...spec, ...more });
  const owner = start();
  const ownerFolder = ownerSetup('claude');
  expect(specs.at(-1)!.setup).toEqual(ownerFolder);
  specs.at(-1)!.onEvent({ type: 'session', id: 'owner-session' });

  await setups.save('claude', { separate: true });
  const selected = await setups.view('claude');
  expect(selected.folder).toBe(realpathSync(join(dir, 'agents', 'claude')));
  expect(readdirSync(selected.folder)).toEqual([]);
  const agent = start();
  const first = specs.at(-1)!;
  expect(first.setup).toEqual({ folder: selected.folder, mode: 'separate' });
  first.onEvent({ type: 'session', id: 'agent-session' });
  first.onEvent({ type: 'idle' });
  await Bun.sleep(10);
  await setups.save('claude', { separate: true, folder: join(dir, 'different folder') });
  agent.send('continue');
  await Bun.sleep(10);
  expect(specs.at(-1)).toMatchObject({ setup: first.setup, resume: 'agent-session' });
  specs.at(-1)!.onEvent({ type: 'error', message: 'Run /login first' });
  expect(events.at(-1)).toMatchObject({ setup: first.setup });

  owner.close();
  agent.close();
  await Promise.all([owner.done, agent.done]);
  store.db.close();
  store = new Store(database);
  setups = new HarnessSetups(dir, store);
  const resumed = start({ resume: 'agent-session' });
  expect(specs.at(-1)!.setup).toEqual(first.setup);
  expect(setups.at('claude', 'owner-session')).toEqual(ownerFolder);
  expect(setups.at('claude', 'pre-change-session')).toEqual(ownerFolder);
  expect(setups.at('claude').folder).not.toBe(selected.folder);
  expect((await setups.view('codex')).separate).toBe(false);
  const transcriptFolder = join(transcriptsDir(selected.folder), 'workspace');
  mkdirSync(transcriptFolder, { recursive: true });
  writeFileSync(join(transcriptFolder, 'agent-session.jsonl'), 'fixture');
  const profile = setups.at('claude', 'agent-session');
  expect(findTranscript('agent-session', null, transcriptsDir(profile.folder), threadsDirs(profile.folder))).toBe(join(transcriptFolder, 'agent-session.jsonl'));
  resumed.close();
  await resumed.done;
  store.db.close();
});

test('Claude copy merges only missing MCP definitions and copies allowed files without following destination links', async () => {
  const home = tempDir('copy-claude-');
  const owner = ownerSetup('claude', {}, home);
  const target = { folder: join(home, 'agent home'), mode: 'separate' as const };
  mkdirSync(join(owner.folder, 'skills', 'shared'), { recursive: true });
  mkdirSync(join(owner.folder, 'commands'));
  mkdirSync(join(owner.folder, 'agents'));
  mkdirSync(join(target.folder, 'skills', 'shared'), { recursive: true });
  writeFileSync(join(owner.folder, 'skills', 'shared', 'SKILL.md'), 'owner skill');
  writeFileSync(join(target.folder, 'skills', 'shared', 'SKILL.md'), 'existing skill');
  writeFileSync(join(owner.folder, 'settings.json'), JSON.stringify({
    permissions: {},
    env: { AWS_SECRET_ACCESS_KEY: 'secret', ANTHROPIC_CUSTOM_HEADERS: 'Authorization: Bearer private', KEEP: 'value' },
  }));
  writeFileSync(join(owner.folder, 'CLAUDE.md'), 'owner instructions');
  writeFileSync(join(owner.folder, 'commands', 'check.md'), 'check');
  writeFileSync(join(owner.folder, 'agents', 'review.md'), 'review');
  writeFileSync(join(owner.folder, '.credentials.json'), 'private login');
  writeFileSync(join(owner.folder, 'mcp-needs-auth-cache.json'), 'private MCP login');
  const canLink = process.platform !== 'win32';
  if (canLink) symlinkSync('shared', join(owner.folder, 'skills', 'linked'));
  writeFileSync(claudeStateFile(owner), JSON.stringify({
    oauthAccount: { email: 'private' },
    projects: { '/workspace': {} },
    mcpServers: { taken: { command: 'source' }, extra: {
      command: 'tool',
      headers: { Authorization: 'Bearer private-value', 'X-Client': 'obeya' },
      env: { OTHER_TOKEN: '${OTHER_TOKEN}', API_KEY: 'private-key' },
    } },
  }));
  writeFileSync(claudeStateFile(target), JSON.stringify({
    customState: 1, mcpServers: { taken: { command: 'target' } },
  }));
  const lock = `${claudeStateFile(target)}.lock`;
  mkdirSync(lock);
  const copying = copySetup('claude', owner, target);
  await Bun.sleep(30);
  writeFileSync(claudeStateFile(target), JSON.stringify({
    customState: 2, mcpServers: { taken: { command: 'target' } },
  }));
  rmdirSync(lock);
  expect(await copying).toEqual({
    settings: true, instructions: true, mcpServers: 1, skills: Number(canLink), commands: 1, agents: 1,
  });
  expect(JSON.parse(readFileSync(claudeStateFile(target), 'utf8'))).toEqual({
    customState: 2, mcpServers: { taken: { command: 'target' }, extra: {
      command: 'tool', headers: { 'X-Client': 'obeya' }, env: { OTHER_TOKEN: '${OTHER_TOKEN}' },
    } },
  });
  expect(JSON.parse(readFileSync(join(target.folder, 'settings.json'), 'utf8'))).toEqual({ permissions: {}, env: { KEEP: 'value' } });
  expect(existsSync(join(target.folder, '.credentials.json'))).toBe(false);
  expect(existsSync(join(target.folder, 'mcp-needs-auth-cache.json'))).toBe(false);
  expect(readFileSync(join(target.folder, 'skills', 'shared', 'SKILL.md'), 'utf8')).toBe('existing skill');
  if (canLink) {
    expect(lstatSync(join(target.folder, 'skills', 'linked')).isSymbolicLink()).toBe(true);
    expect(realpathSync(join(target.folder, 'skills', 'linked'))).toBe(realpathSync(join(owner.folder, 'skills', 'shared')));
  }
  mkdirSync(lock);
  utimesSync(lock, new Date(0), new Date(0));
  expect(await copySetup('claude', owner, target)).toEqual({
    settings: false, instructions: false, mcpServers: 0, skills: 0, commands: 0, agents: 0,
  });
});

test('Codex copy includes TOML MCP definitions and leaves auth, OAuth files, plugins and threads behind', async () => {
  const home = tempDir('copy-codex-');
  const owner = ownerSetup('codex', { CODEX_HOME: join(home, 'configured') }, home);
  const target = { folder: join(home, 'separate'), mode: 'separate' as const };
  for (const folder of [owner.folder, target.folder, join(owner.folder, 'plugins'), join(owner.folder, 'sessions')]) mkdirSync(folder, { recursive: true });
  const config = '[mcp_servers.docs]\nurl = "https://example.test/mcp"\n[mcp_servers.docs.http_headers]\nAuthorization = "Bearer private"\n"X-Client" = "Obeya"\n';
  writeFileSync(join(owner.folder, 'config.toml'), config);
  writeFileSync(join(owner.folder, 'AGENTS.md'), 'owner instructions');
  writeFileSync(join(target.folder, 'AGENTS.md'), 'existing instructions');
  writeFileSync(join(owner.folder, 'auth.json'), 'private login');
  writeFileSync(join(owner.folder, '.mcp-oauth.json'), 'private MCP login');
  expect(await copySetup('codex', owner, target)).toMatchObject({ settings: true, instructions: false, mcpServers: 1 });
  expect(readdirSync(target.folder).sort()).toEqual(['AGENTS.md', 'config.toml']);
  expect(Bun.TOML.parse(readFileSync(join(target.folder, 'config.toml'), 'utf8'))).toEqual({
    mcp_servers: { docs: { url: 'https://example.test/mcp', http_headers: { 'X-Client': 'Obeya' } } },
  });
  expect(readFileSync(join(target.folder, 'AGENTS.md'), 'utf8')).toBe('existing instructions');
});

test('an explicit Claude fallback and a separate Codex login never inherit interactive credential variables', async () => {
  const setup = { folder: tempDir('setup-auth-'), mode: 'separate' as const };
  const inherited = { CLAUDE_SECURESTORAGE_CONFIG_DIR: 'interactive', ANTHROPIC_API_KEY: 'interactive', CLAUDE_CODE_OAUTH_TOKEN: 'owner', CODEX_API_KEY: 'interactive', OPENAI_API_KEY: 'owner', GH_TOKEN: 'unchanged' };
  expect(setupEnv('claude', setup, inherited)).toMatchObject({ CLAUDE_CONFIG_DIR: setup.folder, GH_TOKEN: 'unchanged' });
  expect(setupEnv('claude', setup, inherited).CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  expect(setupEnv('claude', setup, inherited).CLAUDE_SECURESTORAGE_CONFIG_DIR).toBeUndefined();
  expect(setupEnv('codex', setup, inherited).CODEX_API_KEY).toBeUndefined();
  expect(setupEnv('codex', setup, inherited).OPENAI_API_KEY).toBeUndefined();
  await saveSetupToken(setup, 'agent-token');
  expect(setupEnv('claude', setup, inherited).CLAUDE_CODE_OAUTH_TOKEN).toBe('agent-token');
  expect(setupEnv('claude', setup, inherited, false).CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
});

test('aliases and launch commands quote shell paths on Unix and Windows', async () => {
  expect(setupAlias('codex', '/home/me/.obeya/agents/codex', 'linux')).toBe("alias codex-obeya='env -u CODEX_API_KEY -u OPENAI_API_KEY CODEX_HOME=/home/me/.obeya/agents/codex codex'");
  const windows = setupAlias('claude', "C:\\Users\\O'Brien\\Agent setup", 'win32');
  expect(windows).toContain("C:\\Users\\O''Brien\\Agent setup");
  expect(windows).toContain('finally { foreach ($key in $previous.Keys)');
  if (process.platform === 'win32') return;
  const folder = "/tmp/agent's folder $(printf unsafe)";
  const script = setupLoginCommand('claude', { folder, mode: 'separate' }, ['/usr/bin/printenv', 'CLAUDE_CONFIG_DIR'], 'darwin');
  const p = Bun.spawn(['/bin/sh', '-c', script]);
  expect((await new Response(p.stdout).text()).trim()).toBe(folder);
  expect(await p.exited).toBe(0);
  const alias = setupAlias('codex', folder, 'darwin');
  const run = Bun.spawn(['/bin/bash', '-O', 'expand_aliases', '-c', `${alias.replace(/codex'$/, "/usr/bin/printenv'")}
codex-obeya CODEX_HOME`]);
  expect(await new Response(run.stdout).text()).toBe(folder + "\n");
  expect(await run.exited).toBe(0);
});

test('a setup with a link to the owner Claude state cannot be selected', async () => {
  if (process.platform === 'win32') return;
  const home = tempDir('linked-setup-');
  const store = new Store(':memory:');
  try {
    const ownerFolder = join(home, 'interactive');
    mkdirSync(ownerFolder);
    const ownerEnv = { CLAUDE_CONFIG_DIR: ownerFolder };
    const setups = new HarnessSetups(home, store, ownerEnv);
    const target = join(home, 'linked');
    mkdirSync(target);
    const owner = claudeStateFile(ownerSetup('claude', ownerEnv));
    writeFileSync(owner, '{}');
    symlinkSync(owner, join(target, '.claude.json'));
    await expect(setups.save('claude', { separate: true, folder: target })).rejects.toThrow('separate Claude Code state file');
    expect((await setups.view('claude')).separate).toBe(false);
  } finally {
    store.db.close();
  }
});

test('a token entered in a stale Configuration panel cannot be saved to the newly selected folder', async () => {
  const home = tempDir('setup-token-target-');
  const store = new Store(':memory:');
  try {
    const setups = new HarnessSetups(home, store);
    await setups.save('claude', { separate: true });
    const original = setups.at('claude');
    const config = new Config({
      file: join(home, 'canvases.json'), source: 'file', started: [], store, running: () => [],
      server: { home, port: 0, permissionMode: 'auto' },
    });
    const machine = new MachineSetup({ home, config, harnessSetups: setups });
    await setups.save('claude', { separate: true, folder: join(home, 'another') });
    await expect(setups.copy('claude', original.folder)).rejects.toThrow('setup changed');
    await expect(machine.saveToken({ token: 'first-profile-token', folder: original.folder })).rejects.toThrow('setup changed');
    expect(setupEnv('claude', setups.at('claude'), {}).CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(setupEnv('claude', original, {}).CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    await machine.saveToken({ token: 'first-profile-token' }, original);
    expect(setupEnv('claude', original, {}).CLAUDE_CODE_OAUTH_TOKEN).toBe('first-profile-token');
  } finally {
    store.db.close();
  }
});

test('an older readiness probe cannot publish after the active setup has changed', async () => {
  const pending: ((loggedIn: boolean) => void)[] = [];
  const harnesses = new Harnesses({
    cwd: '.',
    claude: () => new Promise((done) => pending.push((loggedIn) => done({ loggedIn, version: '3.0.0' }))),
    codex: async () => null,
  });
  const old = harnesses.refresh();
  const changed = harnesses.setupChanged('claude');
  pending[1]!(false);
  await changed;
  pending[0]!(true);
  await old;
  expect(harnesses.ready('claude')).toBe(false);
});
