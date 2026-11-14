// Measured layout, shared by the page and its tests. No source-specific positions or font scaling.
// @ts-check
/** @typedef {{x:number,y:number,w:number,h:number}} Rect */
/** @typedef {{x:number,y:number}} Point */
/** @template T @param {T[]} values @param {number} index @returns {T} */
function at(values, index) {
  const value = values[index];
  if (value === undefined) throw new Error('Invalid routing grid index');
  return value;
}
/** @param {Rect} a @param {Rect} b @param {number} [gap] */
export function overlaps(a, b, gap = 0) {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}
/** @param {Point} a @param {Point} b @param {Rect} r */
function crosses(a, b, r) {
  return a.x === b.x
    ? a.x > r.x && a.x < r.x + r.w && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.h
    : a.y > r.y && a.y < r.y + r.h && Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.w;
}
/** @param {Rect} r @param {number} n */
const grow = (r, n) => ({ x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n });
/** @param {string} reason */
export function refuse(reason) { throw new Error(`Change view does not fit: ${reason}`); }

/** Orthogonal shortest path around measured boxes and text; the Cartesian grid follows obstacle edges.
 * @param {Point} start @param {Point} end @param {Rect[]} obstacles @param {number} width @param {number} height
 * @returns {Point[] | null}
 */
function route(start, end, obstacles, width, height) {
  if ([start,end].some(p=>p.x<4 || p.x>width-4 || p.y<4 || p.y>height-4)) return null;
  const xs = [...new Set([start.x, end.x, 6, width - 6, ...obstacles.flatMap(r => [r.x - 2, r.x + r.w + 2])])].filter(x => x >= 4 && x <= width - 4).sort((a,b) => a-b);
  const ys = [...new Set([start.y, end.y, 6, height - 6, ...obstacles.flatMap(r => [r.y - 2, r.y + r.h + 2])])].filter(y => y >= 4 && y <= height - 4).sort((a,b) => a-b);
  const nx = xs.length;
  const begin = ys.indexOf(start.y) * nx + xs.indexOf(start.x), finish = ys.indexOf(end.y) * nx + xs.indexOf(end.x);
  const point = (/** @type {number} */ i) => ({ x: at(xs, i % nx), y: at(ys, Math.floor(i / nx)) });
  const costs = new Map([[begin, 0]]), previous = new Map();
  /** @type {{id:number,cost:number}[]} */
  const heap = [];
  /** @param {number} id @param {number} cost */
  function push(id, cost) {
    heap.push({id,cost}); let i = heap.length - 1;
    while (i > 0) { const p = (i-1) >> 1; if (at(heap,p).cost <= cost) break; heap[i] = at(heap,p); i = p; }
    heap[i] = {id,cost};
  }
  function pop() {
    const first = at(heap,0), last = heap.pop();
    if (heap.length && last) {
      let i = 0;
      while (i*2+1 < heap.length) {
        let c = i*2+1; if (c+1 < heap.length && at(heap,c+1).cost < at(heap,c).cost) c++;
        if (at(heap,c).cost >= last.cost) break;
        heap[i] = at(heap,c); i = c;
      }
      heap[i] = last;
    }
    return first;
  }
  const distance = (/** @type {Point} */ a, /** @type {Point} */ b) => Math.abs(a.x-b.x) + Math.abs(a.y-b.y);
  push(begin, distance(start,end));
  const visited = new Set();
  while (heap.length) {
    const current = pop().id;
    if (visited.has(current)) continue;
    if (current === finish) {
      const path = [point(current)]; let i = current;
      while (previous.has(i)) { i = previous.get(i); path.unshift(point(i)); }
      return path.filter((p, i) => !i || i === path.length-1 || !((at(path,i-1).x === p.x && p.x === at(path,i+1).x) || (at(path,i-1).y === p.y && p.y === at(path,i+1).y)));
    }
    visited.add(current);
    const a = point(current), col = current % nx;
    for (const next of [col > 0 ? current-1 : -1, col < nx-1 ? current+1 : -1, current-nx, current+nx]) {
      if (next < 0 || next >= xs.length * ys.length || visited.has(next)) continue;
      const b = point(next);
      if (obstacles.some(r => crosses(a,b,r))) continue;
      const cost = (costs.get(current) ?? Infinity) + distance(a,b);
      if (cost >= (costs.get(next) ?? Infinity)) continue;
      costs.set(next,cost); previous.set(next,current); push(next,cost+distance(b,end));
    }
  }
  return null;
}

