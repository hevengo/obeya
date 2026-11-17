// The owner and agent setups on this machine. A session uses the location from its first start,
// including the default Claude Code convention (~/.claude.json lives beside ~/.claude).

import { constants, lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { copyFile as copyExclusive, lstat, mkdir, readFile, readdir, readlink, realpath, rename, rm, rmdir, stat, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Harness, HarnessSetup, HarnessSetupView, SetupCopy } from '../core/agents';
import { claudeLoginFailed, codexLoginLost } from '../core/login';
import { messageOf } from '../core/text';
import { BadRequest } from './board';
import type { Store } from './db';
import { remote, sh } from './hosts';
import { type AgentRuntime, sessionHarness, startingLater } from './runtime';
import { harnessSetupChoice, saveHarnessSetupChoice } from './settings';

type Env = Record<string, string | undefined>;
export const SETUP_ENV: Record<Harness, string> = { claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' };
const SETTINGS: Record<Harness, string> = { claude: 'settings.json', codex: 'config.toml' };
const INSTRUCTIONS: Record<Harness, string> = { claude: 'CLAUDE.md', codex: 'AGENTS.md' };
const copyReceipt = (harness: Harness) => `.obeya-${harness}-settings-copy.json`;
const FALLBACK_TOKEN = '.obeya-claude-token';
const CREDENTIAL_ENV: Record<Harness, string[]> = {
  claude: ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_CUSTOM_HEADERS', 'CLAUDE_SECURESTORAGE_CONFIG_DIR'],
  codex: ['CODEX_API_KEY', 'OPENAI_API_KEY'],
};

const envKeys = (env: Env, name: string) => process.platform === 'win32'
  ? Object.keys(env).filter((key) => key.toUpperCase() === name).sort()
  : [name];

export function ownerSetup(harness: Harness, env: Env = process.env, home = homedir()): HarnessSetup {
  const key = SETUP_ENV[harness];
  const given = env[envKeys(env, key)[0] ?? key];
  return given ? { folder: resolve(given), mode: 'inherited' } : { folder: join(home, `.${harness}`), mode: 'default' };
}

export function claudeStateFile(setup: HarnessSetup): string {
  return join(setup.mode === 'default' ? dirname(setup.folder) : setup.folder, '.claude.json');
}

export function setupEnv(harness: Harness, setup: HarnessSetup, env: Env = process.env, useFallback = true): Env {
  const out = { ...env };
  const key = SETUP_ENV[harness];
  const clear = setup.mode === 'separate' ? [key, ...CREDENTIAL_ENV[harness]] : [key];
  for (const name of clear) for (const spelling of envKeys(out, name)) delete out[spelling];
  if (setup.mode !== 'default') out[key] = setup.folder;
  if (setup.mode === 'separate' && harness === 'claude' && useFallback) {
    const file = join(setup.folder, FALLBACK_TOKEN);
    try {
      const info = lstatSync(file);
      if (info.isFile() && info.size < 8192) out.CLAUDE_CODE_OAUTH_TOKEN = readFileSync(file, 'utf8').trim() || undefined;
    } catch (e) {
      if (!missingFile(e)) throw e;
    }
  }
  return out;
}

export function ensureSetup(setup: HarnessSetup) {
  if (setup.mode === 'separate') mkdirSync(setup.folder, { recursive: true, mode: 0o700 });
}

export async function saveSetupToken(setup: HarnessSetup, token: string) {
  ensureSetup(setup);
  const file = join(setup.folder, FALLBACK_TOKEN);
  await replaceFile(file, token + '\n');
}

const ps = (s: string) => `'${s.replace(/'/g, "''")}'`;
const shellValue = (s: string) => /^[\w/.+=-]+$/.test(s) ? s : sh(s);

/** An example the owner can put in their shell. The Windows function restores the previous environment. */
export function setupAlias(harness: Harness, folder: string, platform = process.platform): string {
  const key = SETUP_ENV[harness];
  if (platform === 'win32') {
    const keys = [key, ...CREDENTIAL_ENV[harness]].map(ps).join(', ');
    return [
      `function ${harness}-obeya {`,
      '  $previous = @{}',
      `  foreach ($key in ${keys}) {`,
      '    $previous[$key] = [Environment]::GetEnvironmentVariable($key)',
      '    [Environment]::SetEnvironmentVariable($key, $null)',
      '  }',
      `  try { $env:${key} = ${ps(folder)}; & ${harness} @args }`,
      '  finally { foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key]) } }',
      '}',
    ].join('\n');
  }
  return `alias ${harness}-obeya=${sh(setupLoginCommand(harness, { folder, mode: 'separate' }, [harness], platform))}`;
}

/** A login starts in a new shell (on macOS it may be an already-running Terminal). */
export function setupLoginCommand(harness: Harness, setup: HarnessSetup, argv: string[], platform: string): string {
  const key = SETUP_ENV[harness];
  const clear = [...(setup.mode === 'default' ? [key] : []), ...(setup.mode === 'separate' ? CREDENTIAL_ENV[harness] : [])];
  if (platform === 'win32') {
    const script = [
      ...clear.map((k) => `Remove-Item Env:${k} -ErrorAction SilentlyContinue`),
      ...(setup.mode === 'default' ? [] : [`$env:${key} = ${ps(setup.folder)}`]),
      `& ${argv.map(ps).join(' ')}`,
    ].join('\n');
    return `powershell -NoProfile -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`;
  }
  return ['env', ...clear.flatMap((k) => ['-u', k]), ...(setup.mode === 'default' ? [] : [shellValue(`${key}=${setup.folder}`)]), ...argv.map(shellValue)].join(' ');
}

export class HarnessSetups {
  private copying = new Set<string>();

  constructor(private home: string, private store: Store, private baseEnv: Env = process.env) {}

  /** Unrecorded sessions predate the choice and always use the owner's setup. */
  at(harness: Harness, session?: string | null): HarnessSetup {
    const owner = ownerSetup(harness, this.baseEnv);
    if (session) return this.store.sessionSetup(session) ?? owner;
    const choice = harnessSetupChoice(this.home, harness);
    return choice?.separate ? { folder: choice.folder, mode: 'separate' } : owner;
  }

  env(harness: Harness): Env {
    const setup = this.at(harness);
    ensureSetup(setup);
    return setupEnv(harness, setup, this.baseEnv);
  }

  async view(harness: Harness): Promise<HarnessSetupView> {
    const choice = harnessSetupChoice(this.home, harness);
    const folder = choice?.folder ?? join(this.home, 'agents', harness);
    if (!choice?.separate) return { separate: false, folder };
    const receipt = join(folder, copyReceipt(harness));
    const base = { separate: true, folder, alias: setupAlias(harness, folder) };
    try {
      const [previous, settings] = await Promise.all([entry(receipt), entry(join(folder, SETTINGS[harness]))]);
      const copied = previous?.isFile() ? await readJson(receipt) as SetupCopy : undefined;
      return { ...base, canCopy: !previous && !settings, copied };
    } catch {
      // A folder may no longer be accessible. Configuration must still let the owner change it.
      return base;
    }
  }

  async save(harness: Harness, input: unknown): Promise<void> {
    const { separate, folder: given } = (input ?? {}) as { separate?: unknown; folder?: unknown };
    if (typeof separate !== 'boolean' || (given !== undefined && typeof given !== 'string'))
      throw new BadRequest('invalid', 'choose a setup and folder');
    const choice = harnessSetupChoice(this.home, harness);
    const folder = given === undefined ? choice?.folder ?? join(this.home, 'agents', harness) : given.trim().replace(/^~(?=$|[\\/])/, homedir());
    if (!isAbsolute(folder) || /[\x00-\x1f]/.test(folder)) throw new BadRequest('invalid', 'enter an absolute folder path');
    const setup = { folder: resolve(folder), mode: 'separate' as const };
    if (separate) setup.folder = await this.checkFolder(harness, setup.folder);
    saveHarnessSetupChoice(this.home, harness, { separate, folder: setup.folder });
  }

  private async checkFolder(harness: Harness, path: string): Promise<string> {
    try {
      const folder = await canonical(path);
      for (const h of ['claude', 'codex'] as const) {
        if (relative(await canonical(ownerSetup(h, this.baseEnv).folder), folder) === '')
          throw new Error("the agents' folder must differ from the owner's setup");
      }
      const owner = ownerSetup(harness, this.baseEnv);
      if (harness === 'claude') {
        const state = await canonical(claudeStateFile({ folder, mode: 'separate' }));
        if (relative(await canonical(claudeStateFile(owner)), state) === '')
          throw new Error("the agents' folder must use a separate Claude Code state file");
      }
      for (const name of ['skills', 'commands', 'prompts', 'agents', 'plugins', 'projects', 'sessions', 'archived_sessions']) {
        if (withinFolder(await canonical(join(owner.folder, name)), folder))
          throw new Error("the agents' folder must be outside the owner's skill and state directories");
      }
      await mkdir(folder, { recursive: true, mode: 0o700 });
      return folder;
    } catch (e) {
      throw new BadRequest('invalid', messageOf(e));
    }
  }

  async copy(harness: Harness, folderShown: unknown): Promise<void> {
    const setup = this.at(harness);
    if (setup.folder !== folderShown) throw new BadRequest('invalid', 'the agent setup changed while the dialog was open');
    if (setup.mode !== 'separate' || this.copying.has(setup.folder))
      throw new BadRequest('invalid', 'choose a separate folder without settings');
    this.copying.add(setup.folder);
    try {
      const folder = await this.checkFolder(harness, setup.folder);
      const receipt = join(folder, copyReceipt(harness));
      if (await entry(receipt) || await entry(join(folder, SETTINGS[harness])))
        throw new Error('this folder already has settings');
      const result = await copySetup(harness, ownerSetup(harness, this.baseEnv), { ...setup, folder });
      await writeFile(receipt, JSON.stringify(result), { flag: 'wx', mode: 0o600 });
    } catch (e) {
      throw new BadRequest('invalid', messageOf(e));
    } finally {
      this.copying.delete(setup.folder);
    }
  }

  /** Outside the resting runtime so giving up and reopening its process keeps the same setup. */
  runtime(runtime: AgentRuntime): AgentRuntime {
    return {
      start: (spec, first, images) => {
        if (remote(spec.cwd)) return runtime.start(spec, first, images);
        const harness = spec.harness ?? (spec.resume ? sessionHarness(spec.resume) : 'claude');
        const setup = spec.setup ?? this.at(harness, spec.resume);
        const ready = {
          ...spec,
          setup,
          onEvent: (e: Parameters<typeof spec.onEvent>[0]) => {
            if (e.type === 'session') this.store.keepSessionSetup(e.id, setup);
            if (e.type === 'error' && (claudeLoginFailed(e.message) || codexLoginLost(e.message))) spec.onEvent({ ...e, setup });
            else spec.onEvent(e);
          },
        };
        try {
          ensureSetup(setup);
          return runtime.start(ready, first, images);
        } catch (error) {
          return startingLater(Promise.resolve(() => { throw error; }), ready);
        }
      },
    };
  }
}

const missingFile = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';

async function entry(file: string) {
  try {
    return await lstat(file);
  } catch (e) {
    if (!missingFile(e)) throw e;
  }
}

/** Resolves symlinks even when the last part of the path has yet to be created. */
async function canonical(path: string): Promise<string> {
  if (await entry(path)) return realpath(path);
  const parent = dirname(path);
  return parent === path ? path : join(await canonical(parent), relative(parent, path));
}

function withinFolder(parent: string, path: string): boolean {
  const fromParent = relative(parent, path);
  return fromParent === '' || (!isAbsolute(fromParent) && fromParent !== '..' && !fromParent.startsWith(`..${sep}`));
}

async function readJson(file: string): Promise<unknown> {
  if (!await entry(file)) return undefined;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    throw new Error(`Could not read JSON from ${file}`);
  }
}

function fields(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function replaceFile(file: string, text: string, mode = 0o600) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temp, text, { flag: 'wx', mode });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}

