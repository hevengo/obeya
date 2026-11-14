import { afterAll, beforeAll, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser, Page } from 'playwright-core';
import { launchChromium } from '../../../lib/chromium.ts';
import { CHANGE_VIEWPORT, GitChange, serveChangeView, type ChangeView } from './change-view.ts';
import { overlaps } from './change-layout.js';

let dir: string, base: string, head: string, change: GitChange;
let server: Awaited<ReturnType<typeof serveChangeView>>, browser: Browser, page: Page;
const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding:'utf8' }).trim();
const structure: ChangeView = {
  view:'structure', title:'A choice across three layers', note:'Arrows show selected uses. The policy boundary is inferred.',
  lanes:[
    {title:'UI', subtitle:'Owner-facing controls', boxes:[{id:'control',file:'ui/control.ts',title:'Choose speed'}, {id:'labels',file:'ui/labels.ts',title:'Name the choices'}, {id:'styles',file:'ui/styles.css',title:'Fit the control'}]},
    {title:'Server', subtitle:'Settings, policy and protocol', boxes:[{id:'settings',file:'server/settings.ts',title:'Validate and store'}, {id:'runtime',file:'server/runtime.ts',title:'Apply group policy'}, {id:'adapter',file:'server/adapter.ts',title:'Translate the tier'}], boundaries:[{after:'runtime',label:'Policy / protocol',inferred:true}]},
    {title:'Core', subtitle:'Shared vocabulary and transport', boxes:[{id:'types',file:'core/types.ts',title:'Shared vocabulary'},{id:'api',file:'core/api.ts',title:'Existing bridge'}]},
  ],
  arrows:[
    {id:'save',from:'control',to:'settings',label:'HTTP save',proof:[{file:'ui/control.ts',from:1,to:1}]},
    {id:'strings',from:'control',to:'labels',label:'uses labels'},
    {id:'read',from:'runtime',to:'settings',label:'reads group choice'},
    {id:'launch',from:'runtime',to:'adapter',label:'routes launch'},
    {id:'contract',from:'control',to:'types',label:'uses shared type'},
    {id:'settings-type',from:'settings',to:'types',label:'uses vocabulary'},
    {id:'bridge',from:'settings',to:'api',label:'existing bridge'},
  ],
};
const evidence: ChangeView={view:'evidence',title:'One wrapping rule',excerpts:[{id:'mapping',file:'server/adapter.ts',from:1,to:2},{id:'caller',file:'ui/control.ts',from:1,to:2}]};
const show = (view:ChangeView) => page.evaluate(v=>window.__change.show(v),view);

beforeAll(async()=>{
  dir=mkdtempSync(join(tmpdir(),'obeya-change-view-'));
  git('init'); git('config','user.name','Test'); git('config','user.email','test@example.invalid');
  for (const lane of structure.lanes) for (const box of lane.boxes) {
    mkdirSync(join(dir,box.file,'..'),{recursive:true});
    writeFileSync(join(dir,box.file),box.id==='adapter' ? '    const tier = speed === "fast" ? "priority" : speed === "ultrafast" ? "ultrafast" : "default";\n    launch(tier);\n' : '    existing();\n    next();\n');
  }
  for (const [file,text] of [['tabs.ts','\t  const template = "<tag>&";\n\t\twrapped(\tvalue);\n\t \n'],['operators.ts','--count;\n'],['deleted.ts','removed();\n'],['empty.ts',''],['literal[1].ts','literal();\n'],['source.test.ts','test();\n'],['notes.md','Notes\n'],['bun.lock','lock\n'],['binary.dat','a\0b']]) writeFileSync(join(dir,file!),text!);
  git('add','.');git('commit','-qm','Base');base=git('rev-parse','HEAD');
  writeFileSync(join(dir,'server/adapter.ts'),'    const tier = speed === "fast" ? "priority" : speed === "ultrafast" ? "ultrafast" : "default";\n    startAndResume(tier);\n');
  rmSync(join(dir,'deleted.ts'));
  writeFileSync(join(dir,'operators.ts'),'++count;\n');
  for (const file of ['source.test.ts','notes.md','bun.lock']) writeFileSync(join(dir,file),'changed\n');
  git('add','.');git('commit','-qm','Change');head=git('rev-parse','HEAD');
  change=new GitChange({repo:dir,base,head});
  server=await serveChangeView({repo:dir,base,head});
  browser=await launchChromium();
  page=await browser.newPage({viewport:CHANGE_VIEWPORT});
  await page.goto(server.url);
  await page.waitForFunction(()=>!!window.__change);
},60_000);
afterAll(async()=>{await browser?.close();await server?.close();if(dir)rmSync(dir,{recursive:true,force:true});});