/** Routes a labelled arrow through a free text slot. Labels never cover earlier routes; routes avoid all text.
 * @param {Rect & {id:string}} from @param {Rect & {id:string}} to
 * @param {{id:string,label:string}} arrow @param {Rect[]} boxes @param {Rect[]} text
 * @param {{y:number,h:number}[]} bands @param {{label:Rect,points:Point[]}[]} prior
 * @param {number} labelWidth @param {number} width
 */
export function placeArrowLabel(from, to, arrow, boxes, text, bands, prior, labelWidth, width) {
  if (labelWidth > 260) refuse(`arrow "${arrow.id}" label is too long; shorten "${arrow.label}" to fit one short phrase.`);
  const cx = (from.x + from.w/2 + to.x + to.w/2)/2, cy = (from.y + from.h/2 + to.y + to.h/2)/2;
  /** @type {Rect[]} */
  const candidates = [];
  for (const band of bands) for (const y of [band.y + 6, band.y + band.h - 32]) {
    for (const center of [cx, from.x+from.w/2, to.x+to.w/2, width/2, width/6, width*5/6]) {
      candidates.push({x: Math.max(14, Math.min(width-labelWidth-14, center-labelWidth/2)), y, w:labelWidth, h:20});
    }
  }
  candidates.sort((a,b) => Math.abs(a.x+a.w/2-cx)+Math.abs(a.y-cy) - Math.abs(b.x+b.w/2-cx)-Math.abs(b.y-cy));
  for (const label of candidates) {
    if ([...boxes, ...text, ...prior.map(e=>e.label)].some(r => overlaps(label,r,8))) continue;
    return {label,points:[]};
  }
  refuse(`arrow "${arrow.id}" has no clear route for its label; shorten the label, remove an arrow or split the structure into another scene.`);
}

/** Routes after every label has its reserved place, so an early edge cannot block later text.
 * @param {Rect} from @param {Rect} to @param {Rect} label
 * @param {Rect[]} boxes @param {Rect[]} text @param {Rect[]} labels
 * @param {number} width @param {number} height @returns {Point[] | null}
 */
export function routeLabel(from,to,label,boxes,text,labels,width,height) {
  const left = {x:label.x, y:label.y+label.h+5}, right = {x:label.x+label.w,y:left.y};
  const forward = from.x+from.w/2 <= to.x+to.w/2;
  const enter = forward ? left : right, leave = forward ? right : left;
  const obstacles = [...boxes.map(r=>grow(r,6)), ...text.map(r=>grow(r,6)), ...labels.map(r=>grow(r,3))];
  /** @param {Rect} box @param {Point} toward @returns {Point[] | null} */
  function connect(box,toward) {
    const cx=box.x+box.w/2, cy=box.y+box.h/2;
    const ports = [
      [{x:box.x,y:cy},{x:box.x-10,y:cy}],
      [{x:box.x+box.w,y:cy},{x:box.x+box.w+10,y:cy}],
      [{x:cx,y:box.y},{x:cx,y:box.y-10}],
      [{x:cx,y:box.y+box.h},{x:cx,y:box.y+box.h+10}],
    ];
    /** @type {Point[] | null} */
    let best=null;
    let cost=Infinity;
    for (const pair of ports) {
      const port=at(pair,0), outside=at(pair,1);
      if ([...text,...labels].some(r=>crosses(port,outside,grow(r,3)))) continue;
      const path=route(outside,toward,obstacles,width,height);
      if (!path) continue;
      const length=path.slice(1).reduce((sum,p,i)=>sum+Math.abs(p.x-at(path,i).x)+Math.abs(p.y-at(path,i).y),0);
      if(length<cost) {cost=length;best=[port,...path];}
    }
    return best;
  }
  const first=connect(from,enter), second=connect(to,leave);
  return first && second ? [...first,...second.reverse()] : null;
}
