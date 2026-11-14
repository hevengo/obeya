import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generic } from '../adapters/generic';
import { artifact, commit } from './testing';
import { artifactFiles } from './demo-files';
import { git } from './git';
import { board, dir, eachTest, main, manual, rebuild, runtime, setup, state, workers } from './workers-fixture';

const guidance = 'Explain our domain boundaries and simple patterns.';
eachTest({ ...generic, land: 'main', workspaces: 'clones', demo: { code: guidance } });

function video(name: string, sentence = name) {
  const path = join(dir, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'demo.mp4'), name);
  writeFileSync(join(path, 'captions.vtt'), `WEBVTT - subtitles: en de\n\n00:00:00.000 --> 00:00:06.000\n${sentence}.\n`);
  writeFileSync(join(path, 'captions.en.vtt'), `WEBVTT\n\n00:00:00.000 --> 00:00:06.000\n${sentence}.\n`);
  writeFileSync(join(path, 'captions.de.vtt'), 'WEBVTT\n\n00:00:00.000 --> 00:00:06.000\nEin Satz.\n');
  return { dir: path, chapters: [name] };
}
async function coding(file = 'feature.ts') {
  const card = manual();
  await workers.start(card.id);
  commit(board.row(card.id).workspace!, file);
  return card;
}

describe('a task code video', () => {
  test('opt-in reaches the brief and tool schema; the first code handover waits for both videos', async () => {
    const c = await coding();
    expect(runtime.last.inbox[0]).toContain(guidance);
    expect(runtime.last.inbox[0]).toContain('complete branch change');
    expect(runtime.last.spec.tools!.find((t) => t.name === 'ready_for_review')!.schema).toHaveProperty('code_video');
    const before = board.events(c.id).filter((e) => e.kind === 'review').length;
    expect(await runtime.last.call('ready_for_review', { summary: 'Done', demo: video('behaviour') })).toContain('requires a code video');
    expect(state(c.id)).toBe('working');
    expect(board.events(c.id).filter((e) => e.kind === 'review')).toHaveLength(before);
    expect(await runtime.last.call('ready_for_review', { summary: 'Done', code_video: video('code') })).toContain('every handover brings a demo');
    expect(await runtime.last.call('ready_for_review', { summary: 'Done', demo: video('behaviour'), code_video: video('code') })).toContain('End your turn');
    expect(state(c.id)).toBe('waiting:demo');
    expect(board.item(c.id)).toMatchObject({ demo: { kind: 'video', chapters: [[0, 'behaviour']] }, codeVideo: { kind: 'video', chapters: [[0, 'code']], tracks: ['en', 'de'] } });
  });

  test('no setting, or an empty machine override, needs only the behaviour demo', async () => {
    for (const demo of [undefined, { code: '' }]) {
      await setup({ ...generic, land: 'main', workspaces: 'clones', demo });
      const c = await coding();
      expect(runtime.last.inbox[0]).not.toContain('Repository guidance for the tour');
      expect(await runtime.last.call('ready_for_review', { summary: 'Done', demo: video('behaviour') })).toContain('End your turn');
      expect(board.item(c.id)!.codeVideo).toBeUndefined();
    }
  });

  test('docs-only and unchanged tasks are exempt, including an HTML result', async () => {
    const c = await coding('README.md');
    expect(await runtime.last.call('ready_for_review', { summary: 'Docs', demo: artifact() })).toContain('End your turn');
    expect(board.item(c.id)!.codeVideo).toBeUndefined();
    await setup({ ...generic, land: 'main', workspaces: 'clones', demo: { code: guidance } });
    const empty = manual();
    await workers.start(empty.id);
    expect(await runtime.last.call('ready_for_review', { summary: 'Analysis', demo: artifact() })).toContain('End your turn');
  });

  test('a later docs commit does not hide code earlier in the card change', async () => {
    const c = await coding();
    commit(board.row(c.id).workspace!, 'README.md');
    expect(await runtime.last.call('ready_for_review', { summary: 'Docs now', demo: artifact() })).toContain('requires a code video');
  });

  test('deleting code or renaming it to documentation still requires a code video', async () => {
    for (const rename of [false, true]) {
      // Put code on the starting branch so deleting it is the complete card change.
      await setup({ ...generic, land: 'main', workspaces: 'worktrees', demo: { code: guidance } });
      commit(main, 'old.ts');
      const c = manual();
      await workers.start(c.id);
      const ws = board.row(c.id).workspace!;
      git(ws, ...(rename ? ['mv', 'old.ts', 'Architecture.md'] : ['rm', 'old.ts']));
      git(ws, 'commit', '-m', 'Remove implementation');
      expect(await runtime.last.call('ready_for_review', { summary: 'Removed', demo: artifact() })).toContain('requires a code video');
    }
  });

  test('a broken code video cannot create a handover', async () => {
    const c = await coding();
    const broken = video('broken');
    rmSync(join(broken.dir, 'demo.mp4'));
    expect(await runtime.last.call('ready_for_review', { summary: 'Done', demo: artifact(), code_video: broken })).toContain('Not handed over');
    expect(state(c.id)).toBe('working');
    expect(board.item(c.id)!.demo).toBeUndefined();
  });

  test('feedback can retain either video independently; both histories keep overwritten renders', async () => {
    const c = await coding();
    const behaviour = video('behaviour');
    const code = video('code', 'A boundary');
    await runtime.last.call('ready_for_review', { summary: 'First', demo: behaviour, code_video: code });
    const first = board.item(c.id)!;
    runtime.last.emit({ type: 'idle' });
    workers.message(c.id, 'Explain the boundary');
    expect(await runtime.last.call('ready_for_review', { summary: 'Explained' })).toContain('End your turn');
    expect(board.item(c.id)!.codeVideo!.handover).toBe(first.codeVideo!.handover);
    expect(board.item(c.id)!.codeVideos).toBeUndefined();
    writeFileSync(join(code.dir, 'demo.mp4'), 'new code');
    await runtime.last.call('ready_for_review', { summary: 'New code', code_video: code });
    let item = board.item(c.id)!;
    expect(item.demo!.handover).toBe(first.demo!.handover);
    expect(item.demos).toBeUndefined();
    expect(item.codeVideos).toHaveLength(1);
    const keptCode = board.demoFiles(c.id, 0, 'code')!.dir;
    expect(readFileSync(join(keptCode, 'demo.mp4'), 'utf8')).toBe('code');
    expect(readFileSync(join(keptCode, 'captions.de.vtt'), 'utf8')).toContain('Ein Satz');
    const latestCode = item.codeVideo!.handover;
    writeFileSync(join(behaviour.dir, 'demo.mp4'), 'new behaviour');
    await runtime.last.call('ready_for_review', { summary: 'New behaviour', demo: behaviour });
    item = board.item(c.id)!;
    expect(item.codeVideo!.handover).toBe(latestCode);
    expect(item.codeVideos).toHaveLength(1);
    expect(item.demos).toHaveLength(1);
    expect(readFileSync(join(board.demoFiles(c.id, 0)!.dir, 'demo.mp4'), 'utf8')).toBe('behaviour');
    expect(JSON.stringify([item.demo, item.demos, item.codeVideo, item.codeVideos])).not.toContain(dir);
    // Rebuilding the worker and projecting the card leaves both histories readable.
    rebuild();
    expect(board.item(c.id)!.codeVideos![0]!.handover).toBe(first.codeVideo!.handover);
  });

  test('old handovers still read, and the next code handover supplies its missing code video', async () => {
    const c = await coding();
    board.work(c.id, { state: 'waiting', need: 'demo', demo: JSON.stringify({ ...video('old'), kind: 'video', chapters: [[0, 'Old']] }) });
    expect(board.item(c.id)!.demo).toBeDefined();
    expect(board.item(c.id)!.codeVideo).toBeUndefined();
    runtime.last.emit({ type: 'idle' });
    workers.message(c.id, 'Please clarify');
    expect(await runtime.last.call('ready_for_review', { summary: 'Clarified' })).toContain('requires a code video');
    expect(await runtime.last.call('ready_for_review', { summary: 'Clarified', code_video: video('code') })).toContain('End your turn');
  });

  test('comments identify both histories, even when both videos share a handover', async () => {
    const c = await coding();
    await runtime.last.call('ready_for_review', { summary: 'First', demo: video('behaviour', 'The app'), code_video: video('code', 'A boundary') });
    const first = board.item(c.id)!.codeVideo!.handover!;
    workers.message(c.id, 'Check this boundary', [], false, undefined, { at: 2, video: 'code', demo: first });
    workers.message(c.id, 'Check the behaviour', [], false, undefined, { at: 2, video: 'demo', demo: first });
    const comments = board.events(c.id).filter((e) => e.spot);
    expect(comments.map((e) => e.spot)).toEqual([
      { at: 2, video: 'code', chapter: 'code', narration: 'A boundary.', demo: first },
      { at: 2, video: 'demo', chapter: 'behaviour', narration: 'The app.', demo: first },
    ]);
    workers.released(c.id, true);
    expect(runtime.last.inbox.at(-1)).toContain('[Code video at 0:02, chapter “code”, narration: “A boundary.”]');
    expect(runtime.last.inbox.at(-1)).toContain('[Demo video at 0:02, chapter “behaviour”, narration: “The app.”]');
    await runtime.last.call('ready_for_review', { summary: 'Retake', code_video: video('code-retake', 'Another boundary') });
    runtime.last.emit({ type: 'idle' });
    board.work(c.id, { state: 'working', need: null });
    workers.message(c.id, 'The old boundary', [], false, undefined, { at: 2, video: 'code', demo: first });
    expect(board.events(c.id).at(-1)!.spot).toMatchObject({ video: 'code', earlier: true, narration: 'A boundary.' });
    expect(runtime.last.inbox.at(-1)).toContain('Earlier code video');
  });

  test('a missing version is never relabelled as the latest video', async () => {
    const c = await coding();
    await runtime.last.call('ready_for_review', { summary: 'Done', demo: video('behaviour'), code_video: video('code', 'Current boundary') });
    workers.message(c.id, 'About a removed version', [], false, undefined, { at: 2, video: 'code', demo: 99999 });
    expect(board.events(c.id).at(-1)!.spot).toEqual({ at: 2, video: 'code', demo: 99999, earlier: true });
  });


  test('keeping a code video never puts it inside a behaviour artifact that can be shared', async () => {
    const c = await coding();
    const first = artifact();
    await runtime.last.call('ready_for_review', { summary: 'First artifact', demo: first, code_video: video('private-code') });
    await runtime.last.call('ready_for_review', { summary: 'New artifact', demo: artifact() });
    const oldArtifact = board.demoFiles(c.id, 0)!;
    expect(artifactFiles(oldArtifact.dir)).toEqual(['index.html']);
    const stored = JSON.parse(board.row(c.id).code_video!);
    expect(readFileSync(join(stored.kept, 'demo.mp4'), 'utf8')).toBe('private-code');
  });

});