async function copyFile(from: string, to: string): Promise<boolean> {
  if (await entry(to) || !await entry(from)) return false;
  if (!(await stat(from)).isFile()) return false;
  try {
    await copyExclusive(from, to, constants.COPYFILE_EXCL);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    return false;
  }
}

/** Keep a link's target even for a relative link. Never write through existing destination links. */
async function copyEntry(from: string, to: string, parents: string[] = []): Promise<boolean> {
  const [source, target] = await Promise.all([entry(from), entry(to)]);
  if (!source || (target && !(source.isDirectory() && target.isDirectory()))) return false;
  if (source.isSymbolicLink()) {
    const link = resolve(dirname(from), await readlink(from));
    try {
      const type = process.platform === 'win32' && await entry(link) && (await stat(link)).isDirectory() ? 'dir' : 'file';
      await symlink(link, to, type);
      return true;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') return false;
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'ENOSYS' && code !== 'ENOTSUP') throw e;
      return copyEntry(await realpath(link), to, parents);
    }
  }
  if (!source.isDirectory()) return copyFile(from, to);
  const real = await realpath(from);
  if (parents.includes(real) || withinFolder(real, await canonical(to))) throw new Error(`Cannot copy ${from} into itself`);
  if (!target) await mkdir(to, { mode: 0o700 });
  let copied = !target;
  for (const name of await readdir(from)) {
    if (await copyEntry(join(from, name), join(to, name), [...parents, real])) copied = true;
  }
  return copied;
}

