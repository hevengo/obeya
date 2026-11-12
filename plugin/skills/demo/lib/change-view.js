import { overlaps, refuse, placeArrowLabel, routeLabel } from './change-layout.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const content = document.querySelector('#content');
const main = document.querySelector('main');
const locations = ranges => ranges.map(r => `${r.file}:${r.from}${r.to === r.from ? '' : '–'+r.to} · ${r.revision.slice(0,8)}`).join(' · ');
const make = (className, html, parent = content) => {
  const el = document.createElement('div'); el.className = className; el.innerHTML = html; parent.append(el); return el;
};
const rect = el => { const r = el.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; };
const position = (el, r) => Object.assign(el.style,{left:r.x+'px',top:r.y+'px',width:r.w+'px',...(r.h !== undefined ? {height:r.h+'px'} : {})});
const fontWidth = (text, font) => { const ctx = document.createElement('canvas').getContext('2d'); ctx.font = font; return ctx.measureText(text).width; };
let current;

/** The same transformation applies to every excerpt, including tabs and blank-only ranges. */
export function excerptText(lines) {
  const expanded = lines.map(line => line.text.replace(/\t/g, (tab, at, text) => {
    const column = [...text.slice(0,at)].reduce((n,c) => n + (c === '\t' ? 2 - n%2 : 1),0);
    return ' '.repeat(2-column%2);
  }));
  const nonblank = expanded.filter(line=>line.trim());
  const indent = nonblank.length ? Math.min(...nonblank.map(line => /^ */.exec(line)[0].length)) : 0;
  return expanded.map(text=>text.trim() ? text.slice(indent) : '');
}

