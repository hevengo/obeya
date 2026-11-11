// Run with Node. Video, voice and frames stay outside git.
import { runDemo, type Director, type Scene } from '../lib/director.ts';
import { spokenTimes } from '../lib/subtitles.ts';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const output = process.env.CODE_VIDEO_OUTPUT ?? join(homedir(), 'demos/obeya-code-design-8a82fe8a');
let server: ChildProcess | undefined;
let url: string;
type Part = { say: string; screen?: object; light?: string[]; note?: string; focus?: number; ring?: [number, number, number] };
const structure = { view: 'structure', title: 'One choice, three layers', subtitle: 'Codex speed selection · 8a82fe8a · 10 files · +126 −16' };
const patterns = {
  view: 'patterns', title: 'Extend the paths already here', subtitle: 'Patterns chosen · alternatives and precedents',
  panels: [
    { name: 'One settings path', rows: [
      ['Chosen', 'Extend group settings, with validation on the server.'],
      ['Not taken', 'A speed endpoint or store of its own: the choice belongs with model and effort.'],
      ['Already used', 'The same group settings carry harness, model and effort.'],
    ], where: 'src/ui/config.tsx → existing API → src/server/settings.ts' },
    { name: 'One shared contract', rows: [
      ['Chosen', 'Put the speed vocabulary beside AgentSetting in core.'],
      ['Not taken', 'Separate UI and server types: their allowed values could drift.'],
      ['Already used', 'AgentEffort and AgentSetting already cross this boundary.'],
    ], where: 'src/core/types.ts:2622–2634 · imported by UI and server' },
    { name: 'Policy wrapper + protocol adapter', rows: [
      ['Chosen', 'Extend the runtime wrapper; translate tier names in the Codex adapter.'],
      ['Not taken', 'Teach each agent role the protocol: every caller would repeat routing.'],
      ['Already used', 'The wrapper selects model and effort; the adapter opens Codex threads.'],
    ], where: 'src/server/runtime.ts:187–198 → src/server/codex.ts:626–642' },
  ],
};
const standout = {
  view: 'points', title: 'Normal must mean Normal', subtitle: 'One design choice to pause at · fact first, then the reason',
  panels: [
    { name: 'One default, two representations', rows: [
      ['Fact', 'Settings omit Normal; the Codex adapter sends an explicit default tier.'],
      ['Reason', 'Omission at the protocol boundary could keep a faster configured or resumed tier.'],
      ['Trade-off', 'Sparse storage and explicit execution need a translation between them.'],
    ], where: 'src/server/settings.ts:139 · src/server/codex.ts:629–642' },
  ],
  note: 'Least astonishment: choosing Normal must override a previous faster tier.',
};
const evidence = {
  view: 'evidence', title: 'One mapping, used on start and resume', subtitle: 'Two excerpts from git · full width · one wrapping rule',
  excerpts: [
    { file: 'src/server/codex.ts', from: 630, to: 630, label: 'Fast → priority · Ultrafast → ultrafast · Normal or absent → default' },
    { file: 'src/server/codex.ts', from: 639, to: 642, label: 'Both branches receive the same settings object, including the tier' },
  ],
  note: 'The adapter owns the protocol spelling. The rest of Obeya passes the speed choice.',
};
const chapters: { title: string; parts: Part[] }[] = [
  { title: 'Where the change sits', parts: [
    { say: 'Codex speed selection adds one choice across three layers.', screen: structure, light: ['config', 'settings', 'runtime', 'codex', 'types'] },
    { say: 'The repository instructions name the user interface, server, and shared core.', light: ['types', 'shared-ui', 'shared-settings', 'shared-runtime'] },
    { say: 'Labels and layout change with the selector; tests and documentation are counted here, not toured.', light: ['config', 'strings', 'styles', 'labels'], note: 'Seven implementation files · two test files · one design chapter. Counts come from git.' },
  ] },
  { title: 'The path of the choice', parts: [
    { say: 'The dialog saves the choice through the existing settings API, where the server validates and stores it.', screen: { ...structure, title: 'A choice becomes launch policy' }, light: ['config', 'save', 'settings'] },
    { say: 'At the next start or resume, launch policy reads the group choice through an injected callback.', light: ['settings', 'read', 'runtime'] },
    { say: 'The routed Codex runtime translates that choice into a service tier; an already running session keeps its speed.', light: ['runtime', 'launch', 'codex'] },
  ] },
  { title: 'What each side knows', parts: [
    { say: 'The user interface and server import the same vocabulary from core, which depends on neither.', screen: { ...structure, title: 'Shared vocabulary, separate responsibilities' }, light: ['config', 'settings', 'runtime', 'types', 'shared-ui', 'shared-settings', 'shared-runtime'] },
    { say: 'The dialog knows speed is Codex-only; it never needs the protocol tier names.', light: ['config', 'types'], note: 'The shared contract names speeds. Protocol tiers appear only in the Codex adapter.' },
    { say: 'Inside the server, policy chooses speed while the harness translates it: that internal boundary is inferred from the modules, not a named architectural layer.', light: ['runtime', 'launch', 'codex'], note: 'The three lanes come from CLAUDE.md. The policy / protocol boundary is inferred from the modules; existing dependency directions are preserved.' },
  ] },
  { title: 'Patterns chosen', parts: [
    { say: 'First, extend the existing settings path, as model and effort already do, instead of adding a separate route or speed store.', screen: patterns, focus: 0 },
    { say: 'Second, define the shared contract once in core, rather than let the user interface and server drift into separate vocabularies.', focus: 1 },
    { say: 'Third, extend the existing runtime wrapper and harness adapter, instead of teaching every agent role the Codex protocol.', focus: 2 },
  ] },
  { title: 'What stands out, with evidence', parts: [
    { say: 'One choice stands out: Normal is omitted from storage, but sent explicitly to Codex as default.', screen: standout },
    { say: 'That overrides a faster setting in Codex or a resumed thread, so Normal means what the owner selected.' },
    { say: 'Here is the mapping, followed by the same settings object on both start and resume.', screen: evidence, ring: [630, 630, 0] },
    { say: 'The trade-off is two representations of Normal, kept apart by the adapter.', ring: [639, 642, 1] },
  ] },
  { title: 'Recap', parts: [
    { say: 'The design extends three existing layers, keeps group policy on the server, and confines protocol translation to the harness.', screen: { ...structure, title: 'One choice, the existing architecture' }, light: ['config', 'save', 'settings', 'read', 'runtime', 'launch', 'codex', 'types'], note: 'Shared contract → group policy → protocol translation. No new module or dependency direction.' },
    { say: 'The git-backed views and narration parts would carry forward; the fixed graph layout is this prototype shortcut.', note: 'Carries: git-backed source, structure and panels, narration-linked lighting. Shortcut: manually chosen boxes, arrows and line ranges.' },
  ] },
];