async function copyEntries(from: string, to: string): Promise<number> {
  if (!await entry(from) || !(await stat(from)).isDirectory()) return 0;
  const dest = await entry(to);
  if (dest && !dest.isDirectory()) return 0;
  const names = await readdir(from);
  if (!names.length) return 0;
  if (withinFolder(await realpath(from), await canonical(to))) throw new Error(`Cannot copy ${from} into itself`);
  await mkdir(to, { recursive: true, mode: 0o700 });
  let copied = 0;
  for (const name of names) {
    if (await copyEntry(join(from, name), join(to, name))) copied++;
  }
  return copied;
}

async function copyClaudeMcp(owner: HarnessSetup, setup: HarnessSetup): Promise<number> {
  const from = fields(fields(await readJson(claudeStateFile(owner))).mcpServers);
  if (!Object.keys(from).length) return 0;
  const file = claudeStateFile(setup);
  // Claude Code uses this same directory lock for its global state, including sign-in writes.
  const lock = `${file}.lock`;
  const staleAfter = 10_000;
  const until = Date.now() + staleAfter + 1000;
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const held = await entry(lock);
      if (!held) continue;
      // A Claude process can exit before releasing the lock. Use its stale threshold.
      if (held.isDirectory() && Date.now() - held.mtimeMs > staleAfter) {
        await rmdir(lock).catch((error) => { if (!missingFile(error)) throw error; });
        continue;
      }
      if (!held.isDirectory() || Date.now() >= until) throw new Error('Claude Code is updating this setup. Try copying again.');
      await Bun.sleep(100);
    }
  }
  try {
    const existing = await entry(file);
    if (existing && !existing.isFile()) return 0;
    const state = fields(await readJson(file));
    const already = fields(state.mcpServers);
    const missing = Object.fromEntries(Object.entries(from)
      .filter(([key]) => !Object.hasOwn(already, key))
      .map(([key, definition]) => [key, withoutInlineAuth(definition)]));
    const count = Object.keys(missing).length;
    if (count) {
      const text = JSON.stringify({ ...state, mcpServers: { ...already, ...missing } }, null, 2) + '\n';
      if (existing) await replaceFile(file, text, existing.mode & 0o777);
      else await writeFile(file, text, { flag: 'wx', mode: 0o600 });
    }
    return count;
  } finally {
    await rmdir(lock);
  }
}