function structure(view) {
  if (!view.lanes.length || view.lanes.length > 3) refuse(`${view.lanes.length} lanes; use 1–3 lanes or split the structure into another scene.`);
  if (view.lanes.some(l=>!l.boxes.length || l.boxes.length > 3)) refuse('use 1–3 ordered boxes in each lane; split longer paths into another scene.');
  if (view.arrows.length > 10) refuse('more than 10 arrows; show selected uses or split the structure into another scene.');
  const diagram = make('diagram','');
  const width = content.clientWidth, laneGap = 28, laneWidth = (width-laneGap*(view.lanes.length-1))/view.lanes.length;
  const boxEls = [], laneEls = [], heads = [];
  view.lanes.forEach((lane,i) => {
    const x = i*(laneWidth+laneGap);
    const bg = make('lane','',diagram); position(bg,{x,y:0,w:laneWidth}); laneEls.push(bg);
    const header = make('lane-head',`<div class="lane-title">${esc(lane.title)}</div><div class="lane-subtitle">${esc(lane.subtitle)}</div>`,diagram);
    position(header,{x,y:0,w:laneWidth}); heads.push(header);
    lane.boxes.forEach((box,row) => {
      const el = make(`box${box.changed ? ' changed' : ''}`,`<div class="box-title">${esc(box.title)}</div><div class="path">${esc(box.file)}</div><div class="delta">${box.changed ? `+${box.added} −${box.removed}` : 'Existing module'}</div>`,diagram);
      el.dataset.box=box.id; position(el,{x:x+12,y:0,w:laneWidth-24});
      boxEls.push({el,box,row,lane:i});
    });
  });
  const headHeight = Math.max(...heads.map(h=>h.offsetHeight));
  if (headHeight > 84) refuse('a lane heading is too long; shorten its title or subtitle.');
  const rows = Math.max(...view.lanes.map(l=>l.boxes.length));
  const heights = Array.from({length:rows},(_,row)=>Math.max(...boxEls.filter(b=>b.row===row).map(b=>b.el.offsetHeight)));
  if (heights.some(h=>h>140)) refuse('a box is too tall; shorten its role title or use fewer lanes so the path can wrap.');
  const bands = [], boxes = [], text = heads.map(h=>({x:h.offsetLeft,y:0,w:h.offsetWidth,h:headHeight}));
  let y = headHeight+16;
  for (let row=0;row<rows;row++) {
    boxEls.filter(b=>b.row===row).forEach(b=>{
      const r = {x:b.el.offsetLeft,y,w:b.el.offsetWidth,h:heights[row],id:b.box.id};
      position(b.el,r); boxes.push(r);
    });
    y += heights[row]; bands.push({y:y+2,h:62}); y += 66;
  }
  // A boundary occupies its own label region, also an obstacle for every arrow.
  view.lanes.forEach((lane,i) => (lane.boundaries ?? []).forEach(boundary=>{
    const row = lane.boxes.findIndex(b=>b.id === boundary.after), band = bands[row];
    const x = i*(laneWidth+laneGap)+8;
    const line = make('boundary','',diagram); position(line,{x,y:band.y+12,w:laneWidth-16});
    const label = make('boundary-label',esc(boundary.label+(boundary.inferred ? ' · inferred' : '')),diagram);
    position(label,{x:x+5,y:band.y+3,w:laneWidth-26});
    label.style.width='max-content'; label.style.maxWidth=(laneWidth-26)+'px';
    if (label.offsetHeight > 36) refuse(`boundary "${boundary.label}" is too long; shorten its label.`);
    const r={x:label.offsetLeft,y:label.offsetTop,w:label.offsetWidth,h:label.offsetHeight};
    if (text.some(t=>overlaps(t,r,4))) refuse(`boundary "${boundary.label}" overlaps another label; use one boundary at this position.`);
    text.push(r);
  }));
  // Last band's routes still need room, but the diagram never scales text down to fit.
  const height = y;
  diagram.style.height=height+'px';
  const available = innerHeight-24-diagram.getBoundingClientRect().top-document.querySelector('#inventory').offsetHeight-document.querySelector('#note').offsetHeight-12;
  if (height > available) refuse(`structure needs ${Math.ceil(height-available)} more pixels of height; shorten box titles or the note, remove boxes or split the scene.`);
  const routed = [];
  for (const arrow of view.arrows) {
    const from = boxes.find(b=>b.id===arrow.from), to=boxes.find(b=>b.id===arrow.to);
    const edge = placeArrowLabel(from,to,arrow,boxes,text,bands,routed,fontWidth(arrow.label,'700 14px system-ui')+12,width);
    routed.push({...edge,arrow});
  }
  for (const edge of routed) {
    const points = routeLabel(boxes.find(b=>b.id===edge.arrow.from), boxes.find(b=>b.id===edge.arrow.to), edge.label, boxes, text, routed.map(e=>e.label), width, height);
    if (!points) refuse(`arrow "${edge.arrow.id}" has no clear route; remove an arrow or split the scene.`);
    edge.points = points;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.classList.add('routes'); svg.setAttribute('aria-label','Selected module dependencies');
  svg.innerHTML = `<defs>${['gray','blue'].map((id,i)=>`<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="${i ? '#2563eb' : '#8d9ba9'}"/></marker>`).join('')}</defs>` + routed.map(({arrow,points,label})=>{
    const cross = boxEls.find(b=>b.box.id===arrow.from).lane !== boxEls.find(b=>b.box.id===arrow.to).lane;
    return `<g class="arrow${cross?' cross':''}" data-arrow="${arrow.id}"><title>${esc(arrow.label)}${arrow.proof.length ? ' · '+esc(locations(arrow.proof)) : ''}</title><path d="${points.map((p,i)=>(i?'L':'M')+p.x+' '+p.y).join(' ')}" marker-end="url(#gray)"/><text x="${label.x+label.w/2}" y="${label.y+15}" text-anchor="middle">${esc(arrow.label)}</text></g>`;
  }).join('');
  diagram.append(svg);
  // Expose measured rectangles for deterministic clearance tests, not author placement.
  window.__change.layout = {boxes,text,arrows:routed.map(({label,points})=>({label,points})),width,height};
}

function render(view) {
  document.querySelector('#title').textContent=view.title;
  document.title=view.title;
  document.querySelector('#subtitle').textContent=view.subtitle ?? `${view.change.base.slice(0,8)} → ${view.change.head.slice(0,8)}`;
  content.replaceChildren();
  document.querySelector('#note').innerHTML=view.note ? `<div class="note">${esc(view.note)}</div>` : '';
  const counts = ['test','documentation','generated'].map(kind=>({kind,count:view.change.files.filter(f=>f.kind===kind).length}));
  document.querySelector('#inventory').textContent=view.view==='structure' ? counts.map(({kind,count})=>`${kind === 'test' ? 'Tests' : kind === 'documentation' ? 'Documentation' : 'Generated'}: ${count}`).join(' · ')+' · counted, not toured' : '';
  if (view.view==='structure') structure(view);
  else if (view.view==='evidence') {
    const stack=make('code-stack','');
    for (const excerpt of view.excerpts) {
      const texts=excerptText(excerpt.lines);
      const el=make('code',`<div class="code-head"><span>${esc(excerpt.file)}</span><span>${excerpt.from}–${excerpt.to} · ${excerpt.revision.slice(0,8)}</span></div><div class="code-body">${excerpt.lines.map((line,i)=>`<div class="line ${line.kind}" data-line="${line.number}"><span class="number">${line.number}</span><span class="sign">${line.kind==='add'?'+':line.kind==='remove'?'−':''}</span><span class="source-text">${esc(texts[i])}</span></div>`).join('')}</div>${excerpt.label ? `<div class="code-label">${esc(excerpt.label)}</div>` : ''}`,stack);
      el.dataset.excerpt=excerpt.id;
    }
  } else {
    const panels=make('panels','');
    for (const p of view.panels) {
      const rows=view.view==='patterns' ? [['Chosen',p.chosen],['Not taken',p.alternative],['Already used',p.precedent]] : [['Fact',p.fact],['Reason',p.reason],['Trade-off',p.tradeoff]];
      const el=make('panel',`<h2>${esc(p.title)}</h2>${rows.map(([key,value])=>`<p><b>${key}</b> ${esc(value)}</p>`).join('')}<div class="locations">${esc(locations(p.where))}</div>`,panels);
      el.dataset.panel=p.id;
    }
  }
  if (main.getBoundingClientRect().bottom > innerHeight || document.documentElement.scrollWidth > innerWidth) refuse(`${view.view} overflows the frame; shorten its text, reduce the excerpt range or split it into another scene.`);
  for (const el of content.querySelectorAll('*')) if (el.scrollWidth > el.clientWidth+1 && !el.closest('svg')) refuse(`${view.view} contains text too wide for the frame; shorten the label or split the scene.`);
}

function light(spec = {}) {
  // Validate everything before changing any classes: typos must fail the take, never silently miss.
  const targets=[];
  for (const [key,attr] of [['boxes','box'],['arrows','arrow'],['panels','panel']]) for (const id of spec[key] ?? []) {
    const el=[...content.querySelectorAll(`[data-${attr}]`)].find(e=>e.dataset[attr]===id);
    if (!el) throw new Error(`Unknown lighting target ${key}:${id}; name an id in the current view.`);
    targets.push(el);
  }
  for (const range of spec.lines ?? []) {
    const excerpt=current?.view==='evidence' && current.excerpts.find(e=>e.id===range.excerpt);
    const to=range.to ?? range.from;
    if (!excerpt || !Number.isInteger(range.from) || !Number.isInteger(to) || range.from<excerpt.from || to>excerpt.to || to<range.from) throw new Error(`Invalid lighting range ${range.excerpt}:${range.from}–${to}; use lines in the visible excerpt.`);
    const panel=[...content.querySelectorAll('[data-excerpt]')].find(e=>e.dataset.excerpt===range.excerpt);
    targets.push(...[...panel.querySelectorAll('[data-line]')].filter(e=>Number(e.dataset.line)>=range.from && Number(e.dataset.line)<=to));
  }
  content.querySelectorAll('.lit').forEach(e=>e.classList.remove('lit'));
  targets.forEach(e=>e.classList.add('lit'));
  content.querySelector('.panels')?.classList.toggle('focused',!!spec.panels?.length);
}

window.__change = {
  layout:null,
  async show(spec) {
    document.querySelector('#title').textContent=spec.title;
    document.title=spec.title;
    try {
      const response=await fetch('/view',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(spec)});
      if (!response.ok) throw new Error(await response.text());
      const prepared=await response.json();
      await document.fonts.ready;
      render(prepared); current=prepared; light();
    } catch(error) {
      current=undefined;
      document.querySelector('#subtitle').textContent='Correct the view and run the take again.';
      document.querySelector('#inventory').textContent='';
      document.querySelector('#note').replaceChildren();
      content.innerHTML=`<div class="error">${esc(error.message)}</div>`; throw error;
    }
  },
  light,
};
