# Run tasks in the project folder

> Plan from “Assess running cards directly in the main repository”, recorded on 2026-11-13.
> The owner chose work directly in the configured checkout, with a repository default and a
> per-task override. W1 ships the repository default; per-task selection and conflict scheduling remain below. Each workstream
> is a complete, separately landable step. Delete this plan when the last workstream ships,
> keeping the resulting behaviour and decisions in the design chapters and settings reference.

## Goal

Tasks can work in the repository's project folder when that is where the app, local configuration,
database or large ignored files live, when the task concerns existing uncommitted work, or when
the owner wants to follow and edit along in the IDE. The repository chooses the default; an
individual task can choose another place before it starts, and its changes remain visible and
can be discarded without a branch or a landing.

## Where it stands

- `workspaces` chooses worktrees, clones or the project folder, layered with this machine's
  configuration. A run keeps its resolved place across restarts and default changes. The shared
  start-button menu also chooses the per-task place; an unset choice follows the default until start.
- Ordinary tasks can use the configured checkout as it stands. Prototypes, pull request reviews,
  workstreams and builds on a prototype retain isolated workspaces. Checkout runs have no task
  branch or landing, skip setup, keep normal checks and never park or stop the existing app.
- Folder tracking is reused per card in git repositories: tracked and non-ignored untracked
  files, plus direct edits of ignored files. Obeya's own writes are excluded. Changes, text diffs
  and safeguarded discard use the existing change-list view; W2 finishes its presentation.
- The existing landing guard still refuses to overwrite local changes. Scheduling around
  checkout changes and attributing blocked landings to their tasks is W3.

Useful starting points: the per-card workspace contract and allocation in
`src/server/workspaces.ts` and `src/server/project-workspaces.ts`, tracking and undo in
`src/server/folder.ts`, worker lifecycle in `src/server/workers.ts`, plan parsing in
`src/core/plan-doc.ts`, settings in `src/server/settings.ts` and `src/adapters/`, and the shared
start menu and change-list views under `src/ui/`.

## Agreed behaviour

### Choosing the place

“Agents work in” in Configuration adds “project folder” beside worktrees and clones, using the
existing repository/machine layering and source label. Its explanation says that tasks work in
the folder itself without a branch of their own, their changes stay there and are listed, and
the start-button menu can choose a worktree instead. It also names the exceptions: prototypes,
pull request reviews and workstreams always have a workspace of their own.

The start-button menu adds “Works in”, with “A workspace of its own” and “The project folder”.
Mark the repository default. Explain the latter as working on the branch as it stands, without
its own branch, with changes listed and discardable. Like the agent choice, an unset choice
follows the default until start; an explicit departure is stored with the card, survives closing
and reloading, applies to a queued or later start, and is named beside the button. Resolve the
place at start and keep it for the whole run, including stop/resume and repository restarts;
changing the repository default affects only later runs. Keep the existing configuration restart
behaviour without moving a card that has already started.

Tasks, follow-ups, accepted proposals and building an idea from its card use this choice.
Prototypes, pull request reviews and workstreams always use their own workspace: their branch
must land or be thrown away, and a workstream's completion depends on its plan-doc box landing.
In a repository whose default is project folder, “A workspace of its own” means a worktree;
clones remain the mode selected under “clones”. The new mode runs on this machine only, is not
offered for hosts or when the configured checkout is itself a leased clone, and leaves folders
without git as they are. Enforce eligibility in the server as well as the UI, including when
configuration changes after a choice was saved.

### Working and handing over

Use the configured checkout as it stands, on its current branch; where work lands on local main,
that is main. Obeya makes no task branch and switches no branch for this mode. The worker is told
that the owner, other tasks in place and Obeya's landings can change it concurrently, to leave
unrelated work alone, and to make no commit or branch switch unless the task asks. Approval makes
the card done and leaves its changes there, uncommitted unless a commit was requested; Obeya does
not commit on approval, since it cannot separate a task's lines from the owner's in the same file.
Nothing lands for this card, regardless of the repository's landing setting.

Use the app already running there. Skip repository `setup`; run the normal checks. Obeya never
parks or stops that app for an in-place task, including through workspace release or cleanup.
The handover still follows the rules for a git repository: a demo always, and a code video when
the repository requests it, judged on the card's listed changes rather than a branch diff.

