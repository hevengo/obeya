// Runnable without an app or Obeya. See ../code-video.md and docs/demo-setup.md.
// For a real tour, replace the temporary fixture with explicit repo/base/head and author the
// views from that repository. A copy outside the skill uses absolute paths for these imports.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { CHANGE_VIEWPORT, serveChangeView, type ChangeView } from '../lib/change-view.ts';
import { runDemo } from '../lib/director.ts';
import { demoDirectory } from '../lib/settings.ts';

const outFlag = process.argv.indexOf('--out');
if (outFlag >= 0 && (!process.argv[outFlag + 1] || process.argv[outFlag + 1]!.startsWith('--'))) {
  throw new Error('Supply a demo directory after --out.');
}
const out = resolve(outFlag >= 0 ? process.argv[outFlag + 1]! : join(demoDirectory(), 'code-video-example'));
const repo = mkdtempSync(join(tmpdir(), 'code-video-example-'));
const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim();
const write = (file: string, text: string) => {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), text);
};

let server: Awaited<ReturnType<typeof serveChangeView>> | undefined;
try {
  // Isolated identity and hooks: the example never commits in the caller's checkout.
  git('init', '-q');
  git('config', 'user.name', 'Demo example');
  git('config', 'user.email', 'demo@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', join(repo, 'no-hooks'));
  write('docs/design.md', `# Order actions

The interface sends commands. The application loads and saves orders through a store.
The domain owns valid order transitions and knows nothing about HTTP or storage.
Keep each transition explicit and guarded, as sending already is. Prefer simple functions
until more cases justify an abstraction; two similar application handlers are acceptable.
The application layer contains both orchestration and storage contracts. No internal
boundary is prescribed between those roles.
`);
  write('domain/order.ts', `export type Order = { status: 'draft' | 'sent' | 'cancelled' };

export function send(order: Order): Order {
  if (order.status !== 'draft') throw new Error('Only drafts can be sent');
  return { ...order, status: 'sent' };
}
`);
  write('app/store.ts', `import type { Order } from '../domain/order.ts';
export interface Store {
  load(id: string): Promise<Order>;
  save(id: string, order: Order): Promise<void>;
}
`);
  write('app/orders.ts', `import { send } from '../domain/order.ts';
import type { Store } from './store.ts';

export async function sendOrder(id: string, store: Store) {
  const order = await store.load(id);
  await store.save(id, send(order));
}
`);
  write('ui/actions.ts', `export const sendOrder = (id: string) =>
  fetch('/orders/' + encodeURIComponent(id) + '/send', { method: 'POST' });
`);
  git('add', '.');
  git('commit', '-qm', 'Add explicit sending transition');
  const base = git('rev-parse', 'HEAD');

  write('domain/order.ts', `export type Order = { status: 'draft' | 'sent' | 'cancelled' };

export function send(order: Order): Order {
  if (order.status !== 'draft') throw new Error('Only drafts can be sent');
  return { ...order, status: 'sent' };
}

export function cancel(order: Order): Order {
  if (order.status !== 'draft') throw new Error('Only drafts can be cancelled');
  return { ...order, status: 'cancelled' };
}
`);
  write('app/orders.ts', `import { send, cancel } from '../domain/order.ts';
import type { Store } from './store.ts';

export async function sendOrder(id: string, store: Store) {
  const order = await store.load(id);
  await store.save(id, send(order));
}

export async function cancelOrder(id: string, store: Store) {
  const order = await store.load(id);
  await store.save(id, cancel(order));
}
`);
  write('ui/actions.ts', `export const sendOrder = (id: string) =>
  fetch('/orders/' + encodeURIComponent(id) + '/send', { method: 'POST' });
export const cancelOrder = (id: string) =>
  fetch('/orders/' + encodeURIComponent(id) + '/cancel', { method: 'POST' });
`);
  git('add', '.');
  git('commit', '-qm', 'Allow cancellation of draft orders');
  const head = git('rev-parse', 'HEAD');
  server = await serveChangeView({ repo, base, head });

  // The fixture's design prose names these three layers. Only the internal boundary is inferred.
  const structure: ChangeView = {
    view: 'structure', title: 'Cancellation follows the existing layers',
    note: 'Selected uses; the route handler is outside this fixture. Internal boundary inferred.',
    lanes: [
      { title: 'Interface', boxes: [{ id: 'ui', file: 'ui/actions.ts', title: 'Request cancellation' }] },
      { title: 'Application', boxes: [
        { id: 'service', file: 'app/orders.ts', title: 'Load, change, save' },
        { id: 'store', file: 'app/store.ts', title: 'Storage contract' },
      ], boundaries: [{ after: 'service', label: 'Orchestration / storage', inferred: true }] },
      { title: 'Domain', boxes: [{ id: 'rule', file: 'domain/order.ts', title: 'Guard the transition' }] },
    ],
    arrows: [
      { id: 'persist', from: 'service', to: 'store', label: 'loads and saves', proof: [{ file: 'app/orders.ts', from: 9, to: 11 }] },
      { id: 'validate', from: 'service', to: 'rule', label: 'calls cancel', proof: [{ file: 'app/orders.ts', from: 1, to: 1 }, { file: 'app/orders.ts', from: 11, to: 11 }] },
    ],
  };
  const patterns: ChangeView = {
    view: 'patterns', title: 'An explicit guarded transition',
    panels: [{ id: 'guard', title: 'Follow the existing send pattern',
      chosen: 'A small cancel function checks the state, then returns the changed order.',
      alternative: 'A workflow engine would add machinery for two simple transitions.',
      precedent: 'The send function already guards a draft before changing its state.',
      where: [{ file: 'domain/order.ts', from: 3, to: 11 }],
    }],
  };
  const observations: ChangeView = {
    view: 'observations', title: 'Two handlers keep the same sequence',
    panels: [{ id: 'duplication', title: 'A little repetition remains',
      fact: 'Send and cancel each load, apply a domain transition, then save.',
      reason: 'The design guide permits two similar handlers before an abstraction.',
      tradeoff: 'A shared persistence change would need to reach both handlers.',
      where: [{ file: 'app/orders.ts', from: 4, to: 12 }],
    }],
  };
  const evidence: ChangeView = {
    view: 'evidence', title: 'The new rule matches the existing pattern',
    excerpts: [{ id: 'transitions', file: 'domain/order.ts', from: 3, to: 11, revision: head, label: 'Existing send above; new cancel below' }],
  };

  await runDemo({
    title: 'Code tour: cancelling a draft order', baseUrl: server.url,
    viewport: CHANGE_VIEWPORT, pointer: false,
    open: async d => { await d.goto('/'); await d.page.waitForFunction(() => !!window.__change); },
    scenes: [
      { title: 'Where the change sits', run: d => d.showChange(structure), parts: [
        { say: 'This example adds cancellation to an order system. Its design guide names three layers: interface, application and domain.', light: { boxes: ['ui', 'service', 'rule'] } },
        { say: 'The interface sends a cancellation request. The route handler is outside this small fixture, so that connection is not drawn.', light: { boxes: ['ui'] } },
        { say: 'The application loads an order, asks the domain to cancel it, and saves the result.', light: { boxes: ['service', 'store', 'rule'], arrows: ['persist', 'validate'] } },
      ] },
      { title: 'What each side knows', run: d => d.showChange(structure), parts: [
        { say: 'The domain knows order states, but has no dependency on storage or HTTP.', light: { boxes: ['rule'] } },
        { say: 'The orchestration and storage boundary inside the application is inferred from their roles. The guide does not prescribe that internal boundary.', light: { boxes: ['service', 'store'], arrows: ['persist'] } },
      ] },
      { title: 'The chosen pattern', run: d => d.showChange(patterns), parts: [
        { say: 'Cancellation follows the existing guarded transition used by sending. A workflow engine would add machinery for two simple state changes.', light: { panels: ['guard'] } },
        { say: 'The guide favors explicit functions here. Simplicity is the relevant lens, rather than a checklist of design principles.', light: { panels: ['guard'] } },
      ] },
      { title: 'Evidence for the pattern', run: d => d.showChange(evidence), parts: [
        { say: 'The existing send function checks for a draft and returns the new state.', light: { lines: [{ excerpt: 'transitions', from: 3, to: 6 }] } },
        { say: 'The added cancel function has the same shape. These lines support the design claim; this tour does not demonstrate the running application.', light: { lines: [{ excerpt: 'transitions', from: 8, to: 11 }] } },
      ] },
      { title: 'What stands out', run: d => d.showChange(observations), parts: [
        { say: 'Both application handlers repeat the load, change and save sequence.', light: { panels: ['duplication'] } },
        { say: 'The guide permits that repetition before an abstraction. The trade-off is that a shared persistence change must reach both handlers.', light: { panels: ['duplication'] } },
      ] },
      { title: 'Recap', run: d => d.showChange(structure), parts: [
        { say: 'Cancellation fits the existing layers with an explicit domain rule, accepting a little repetition in the application.', light: { boxes: ['service', 'rule'], arrows: ['validate'] } },
      ] },
    ],
    report: {
      summary: 'A design-level tour of a generated two-commit example: cancellation follows the existing layers and guarded transition pattern. The application keeps two similar handlers, as its guide permits.\n\nNo app or Obeya server runs. The interface route handler is outside the fixture; the video makes no runtime claim. The internal orchestration/storage boundary is an inference. The temporary repository is removed after the take; its full source is in the example script.',
      meta: { base, head, lens: 'Fixture docs/design.md', source: 'Generated example repository; not the caller’s checkout' },
    },
  }, out);
} finally {
  await server?.close();
  rmSync(repo, { recursive: true, force: true });
}