/** Keep references to credentials supplied separately, but omit inline authentication values. */
const credentialName = (key: string) => /authorization$|cookie$|apikey$|secret$|password$|token$|^aws(secretaccesskey|accesskeyid)$|^anthropiccustomheaders$/i.test(key.replace(/[-_]/g, ''));
const envReference = (value: unknown) => typeof value === 'string' && /^(?:[A-Za-z]+ )?\$(?:\{[A-Za-z_]\w*\}|[A-Za-z_]\w*)$/.test(value);

function withoutSecrets(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key, val]) => !credentialName(key) || envReference(val)));
}

function withoutInlineAuth(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const clean = withoutSecrets(fields(value));
  for (const key of ['headers', 'http_headers', 'env', 'oauth']) {
    if (clean[key] && typeof clean[key] === 'object') clean[key] = withoutSecrets(fields(clean[key]));
  }
  return clean;
}

async function copySettings(harness: Harness, owner: HarnessSetup, setup: HarnessSetup): Promise<Pick<SetupCopy, 'settings' | 'mcpServers'>> {
  const name = SETTINGS[harness];
  const from = join(owner.folder, name);
  const to = join(setup.folder, name);
  const absent = { settings: false, mcpServers: 0 };
  if (await entry(to) || !await entry(from) || !(await stat(from)).isFile()) return absent;
  const original = await readFile(from, 'utf8');
  const json = harness === 'claude';
  let config: Record<string, unknown>;
  try {
    config = fields(json ? Bun.JSONC.parse(original) : Bun.TOML.parse(original));
  } catch {
    throw new Error(`Could not read settings from ${from}`);
  }
  const before = JSON.stringify(config);
  for (const key of ['mcp_servers', 'model_providers']) {
    if (key in config) config[key] = Object.fromEntries(Object.entries(fields(config[key])).map(([id, value]) => [id, withoutInlineAuth(value)]));
  }
  if (json && 'env' in config) config.env = withoutSecrets(fields(config.env));
  const copy = before === JSON.stringify(config) ? original : json ? JSON.stringify(config, null, 2) + '\n' : Bun.TOML.stringify(config);
  if (copy === undefined) throw new Error(`Could not write settings from ${from}`);
  try {
    await writeFile(to, copy, { flag: 'wx', mode: 0o600 });
    return { settings: true, mcpServers: json ? 0 : Object.keys(fields(config.mcp_servers)).length };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    return absent;
  }
}

/** Copy only the named settings and content roots. Credential stores and harness state stay put. */
export async function copySetup(harness: Harness, owner: HarnessSetup, setup: HarnessSetup): Promise<SetupCopy> {
  const entries = (name: string) => copyEntries(join(owner.folder, name), join(setup.folder, name));
  const file = (name: string) => copyFile(join(owner.folder, name), join(setup.folder, name));
  const mcpServers = harness === 'claude' ? await copyClaudeMcp(owner, setup) : 0;
  const instructions = await file(INSTRUCTIONS[harness]);
  const skills = await entries('skills');
  const commands = await entries(harness === 'claude' ? 'commands' : 'prompts');
  const agents = await entries('agents');
  const config = await copySettings(harness, owner, setup);
  return { settings: config.settings, instructions, mcpServers: mcpServers + config.mcpServers, skills, commands, agents };
}