### Changes and discard

Reuse the folder change-list and undo interaction per card. Follow tracked files and untracked
files git does not ignore, plus any file edited directly by the worker's editing tools, even
when ignored. Do not follow script changes inside ignored paths (dependencies, build output,
databases, caches or logs), and do not snapshot or restore git's own metadata. An explicitly
edited ignored local configuration file is a result; a database changed by a script is not.

Writes Obeya makes itself, including another card's landing, a pull after merge and taking over
settings, belong to no in-place task, even during its command. Exclude those actual writes
without suppressing unrelated concurrent edits. Keep the existing protection for overlapping
cards and files changed after the task: shared or subsequently changed files are not blindly
restored. The waiting card shows “Changed in the project folder: 4 files +12 −1 · Undo: full”,
the files and their diffs, ignored status where relevant, and “Discard changes” with the existing
undo safeguards. Approval explains that the changes stay in the folder uncommitted.

Allow any number of tasks in place; slots cap busy workers wherever they work. The Coordinator
checks both directions before starting: an in-place task against other in-place changes, and a
task in its own workspace against the uncommitted changes its eventual landing would hit. Also
check the inverse start order: a new in-place task against the estimated and actual changes of an
already-running task in its own workspace. Include changes left by waiting, stopped or approved
in-place tasks while they remain uncommitted, not
just busy workers. If a landing still stops on them, its message names the task or tasks that
left the affected files. Retain the existing protection for local changes with no known task.

## Workstreams

- [x] **W1:** Run a repository's tasks in the project folder. Add the third `workspaces` choice,
  its layering, validation, source label and explanation in Configuration. Persist each run's
  resolved place and apply the eligibility rules, so ordinary tasks use the configured checkout
  while prototypes, pull request reviews and workstreams still get their own workspace. Adapt
  the existing folder tracking, diffs and undo to work per card in a git repository, with git
  ignore filtering, direct edits of ignored files, and attribution that excludes Obeya's own
  writes. Wire the worker briefing, skipped setup, ordinary checks, no app stopping, approval
  to done and git-repository demo requirements. Reuse the existing change-list view so this
  step is usable on its own; preserve the current landing guard. Verify with real temporary git
  repositories and the fake runtime: dirty/untracked input is preserved; no branch, commit or
  landing is created; a restart or default change keeps a run's place; ignored script output is
  excluded but a direct ignored edit is included; overlapping edits and later edits are safe
  on discard; landing, pull and settings writes are excluded during an open command; setup and
  stop never run for this mode. Exercise both harnesses' tracking hooks. Measure manifest and
  snapshot cost in a realistic live project with ignored dependencies/build output and a running
  app, and report what is scanned and the observed cost; the archive measurement alone is not
  evidence for this mode. Demo a whole repository using the default, including changed files,
  discard and approval. Update the workspace, parking, configuration and landing design text
  and `docs/settings.md` to describe only what this step ships.
- [x] **W2:** Let each task choose its place before starting. After W1, add “Works in” to the
  shared start-button menu beside the agent choice, with the repository default marked, the
  project-folder explanation and an explicit choice named beside the button. Store the override
  with the card and carry it through every eligible start path: tasks, follow-ups, accepted
  proposals and an idea built from its card, including queued and later starts. Keep the choice
  fixed during a run and enforce the ineligible kinds and locations on both client and server.
  Finish the project-folder change-list wording, diffs, ignored-file labels, undo coverage and
  approval explanation in German and English; use the same controls and states on the phone.
  Verify default versus override, a default changed while queued, close/reload persistence,
  stop/resume, exceptional card kinds and the worktree fallback when the default is project
  folder. Inspect desktop and phone screenshots and demo choosing each direction, reopening the
  card, then reviewing its in-place changes. Update the start-menu and card presentation design
  text and settings reference in the same change.
