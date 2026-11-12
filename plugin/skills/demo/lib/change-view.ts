// Git-backed input for code videos. Plain Node, with the same local-page lifetime as the take.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

export const CHANGE_VIEWPORT = { width: 1000, height: 800 };
export interface SourceRange { file: string; from: number; to: number; revision?: string }
export interface ChangeBox { id: string; file: string; title: string; revision?: string }
export interface ChangeLane {
  title: string;
  subtitle?: string;
  boxes: ChangeBox[];
  /** The boundary follows this box in path order. */
  boundaries?: { after: string; label: string; inferred?: boolean }[];
}
export interface ChangeArrow { id: string; from: string; to: string; label: string; proof?: SourceRange[] }
interface ViewHeading { title: string; subtitle?: string; note?: string }
export type ChangeView = ViewHeading & (
  | { view: 'structure'; lanes: ChangeLane[]; arrows: ChangeArrow[] }
  | { view: 'patterns'; panels: { id: string; title: string; chosen: string; alternative: string; precedent: string; where: SourceRange[] }[] }
  | { view: 'observations'; panels: { id: string; title: string; fact: string; reason: string; tradeoff: string; where: SourceRange[] }[] }
  | { view: 'evidence'; excerpts: (SourceRange & { id: string; label?: string })[] }
);
export interface ChangeLighting {
  boxes?: string[];
  arrows?: string[];
  panels?: string[];
  lines?: { excerpt: string; from: number; to?: number }[];
}
export interface ChangedFile { file: string; added: number | null; removed: number | null; kind: 'code' | 'test' | 'documentation' | 'generated' }
export interface ExcerptLine { number: number; text: string; kind: 'add' | 'remove' | 'context' }
export interface ChangeOptions {
  repo: string;
  /** Explicit endpoints: a commit tour supplies its parent as base. */
  base: string;
  head: string;
  /** Repository-specific generated paths, counted rather than toured. */
  generated?: string[];
}