test('git endpoints and excerpts are pinned, numbered and changed on the correct side',()=>{
  expect(change.head).toBe(head);
  expect(change.excerpt({file:'operators.ts',from:1,to:1})[0]?.kind).toBe('add');
  expect(change.excerpt({file:'operators.ts',from:1,to:1,revision:base})[0]?.kind).toBe('remove');
  expect(change.excerpt({file:'server/adapter.ts',from:1,to:2})).toEqual([
    {number:1,text:expect.stringContaining('const tier'),kind:'context'},
    {number:2,text:'    startAndResume(tier);',kind:'add'},
  ]);
  expect(change.excerpt({file:'server/adapter.ts',from:2,to:2,revision:base})[0]?.kind).toBe('remove');
  expect(change.source('deleted.ts',base)).toEqual(['removed();']);
  expect(change.source('literal[1].ts')).toEqual(['literal();']);
  expect(change.files.find(f=>f.file==='source.test.ts')?.kind).toBe('test');
  expect(change.files.find(f=>f.file==='notes.md')?.kind).toBe('documentation');
  expect(change.files.find(f=>f.file==='bun.lock')?.kind).toBe('generated');
});

test('missing revisions, paths, binary sources and invalid ranges fail with actionable locations',()=>{
  expect(()=>new GitChange({repo:dir,base:'missing-ref',head})).toThrow('Missing git revision');
  for (const file of ['deleted.ts','missing.ts','server']) expect(()=>change.source(file)).toThrow('Missing source');
  expect(()=>change.source('../outside')).toThrow('repository-relative');
  expect(()=>change.source('binary.dat')).toThrow('Binary source');
  for (const [from,to] of [[0,1],[2,1],[1,3],[1.5,2],[NaN,2]]) expect(()=>change.excerpt({file:'ui/control.ts',from:from!,to:to!})).toThrow('choose lines 1–2');
  expect(()=>change.excerpt({file:'empty.ts',from:1,to:1})).toThrow('1–0');
  expect(()=>change.prepare({...structure,arrows:[{id:'bad',from:'absent',to:'control',label:'uses'}]})).toThrow('two distinct box ids');
  expect(()=>change.prepare({...structure,arrows:[{id:'bad',from:'control',to:'settings',label:'uses',proof:[{file:'ui/control.ts',from:99,to:99}]}]})).toThrow('Invalid range');
});

test('three lanes and eight ordered boxes fit without covering labels or boundary text',async()=>{
  await show(structure);
  const layout=await page.evaluate(()=> (window.__change as any).layout) as {boxes:{x:number;y:number;w:number;h:number}[];text:{x:number;y:number;w:number;h:number}[];arrows:{label:{x:number;y:number;w:number;h:number};points:{x:number;y:number}[]}[]};
  expect(layout.boxes).toHaveLength(8);expect(layout.arrows).toHaveLength(7);
  for (const [i,edge] of layout.arrows.entries()) {
    for (const obstacle of [...layout.boxes,...layout.text,...layout.arrows.slice(0,i).map(a=>a.label)]) expect(overlaps(edge.label,obstacle,4)).toBe(false);
    for (const obstacle of [...layout.boxes,...layout.text,...layout.arrows.map(a=>a.label)]) for (const [j,b] of edge.points.slice(1).entries()) {
      const a=edge.points[j]!;
      // Arrow endpoints meet box borders. Only crossing an obstacle's interior is forbidden.
      const crossing=a.x===b.x ? a.x>obstacle.x&&a.x<obstacle.x+obstacle.w&&Math.max(a.y,b.y)>obstacle.y&&Math.min(a.y,b.y)<obstacle.y+obstacle.h : a.y>obstacle.y&&a.y<obstacle.y+obstacle.h&&Math.max(a.x,b.x)>obstacle.x&&Math.min(a.x,b.x)<obstacle.x+obstacle.w;
      expect(crossing).toBe(false);
    }
  }
  await page.evaluate(()=>window.__change.light({arrows:['save','strings','read','launch','contract','settings-type','bridge']}));
  const actualLabels=await page.locator('.arrow text').evaluateAll(elements=>elements.map(el=>{
    const b=(el as SVGGraphicsElement).getBBox();return {x:b.x,y:b.y,w:b.width,h:b.height};
  }));
  actualLabels.forEach((actual,i)=>{
    const reserved=layout.arrows[i]!.label;
    expect(actual.x).toBeGreaterThanOrEqual(reserved.x+3);
    expect(actual.x+actual.w).toBeLessThanOrEqual(reserved.x+reserved.w-3);
  });
  expect(await page.locator('.boundary-label').innerText()).toContain('inferred');
  expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBe(800);
  expect(await page.locator('.box-title').first().evaluate(el=>getComputedStyle(el).fontSize)).toBe('21px');
});