- [ ] **W3:** Schedule around changes in the project folder. After W1 and W2, give the
  Coordinator the per-card location and relevant in-place changes, and check conflicts in both
  directions before a start, whichever task starts first. Keep changes left uncommitted by
  waiting, stopped or approved tasks
  in view while they can block work; a card becoming done does not clear that obstacle. Do not
  soften those checks with the branch scheduler's soft-path exclusions when they could permit
  overlapping edits or an obstructed landing in the shared folder. Keep the normal queue,
  dependency, slot and “Start anyway” behaviour. When the existing landing guard catches an
  overlap nevertheless, name the responsible task or tasks for the affected files without
  assigning unrelated owner changes to a task. Verify both start directions, disjoint work in
  parallel, overlapping tool windows, changes retained after approval, changes later committed
  or discarded, slot limits and a landing stopped despite scheduling (including “Start anyway”).
  Demo the queue holding a conflicting task and a blocked landing naming the earlier task.
  Update the Coordinator and landing design chapters with the shipped behaviour.

## Delivery and verification

Land W1, then W2, then W3. W1 deliberately delivers a repository-wide trial before per-task
selection and the richer scheduler; its existing landing refusal must still protect local work.
The reliability and cost of attribution in a live project folder are the main risk: if W1 cannot
keep Obeya's own writes out or present honest undo coverage, settle that before enabling the new
choice. W1 measured the live Obeya worktree with its scratch server running, installed dependencies and
compiled output present: 584 git-visible files totalling 11.65 MB, with 8,178 dependency/build
files (about 508 MiB) excluded. Five runs took 7.88–9.62 ms for the metadata manifest and
42.30–48.26 ms for full undo preparation. The manifest enumerates git-visible paths and stats
those files and their parents; the snapshot clones only those visible files. Direct edits inspect
their named file, including ignored files. `scripts/measure-project-folder.ts` repeats the actual
manifest and snapshot paths in a live checkout, with snapshots outside it.

Each workstream runs `bun run test` and `bun run typecheck`, uses isolated scratch repositories
and a scratch Obeya (never the owner's checkout or live instance), and hands over its observable
result with a demo. Tests must also cover the existing worktree, clone and non-git-folder paths.
Update the relevant chapters as behaviour ships, without describing future steps as present
behaviour. Tick each workstream as part of its landing. At completion reconcile
[Agents and workspaces](../design/agents-and-workspaces.md),
[Repositories and configuration](../design/repositories-and-configuration.md),
[The Coordinator](../design/the-coordinator.md), [Landing](../design/landing.md),
[Conversation on the card](../design/conversation-on-the-card.md) and the
[settings reference](../settings.md), keeping each rule in one place; remove this plan and its
link from the contributor guide.

## Decisions, limits and non-goals

The owner chose the project folder for its environment, existing local work and IDE collaboration;
both a repository default and a per-task departure; no task branch or landing, with listed and
discardable changes. The idea's working decisions are retained: no commit by default, direct
edits only for ignored files, any number of in-place tasks, workstreams isolated in the first
version, and a worktree for the individual task that departs from a project-folder default.
There is no blocking product question.

Changes are live before approval, visible to the app and to agents reading the checkout. Owner
saves and non-ignored IDE writes during a worker's writing command can count as the task's work
and be candidates for discard; the card's list must make this visible beforehand. Pending changes
can block a later landing even after approval, until committed or discarded. This is file-level
attribution, not a promise to identify who wrote each line.

Undo uses full filesystem clones where supported (macOS/APFS, btrfs, XFS), and text-file coverage
elsewhere, as on folder cards. W1 may additionally recover an originally unmodified tracked file
from git to improve coverage, but must verify the exact earlier state and advertise only the
coverage it can deliver. It must not replace pre-existing dirty content with the version in git.
That implementation choice is left to W1 and does not block this plan.

Not included: in-place workstreams/projects, hosts, moving an active run to another workspace,
automatic commits, line-level authorship, or tracking/restoring ignored files changed by scripts.
The alternative of a second fully set-up clone (variant 0) solves only the environment, not work
on files already in the project folder or following along in that IDE. Leasing the checkout on
the card's branch (variant B) requires a clean checkout, takes the read tree off main and reopens
the 2026-10-30 decision; it remains rejected. A per-task choice alone or a repository choice alone
misses one of the owner's needs. Telling the worker only in task text gives neither a change list
nor undo. Preserve these reasons in the design decisions when the corresponding step ships.
