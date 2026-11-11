// Throwaway change view, extended from 854e0f8c. The director starts it for each take.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../../..');
const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trimEnd();
const commit = git('rev-parse', '8a82fe8a^{commit}');
const parent = git('rev-parse', `${commit}^`);
const files = git('diff', '--numstat', parent, commit).split('\n').map((row) => {
  const [added, removed, file] = row.split('\t');
  const area = file!.endsWith('.test.ts') ? 'Tests' : file!.startsWith('docs/') ? 'Documentation' : file!.split('/')[1];
  return { file: file!, added: Number(added), removed: Number(removed), area };
});
const contents = new Map<string, string[]>();
const source = (file: string) => {
  if (!contents.has(file)) contents.set(file, git('show', `${commit}:${file}`).split('\n'));
  return contents.get(file)!;
};
const nodes = [
  { id: 'config', file: 'src/ui/config.tsx', title: 'Choose speed', x: 16, y: 100, w: 240, h: 94 },
  { id: 'strings', file: 'src/ui/strings.ts', title: 'Name the choices', x: 16, y: 272, w: 240, h: 80 },
  { id: 'styles', file: 'src/ui/styles.css', title: 'Fit the extra control', x: 16, y: 426, w: 240, h: 80 },
  { id: 'settings', file: 'src/server/settings.ts', title: 'Validate + store', x: 310, y: 100, w: 348, h: 94 },
  { id: 'runtime', file: 'src/server/runtime.ts', title: 'Apply group policy', x: 310, y: 272, w: 348, h: 104 },
  { id: 'codex', file: 'src/server/codex.ts', title: 'Translate to service tier', x: 310, y: 426, w: 348, h: 80 },
  { id: 'types', file: 'src/core/types.ts', title: 'Shared vocabulary', x: 712, y: 100, w: 232, h: 94 },
].map(node => {
  source(node.file); // Every box must name a real path in the filmed commit.
  return { ...node, ...files.find(f => f.file === node.file)! };
});
// Arrows are selected uses, not a complete import graph. Existing bridges stay explicit.
const edges = [
  { id: 'save', d: 'M256 147 H310', cross: true, label: 'HTTP', tx: 283, ty: 131, proof: [['src/ui/config.tsx', 907], ['src/ui/api.ts', 184], ['src/server/server.ts', 665]], note: 'UI saves through the existing API; settings validates the choice.' },
  { id: 'labels', d: 'M136 194 V272', label: 'uses labels', tx: 197, ty: 237, proof: [['src/ui/config.tsx', 902]], note: 'The selector uses the existing German and English string tables.' },
  { id: 'read', d: 'M484 272 V194', label: 'reads group choice', tx: 566, ty: 236, proof: [['src/server/runtime.ts', 191], ['src/server/main.ts', 352], ['src/server/canvas.ts', 299]], note: 'Runtime asks an injected callback; it does not import the settings store.' },
  { id: 'launch', d: 'M484 376 V426', label: 'starts via routing', tx: 566, ty: 405, proof: [['src/server/runtime.ts', 198], ['src/server/main.ts', 365]], note: 'The existing harness router carries AgentSpec into the Codex runtime.' },
  { id: 'shared-ui', d: 'M136 100 V64 H828 V100', cross: true, label: 'uses shared type', tx: 475, ty: 56, proof: [['src/ui/config.tsx', 7]], note: 'UI and server import the shared contract from core; core imports neither.' },
  { id: 'shared-settings', d: 'M658 147 H712', cross: true, label: 'type', tx: 685, ty: 131, proof: [['src/server/settings.ts', 13]], note: 'Settings uses the speed vocabulary defined in core.' },
  { id: 'shared-runtime', d: 'M658 324 H685 V180 H712', cross: true, proof: [['src/server/runtime.ts', 31]], note: 'Launch policy uses the same AgentSetting and AgentSpeed contract.' },
];
for (const edge of edges) for (const [file, line] of edge.proof) {
  if (!source(String(file))[Number(line) - 1]) throw new Error(`Missing arrow evidence: ${file}:${line}`);
}
const changed = new Map<string, Set<number>>();
for (const { file } of files) {
  let after = 0;
  const added = new Set<number>();
  for (const line of git('diff', '--no-ext-diff', '--unified=0', parent, commit, '--', file).split('\n')) {
    const header = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) { after = Number(header[1]); continue; }
    if (!after || line.startsWith('+++') || line.startsWith('---') || line.startsWith('\\')) continue;
    if (line.startsWith('+')) added.add(after++);
    else if (line.startsWith(' ')) after++;
  }
  changed.set(file, added);
}
const html = readFileSync(new URL('./change-view.html', import.meta.url), 'utf8');
const server = Bun.serve({
  hostname: '127.0.0.1', port: Number(process.env.CODE_VIEW_PORT ?? 0),
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/change.json') return Response.json({ commit, parent, files, nodes, edges });
    if (url.pathname === '/excerpt') {
      const file = url.searchParams.get('file')!;
      const from = Number(url.searchParams.get('from'));
      const to = Number(url.searchParams.get('to'));
      if (!contents.has(file) || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > source(file).length) return new Response('Unknown excerpt', { status: 400 });
      return Response.json(source(file).slice(from - 1, to).map((text, i) => ({ after: from + i, kind: changed.get(file)?.has(from + i) ? 'add' : 'context', text })));
    }
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  },
});
console.log(`http://127.0.0.1:${server.port}`);