// Each part is a sentence plus what it lights. Reuse the director's sentence timings,
// including heard-back word alignment, rather than hand-entering highlight fractions.
const scenes: Scene[] = chapters.map((chapter, index) => ({
  title: chapter.title,
  say: chapter.parts.map(p => p.say).join(' '),
  run: async (d: Director) => {
    const tts = join(d.workDir, 'tts.json');
    const clip = existsSync(tts) ? JSON.parse(readFileSync(tts, 'utf8')).clips[index] : undefined;
    const times = clip ? spokenTimes(clip.seconds, chapter.parts.map(p => p.say), clip.timed).sentences : chapter.parts.map(p => p.say.length);
    const total = times.reduce((sum: number, n: number) => sum + n, 0);
    let elapsed = 0;
    for (const [i, part] of chapter.parts.entries()) {
      await d.untilSpoken(elapsed / total);
      await d.evaluate(async (p) => {
        const view = (window as any).tour;
        if (p.screen) await view.show(p.screen);
        if (p.light || p.note) view.light(p.light ?? [], p.note);
        if (p.focus !== undefined) view.focus(p.focus);
        if (p.ring) view.ring(...p.ring);
      }, part);
      elapsed += times[i]!;
    }
  },
}));

try {
  await runDemo({
    title: 'Code video: Codex speed selection, at the level of design',
    baseUrl: 'http://127.0.0.1',
    viewport: { width: 1000, height: 800 },
    login: async (page) => {
      url = await new Promise<string>((resolve, reject) => {
        server = spawn('bun', [join(import.meta.dirname, 'change-view.ts')], { stdio: ['ignore', 'pipe', 'inherit'] });
        server.once('error', reject);
        server.once('exit', code => reject(new Error(`Change view exited: ${code}`)));
        server.stdout!.once('data', data => resolve(String(data).trim()));
      });
      await page.goto(url);
      await page.waitForFunction(() => (window as any).changeViewReady);
    },
    open: async (d) => {
      await d.goto(url);
      await d.page.waitForFunction(() => (window as any).changeViewReady);
      await d.evaluate(() => {
        const overlay = (window as any).__demo;
        overlay.moveTo(-100, -100, true);
        // The director parks its pointer after open(); this view has no pointer actions.
        overlay.moveTo = () => {};
      });
    },
    scenes,
    report: {
      summary: 'A design-level code video of landed change 8a82fe8a, adding Codex speed selection across UI, server and shared core. The structure view traces the choice and the knowledge on each side of a boundary. The patterns panel gives chosen approaches, rejected alternatives and existing precedents. One design choice is supported by two full-width excerpts read from git.\n\nJudge whether this is the right level, and whether the structure and patterns carry a code-quality decision. The three lanes follow the repository instructions; the internal policy/protocol boundary is explicitly inferred.\n\nThe git-backed views and narration-linked lighting carry forward. The graph positions, selected relationships and evidence ranges are hand-authored shortcuts. This throwaway prototype has no Obeya integration, tests, checks or permanent documentation changes.',
      meta: {
        source: '8a82fe8ab90b00d553b95f9f7888301e361c0a66 versus its first parent · +126 −16 · 10 files',
        prototype: 'Extends the change view from 854e0f8c; 1000×800, no pointer or navigation; two code excerpts total',
        boundaries: 'CLAUDE.md; docs/design.md; docs/design/agents-and-workspaces.md; policy/protocol inferred from modules',
        stack: 'Local git-backed change view, headless Chrome, demo skill director, Kokoro narration',
      },
    },
  }, output);
} finally {
  server?.kill();
}