test('all four views, shared wrapping, escaped source and replacement lighting work in the browser',async()=>{
  await show(evidence);
  expect(await page.locator('[data-excerpt="mapping"] .line').count()).toBe(2);
  expect(await page.locator('[data-excerpt="mapping"] .line').first().evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(50);
  expect(await page.locator('.source-text').first().innerText()).toStartWith('const tier');
  expect(await page.locator('.source-text').first().evaluate(el=>getComputedStyle(el).fontSize)).toBe('21px');
  await page.evaluate(()=>window.__change.light({lines:[{excerpt:'mapping',from:1}]}));
  expect(await page.locator('.line.lit').count()).toBe(1);
  await page.evaluate(()=>window.__change.light({lines:[{excerpt:'caller',from:2}]}));
  expect(await page.locator('[data-excerpt="mapping"] .lit').count()).toBe(0);
  await expect(page.evaluate(()=>window.__change.light({lines:[{excerpt:'caller',from:3}]}))).rejects.toThrow('Invalid lighting range');
  const where=[{file:'ui/control.ts',from:1,to:2}];
  await show({view:'patterns',title:'An existing pattern',panels:[{id:'path',title:'One settings path',chosen:'Extend settings',alternative:'A separate route repeats validation',precedent:'Existing model choice',where}]});
  await page.evaluate(()=>window.__change.light({panels:['path']}));expect(await page.locator('.panel.lit').count()).toBe(1);
  await show({view:'observations',title:'What stands out',panels:[{id:'normal',title:'Two representations',fact:'Storage omits Normal',reason:'The adapter must reset the tier',tradeoff:'A mapping at the boundary',where}]});
  expect(await page.locator('.panel').innerText()).toContain('Trade-off');
  await show(structure);await page.evaluate(()=>window.__change.light({boxes:['control'],arrows:['save']}));
  expect(await page.locator('.box.lit,.arrow.lit').count()).toBe(2);
  await expect(page.evaluate(()=>window.__change.light({boxes:['typo']}))).rejects.toThrow('Unknown lighting target');
  await page.evaluate(()=>window.__change.light());expect(await page.locator('.lit').count()).toBe(0);
},15_000);

test('excess lanes, boxes, labels and evidence refuse instead of shrinking or clipping',async()=>{
  await expect(show({...structure,lanes:[...structure.lanes,structure.lanes[0]!]})).rejects.toThrow(); // duplicate ids fail before layout
  await expect(show({...structure,lanes:[...structure.lanes,{title:'Extra',boxes:[{id:'extra',file:'core/api.ts',title:'Extra'}]}]})).rejects.toThrow('1–3 lanes');
  await expect(show({...structure,lanes:structure.lanes.map((l,i)=>i ? l : {...l,boxes:[...l.boxes,{id:'extra',file:'core/api.ts',title:'Extra'}]})})).rejects.toThrow('1–3 ordered boxes');
  await expect(show({...structure,arrows:[{...structure.arrows[0]!,label:'A label that is much too long to fit beside other arrows and boxes'}]})).rejects.toThrow('shorten');
  await expect(show({view:'evidence',title:'Too much text',excerpts:Array.from({length:3},(_,i)=>({id:'e'+i,file:'server/adapter.ts',from:1,to:2,label:'Explanation '.repeat(30)}))})).rejects.toThrow('split');
  expect(await page.locator('.error').count()).toBe(1);
},15_000);

test('the loopback reader rejects foreign origins and never serves arbitrary paths',async()=>{
  const foreign=await fetch(server.url+'/view',{method:'POST',headers:{origin:'https://example.invalid'},body:JSON.stringify(evidence)});
  expect(foreign.status).toBe(403);
  expect((await fetch(server.url+'/source.ts')).status).toBe(404);
  expect((await fetch(server.url,{headers:{host:'attacker.invalid'}})).status).toBe(403);
});


test('plain Node dry-run plays legacy scenes and parts at the small frame with no pointer',async()=>{
  const script=join(dir,'dry-demo.ts');
  const lib=pathToFileURL(join(import.meta.dirname,'director.ts')).href;
  writeFileSync(script,`import {runDemo} from ${JSON.stringify(lib)};
    await runDemo({title:'Compatibility',baseUrl:${JSON.stringify(server.url)},viewport:{width:1000,height:800},pointer:false,
      open:async d=>{await d.goto('/');await d.page.waitForFunction(()=>!!window.__change);},
      scenes:[
        {title:'Legacy',say:'Existing narration.',run:async d=>{
          if(await d.evaluate(()=>innerWidth!==1000 || innerHeight!==800))throw new Error('Wrong viewport');
          await d.showChange(${JSON.stringify(evidence)});
          await d.evaluate(()=>window.__demo.moveTo(300,300,true));
          if(!await d.evaluate(()=>document.querySelector('svg[width="26"]').parentElement.hidden))throw new Error('Pointer visible');
        }},
        {title:'Parts',parts:[{say:'First part.',light:{lines:[{excerpt:'mapping',from:1}]}},
          {say:'Second part.',run:async d=>{if(await d.page.locator('.line.lit').count()!==1)throw new Error('First part did not light');},light:{lines:[{excerpt:'caller',from:2}]}}]},
      ],report:{summary:'Compatibility check',meta:{}}},${JSON.stringify(join(dir,'dry'))});`);
  const process=Bun.spawn(['node',script,'--dry'],{env:{...Bun.env,OBEYA_HOME:join(dir,'home')},stdout:'pipe',stderr:'pipe'});
  const [out,err,code]=await Promise.all([new Response(process.stdout).text(),new Response(process.stderr).text(),process.exited]);
  expect({code,output:out+err}).toEqual({code:0,output:expect.stringContaining('dry run: all 2 scenes ran through')});
},30_000);


test('a rejected view names the attempted scene and clears the preceding scene context',async()=>{
  await show(structure);
  await expect(show({view:'evidence',title:'Check requested source',excerpts:[{id:'missing',file:'missing.ts',from:1,to:1}]})).rejects.toThrow('Missing source');
  expect(await page.locator('h1').innerText()).toBe('Check requested source');
  expect(await page.locator('#inventory').innerText()).toBe('');
  expect(await page.locator('#note').innerText()).toBe('');
});


test('every excerpt expands tabs, strips common indent and preserves source text safely',async()=>{
  await show({view:'evidence',title:'Tabs and markup',excerpts:[{id:'tabs',file:'tabs.ts',from:1,to:3}]});
  expect(await page.locator('.source-text').allTextContents()).toEqual(['const template = "<tag>&";','wrapped(  value);','']);
  expect(await page.locator('.source-text tag').count()).toBe(0);
  expect(await page.locator('.number').allTextContents()).toEqual(['1','2','3']);
});


test('git color preferences cannot erase added and removed line evidence',()=>{
  git('config','color.ui','always');
  try {
    const colored=new GitChange({repo:dir,base,head});
    expect(colored.excerpt({file:'operators.ts',from:1,to:1})[0]?.kind).toBe('add');
    expect(colored.excerpt({file:'operators.ts',from:1,to:1,revision:base})[0]?.kind).toBe('remove');
  } finally {git('config','--unset','color.ui');}
});
