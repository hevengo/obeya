import { afterEach, beforeEach, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PLUGIN = join(import.meta.dir, '..', '..', '..');

let dir: string;
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'obeya-no-playwright-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Plain Node, as a demo runs, on a copy of the plugin where no Playwright is found up the tree. */
async function node(...args: string[]) {
  const p = Bun.spawn(['node', ...args], { cwd: dir, env: { ...process.env, OBEYA_HOME: join(dir, 'home') }, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out: out + err, code };
}

test('without Playwright, a render lists what is missing and re-voicing gets as far as its usage, instead of failing at import', async () => {
  cpSync(PLUGIN, join(dir, 'plugin'), { recursive: true, filter: (f) => !f.includes('__pycache__') });
  const lib = join(dir, 'plugin', 'skills', 'demo', 'lib');
  mkdirSync(join(dir, 'demo'));
  const demo = join(dir, 'demo', 'demo.ts');
  // relative: an absolute path on Windows (C:\…) is no module specifier for Node
  writeFileSync(demo, `import { runDemo } from '../plugin/skills/demo/lib/director.ts';\nawait runDemo({ title: 'T', baseUrl: 'http://127.0.0.1:9/', scenes: [{ title: 'A', say: 'One.' }] }, import.meta.dirname);\n`);
  const render = await node(demo);
  expect(render.out).not.toContain('ERR_MODULE_NOT_FOUND');
  expect(render.out).toContain('cannot render yet');
  expect(render.out).toMatch(/✗ playwright +not found/);
  expect(render.code).not.toBe(0);
  const revoice = await node(join(lib, 'revoice.ts'));
  expect(revoice.out).toContain('usage: node revoice.ts');
}, 30_000);


test('parts use caption sentence boundaries for heard speech and silent translations', async () => {
  const { partStarts, sceneSay } = await import('./director.ts');
  const { spokenTimes, readingTimes, sentencesOf } = await import('./subtitles.ts');
  const scene = { title: 'Parts', parts: [{ say: 'First sentence. Another follows.' }, { say: 'Last sentence.' }] };
  const sentences = sentencesOf(sceneSay(scene));
  const heard = spokenTimes(12, sentences, [['first',0],['sentence',1],['another',3],['follows',4],['last',9],['sentence',10]]).sentences;
  expect(partStarts(scene, heard)).toEqual([0, heard[0]!+heard[1]!]);
  const read = readingTimes([sentences, ['A slower translation of the first sentence.', 'Another long translation to read.', 'Last.']]);
  expect(partStarts(scene, read)).toEqual([0, read[0]!+read[1]!]);
  expect(partStarts({ title:'Legacy', say:'As before.' }, [3])).toEqual([]);
  expect(()=>partStarts({title:'Broken',parts:[{say:'An unfinished'},{say:'thought.'}]},[2])).toThrow('complete sentence');
  expect(()=>partStarts({title:'Empty',parts:[]},[])).toThrow('nonempty');
});

test('director executes parts at their spoken offsets, replaces lighting and preserves legacy scenes', async () => {
  const { playScene } = await import('./director.ts');
  const log: unknown[] = [];
  const d = {
    beginScene: () => 0,
    untilSpoken: async (fraction:number) => { log.push(fraction); },
    lightChange: async (light:unknown) => { log.push(light ?? {}); },
  } as unknown as import('./director.ts').Director;
  const run = async () => { log.push('prepare'); };
  await playScene(d, { title:'Parts', run, parts:[
    { say:'First. Two.', light:{boxes:['choice']} },
    { say:'Third.', run:async()=>{log.push('new view');}, light:{lines:[{excerpt:'source',from:5}]} },
    { say:'Fourth.' },
  ] }, [2,3,4,1]);
  expect(log).toEqual(['prepare',0,{boxes:['choice']},.5,'new view',{lines:[{excerpt:'source',from:5}]},.9,{}]);
  log.length=0;
  await playScene(d,{title:'Old demo',say:'Unchanged.',run});
  expect(log).toEqual(['prepare']);
});

test('slow parts-scene preparation finishes before the narration clock starts', async()=>{
  const { Director, playScene }=await import('./director.ts');
  const lights:number[]=[];
  class Probe extends Director {
    override async lightChange() { lights.push(Date.now()); }
  }
  const page={waitForTimeout:(ms:number)=>new Promise<void>(done=>setTimeout(done,ms))} as import('playwright-core').Page;
  const d=new Probe(page,'http://example.invalid',dir);
  const started=Date.now();
  d.beginScene(.4);
  await playScene(d,{title:'Slow preparation',run:async()=>{await d.wait(700);},parts:[{say:'First.'},{say:'Second.'}]},[.2,.2]);
  expect(lights[0]!-started).toBeGreaterThanOrEqual(1000);
  expect(lights[1]!-lights[0]!).toBeGreaterThanOrEqual(180);
});