describe('a prototype code video', () => {
  async function prototype() {
    const idea = board.create({ idea: true, title: 'Navigation', x: 0, y: 0 });
    const card = board.addPrototype(idea.id, 'Prototype: Compact navigation', 'Show the compact approach');
    await workers.start(card.id);
    return card;
  }

  test('requires a short tour while keeping the throwaway build brief, even without code changes', async () => {
    const c = await prototype();
    const brief = runtime.last.inbox[0]!;
    expect(brief).toContain(guidance);
    expect(brief).toContain('30–60 s code video');
    expect(brief).toContain('approach and structure');
    expect(brief).toContain('what would carry into a build on this branch');
    expect(brief).toContain('what is a shortcut');
    expect(brief).toContain('no tests, no polish, no docs or plan changes');
    expect(brief).not.toContain('Before ready_for_review, run');
    expect(brief).not.toContain('Docs-only changes need none');
    expect(await runtime.last.call('ready_for_review', { summary: 'Prototype', demo: artifact() })).toContain('requires a code video');
    expect(state(c.id)).toBe('working');
    expect(await runtime.last.call('ready_for_review', { summary: 'Prototype', demo: artifact(), code_video: video('short-tour') })).toContain('End your turn');
    const handover = board.item(c.id)!.codeVideo!.handover;
    runtime.last.emit({ type: 'idle' });
    workers.message(c.id, 'Explain the shortcut');
    expect(await runtime.last.call('ready_for_review', { summary: 'Explained the shortcut' })).toContain('End your turn');
    expect(board.item(c.id)!.codeVideo!.handover).toBe(handover);
    workers.message(c.id, 'About the approach', [], false, undefined, { at: 2, video: 'code', demo: handover });
    expect(board.events(c.id).at(-1)!.spot).toMatchObject({ video: 'code', narration: 'short-tour.' });
  });

  test('disabled prototypes keep the behaviour-only handover', async () => {
    for (const demo of [undefined, { code: '' }]) {
      await setup({ ...generic, land: 'main', workspaces: 'clones', demo });
      const c = await prototype();
      expect(runtime.last.inbox[0]).not.toContain('Repository guidance for the tour');
      expect(await runtime.last.call('ready_for_review', { summary: 'Prototype', demo: artifact() })).toContain('End your turn');
      expect(board.item(c.id)!.codeVideo).toBeUndefined();
    }
  });
});
