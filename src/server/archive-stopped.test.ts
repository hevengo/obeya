import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canvas, eachTest, main, workers } from './canvas-fixture';
import { serve } from './server';
import { asOwner, commit, until } from './testing';
import { git } from './workspaces';

for (const mode of ['worktrees', 'clones'] as const) describe(`archiving a stopped card in ${mode}`, () => {
  eachTest({ repo: { clones: mode === 'clones' ? 1 : 0, settings: { workspaces: mode, land: 'main' } } });
  let server: ReturnType<typeof serve>;
  beforeEach(() => { server = serve([canvas], { transcriber: { transcribe: async () => ({ text: '', doubtful: false }) } }, 0); });
  afterEach(() => server.stop(true));
  const { fetch } = asOwner(() => server);
  const archive = (id: string) => fetch(new URL(`/api/c/${canvas.id}/cards/${id}/archive`, server.url), { method: 'POST' });

  async function stoppedCard() {
    const card = canvas.board.create({ title: 'Export reports', x: 0, y: 0 });
    await workers().start(card.id);
    const row = canvas.board.row(card.id);
    commit(row.workspace!, 'export.ts', 'export const format = "csv";\n', 'Add report export');
    await workers().stop(card.id);
    return { id: card.id, workspace: row.workspace!, branch: row.branch! };
  }

  function merge(card: Awaited<ReturnType<typeof stoppedCard>>) {
    git(main, 'fetch', '--quiet', card.workspace, card.branch);
    git(main, 'merge', '--quiet', '--ff-only', 'FETCH_HEAD');
  }

  test('a manual merge after Stop allows Archive and keeps the conversation for restoring', async () => {
    const card = await stoppedCard();
    canvas.board.log(card.id, 'talk', 'owner', 'Merged manually.');
    merge(card);
    const response = await archive(card.id);
    expect(response.status).toBe(204);
    expect(canvas.board.row(card.id).workspace).toBeNull();
    expect(canvas.board.archived().map((i) => i.id)).toContain(card.id);
    expect(canvas.board.events(card.id).at(-1)?.text).toBe('Merged manually.');
    canvas.board.unarchive(card.id);
    expect(canvas.board.item(card.id)?.state).toBe('planned');
  });

  test('unmerged commits and uncommitted changes keep the stopped card and its workspace', async () => {
    const card = await stoppedCard();
    expect(await (await archive(card.id)).json()).toMatchObject({ code: 'holdsWork' });
    merge(card);
    writeFileSync(join(card.workspace, 'draft.ts'), 'unfinished');
    expect(await (await archive(card.id)).json()).toMatchObject({ code: 'holdsWork' });
    expect(canvas.board.item(card.id)?.workspace).toBe(card.workspace);
    expect(canvas.board.archived()).toEqual([]);
  });

  test('starting again during the archive check keeps the running card and its workspace', async () => {
    const card = await stoppedCard();
    merge(card);
    const spaces = canvas.repos[0]!.workspaces;
    const hasWork = spaces.hasWork.bind(spaces);
    let checking = false;
    let finish!: (work: boolean) => void;
    spaces.hasWork = (id, refresh) => refresh ? new Promise<boolean>((resolve) => { checking = true; finish = resolve; }) : hasWork(id);
    const response = archive(card.id);
    await until(() => checking);
    await workers().start(card.id);
    finish(false);
    expect(await (await response).json()).toMatchObject({ code: 'notDone' });
    expect(canvas.board.item(card.id)).toMatchObject({ state: 'working', workspace: card.workspace });
  });
});
