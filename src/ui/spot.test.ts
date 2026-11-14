import { afterEach, beforeEach, expect, test } from 'bun:test';
import { playAt, visibleVideo } from './spot';

class Video extends EventTarget {
  readyState = 0;
  currentTime = 0;
  paused = true;
  hidden = false;
  isConnected = true;
  plays = 0;
  scrolls = 0;
  closest() { return this.hidden ? {} : null; }
  scrollIntoView() { this.scrolls++; }
  play() { this.paused = false; this.plays++; return Promise.resolve(); }
  get element() { return this as unknown as HTMLVideoElement; }
}
const saved = { raf: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame, document: globalThis.document };
let frames: Map<number, FrameRequestCallback>;
let next: number;
beforeEach(() => {
  frames = new Map(); next = 0;
  globalThis.requestAnimationFrame = (fn) => { frames.set(++next, fn); return next; };
  globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
});
afterEach(() => {
  globalThis.requestAnimationFrame = saved.raf;
  globalThis.cancelAnimationFrame = saved.cancel;
  globalThis.document = saved.document;
});
const paint = () => { for (const [id, fn] of [...frames]) { frames.delete(id); fn(0); } };

test('a timed comment on the current video reveals it before playing', () => {
  const v = new Video(); v.readyState = 1;
  playAt(v.element, 25);
  paint();
  expect([v.currentTime, v.scrolls, v.plays]).toEqual([25, 1, 1]);
});

test('changing rows cancels a historical seek that still waits for metadata', () => {
  const v = new Video();
  const cancel = playAt(v.element, 25);
  v.hidden = true;
  cancel();
  v.dispatchEvent(new Event('loadedmetadata'));
  paint();
  expect(v.plays).toBe(0);
  // Returning to the row later must not revive the abandoned seek.
  v.hidden = false;
  v.dispatchEvent(new Event('loadedmetadata'));
  paint();
  expect(v.plays).toBe(0);
});

test('a row hidden between metadata and paint cannot start playing', () => {
  const v = new Video();
  playAt(v.element, 25);
  v.dispatchEvent(new Event('loadedmetadata'));
  v.hidden = true;
  paint();
  expect(v.plays).toBe(0);
});

test('a timed comment can activate its row before the next paint', () => {
  const v = new Video(); v.readyState = 1; v.hidden = true;
  playAt(v.element, 25);
  v.hidden = false;
  paint();
  expect([v.currentTime, v.plays]).toEqual([25, 1]);
});

test('archived-card controls fall back to the visible video, not the hidden first one', () => {
  const behaviour = new Video(); behaviour.hidden = true;
  const code = new Video();
  globalThis.document = { querySelectorAll: () => [behaviour.element, code.element] } as unknown as Document;
  expect(visibleVideo()).toBe(code.element);
  code.hidden = true;
  expect(visibleVideo()).toBeNull();
});