export class GitChange {
  readonly repo: string;
  readonly base: string;
  readonly head: string;
  readonly files: ChangedFile[];
  readonly #sources = new Map<string, string[]>();
  readonly #changed = new Map<string, { before: Set<number>; after: Set<number> }>();
  constructor(options: ChangeOptions) {
    this.repo = resolve(options.repo);
    this.base = this.revision(options.base);
    this.head = this.revision(options.head);
    const stats = this.git('diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--numstat', '-z', this.base, this.head, '--');
    this.files = stats.split('\0').filter(Boolean).map(row => {
      const [added, removed, ...path] = row.split('\t');
      const file = path.join('\t');
      const generated = options.generated?.includes(file) || /(?:^|\/)(?:dist|generated|vendor)\//.test(file) || /(?:^|\/)(?:bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(file);
      return { file, added: added === '-' ? null : Number(added), removed: removed === '-' ? null : Number(removed),
        kind: generated ? 'generated' : /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\./.test(file) ? 'test' : /(?:^|\/)docs?\/|\.(?:md|rst|txt)$/.test(file) ? 'documentation' : 'code' };
    });
  }
  private git(...args: string[]) {
    return execFileSync('git', ['--no-pager', '-C', this.repo, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  revision(ref: string): string {
    if (!ref || ref.startsWith('-')) throw new Error(`Invalid git revision ${JSON.stringify(ref)}; supply a commit or ref.`);
    try { return this.git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).trim(); }
    catch { throw new Error(`Missing git revision ${JSON.stringify(ref)}; supply an existing commit or ref.`); }
  }
  source(file: string, revision = this.head): string[] {
    if (!file || file.startsWith('/') || file.includes('\\') || file.split('/').some(p => !p || p === '..' || p === '.')) throw new Error(`Invalid git path ${JSON.stringify(file)}; use a repository-relative path.`);
    const rev = this.revision(revision);
    const key = `${rev}:${file}`;
    if (!this.#sources.has(key)) {
      let text: string;
      try {
        // Only blobs: a tree, symlink target or worktree file is not source evidence.
        const entry = this.git('ls-tree', '-z', rev, '--', `:(literal)${file}`).split('\0').find(r => r.slice(r.indexOf('\t') + 1) === file);
        if (!entry?.startsWith('100')) throw new Error('not a source blob');
        text = this.git('show', key);
      } catch { throw new Error(`Missing source ${file} at ${rev.slice(0, 8)}; check the path and revision (deleted files use base).`); }
      if (text.includes('\0')) throw new Error(`Binary source ${file}; choose a text file for the tour.`);
      const lines = text.split('\n');
      if (lines.at(-1) === '') lines.pop();
      this.#sources.set(key, lines.map(line => line.replace(/\r$/, '')));
    }
    return this.#sources.get(key)!;
  }
  range(range: SourceRange) {
    const revision = this.revision(range.revision ?? this.head);
    const lines = this.source(range.file, revision);
    if (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 1 || range.to < range.from || range.to > lines.length) {
      throw new Error(`Invalid range ${range.file}:${range.from}–${range.to} at ${revision.slice(0, 8)}; choose lines 1–${lines.length}.`);
    }
    return { ...range, revision };
  }
  excerpt(range: SourceRange): ExcerptLine[] {
    const checked = this.range(range);
    if (!this.#changed.has(checked.file)) {
      const before = new Set<number>(), after = new Set<number>();
      let oldLine = 0, newLine = 0, inHunk = false;
      for (const line of this.git('diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=0', this.base, this.head, '--', `:(literal)${checked.file}`).split('\n')) {
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); inHunk = true; }
        else if (!inHunk || line.startsWith('\\')) continue;
        else if (line.startsWith('+')) after.add(newLine++);
        else if (line.startsWith('-')) before.add(oldLine++);
        else if (line.startsWith(' ')) { oldLine++; newLine++; }
      }
      this.#changed.set(checked.file, { before, after });
    }
    const delta = this.#changed.get(checked.file)!;
    return this.source(checked.file, checked.revision).slice(checked.from - 1, checked.to).map((text, i) => {
      const number = checked.from + i;
      return { number, text, kind: checked.revision === this.head && delta.after.has(number) ? 'add' : checked.revision === this.base && delta.before.has(number) ? 'remove' : 'context' };
    });
  }
  prepare(view: ChangeView) {
    const ids = new Set<string>();
    const id = (value: string) => {
      if (!/^[a-zA-Z][\w-]*$/.test(value) || ids.has(value)) throw new Error(`Duplicate or invalid view id ${JSON.stringify(value)}; use unique names starting with a letter.`);
      ids.add(value);
    };
    const where = (ranges: SourceRange[]) => {
      if (!ranges.length) throw new Error('A panel needs a source location; supply where with a git path and line range.');
      return ranges.map(r => this.range(r));
    };
    let prepared;
    if (view.view === 'structure') {
      const boxes = new Set<string>();
      const lanes = view.lanes.map(lane => ({ ...lane, boxes: lane.boxes.map(box => {
        id(box.id); boxes.add(box.id);
        const revision = this.revision(box.revision ?? this.head);
        this.source(box.file, revision);
        const file = this.files.find(f => f.file === box.file);
        if (file && file.kind !== 'code') throw new Error(`${box.file} is counted as ${file.kind}; choose an implementation module for the structure view.`);
        return { ...box, revision, added: file?.added ?? 0, removed: file?.removed ?? 0, changed: !!file };
      }) }));
      for (const lane of lanes) for (const boundary of lane.boundaries ?? []) {
        if (!lane.boxes.some(b => b.id === boundary.after)) throw new Error(`Boundary ${boundary.label} must follow a box in its own lane.`);
      }
      const arrows = view.arrows.map(arrow => {
        id(arrow.id);
        if (!boxes.has(arrow.from) || !boxes.has(arrow.to) || arrow.from === arrow.to) throw new Error(`Arrow ${arrow.id} needs two distinct box ids present in this view.`);
        if (!arrow.label.trim()) throw new Error(`Arrow ${arrow.id} needs a label explaining who uses whom.`);
        return { ...arrow, proof: arrow.proof?.map(r => this.range(r)) ?? [] };
      });
      prepared = { ...view, lanes, arrows };
    } else if (view.view === 'evidence') {
      if (view.excerpts.length < 1 || view.excerpts.length > 3) throw new Error('Evidence needs 1–3 full-width excerpts; split this into another scene.');
      prepared = { ...view, excerpts: view.excerpts.map(excerpt => { id(excerpt.id); return { ...this.range(excerpt), id: excerpt.id, label: excerpt.label, lines: this.excerpt(excerpt) }; }) };
    } else if (view.view === 'patterns' || view.view === 'observations') {
      if (!view.panels.length) throw new Error('Supply at least one panel.');
      prepared = { ...view, panels: view.panels.map(panel => { id(panel.id); return { ...panel, where: where(panel.where) }; }) };
    } else throw new Error('Unknown change view; use structure, patterns, observations or evidence.');
    return { ...prepared, change: { base: this.base, head: this.head, files: this.files } };
  }
}

/** A loopback page for one take; close it in the demo script's finally block. */
export async function serveChangeView(options: ChangeOptions) {
  const change = new GitChange(options);
  const assets = new Map(['change-view.html', 'change-view.js', 'change-layout.js'].map(name => [name, readFileSync(new URL(name, import.meta.url))]));
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    // A page on another origin cannot make this local git reader serve it source.
    if (request.headers.host !== `127.0.0.1:${(server.address() as { port: number }).port}`) { response.writeHead(403).end(); return; }
    const origin = request.headers.origin;
    if (origin && origin !== `http://${request.headers.host}`) { response.writeHead(403).end(); return; }
    if (request.method === 'POST' && url.pathname === '/view') {
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 128 * 1024) throw new Error('View input too large; split it into smaller scenes.');
          chunks.push(chunk);
        }
        const prepared = change.prepare(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(prepared));
      } catch (error) { response.writeHead(400, { 'content-type': 'text/plain' }).end(error instanceof Error ? error.message : String(error)); }
      return;
    }
    const name = url.pathname === '/' ? 'change-view.html' : url.pathname.slice(1);
    const asset = assets.get(name);
    if (request.method !== 'GET' || !asset) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': name.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'" }).end(asset);
  });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No change-view address');
  return { url: `http://127.0.0.1:${address.port}`, change, close: () => new Promise<void>((done, reject) => { server.close(error => error ? reject(error) : done()); server.closeIdleConnections(); }) };
}
