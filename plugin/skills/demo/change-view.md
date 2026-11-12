# Change-view API

The demo director can record a git-backed local page without running an application. Import
`serveChangeView` and `CHANGE_VIEWPORT` from `lib/change-view.ts`. Start the server with
`{ repo, base, head }`, use its `url` as the demo's `baseUrl`, and close it in `finally`. Both
endpoints are explicit git commits or refs and resolve to commit hashes. Nothing reads source
from the working tree. For one commit, supply its parent as `base`; for a branch tour, supply the
merge base and branch head.

Use `viewport: CHANGE_VIEWPORT` (1000 × 800) and `pointer: false` in `runDemo`. In `open`, call
`d.goto('/')` and wait for `window.__change`. `d.showChange(view)` validates the view's source,
places it and rejects it if it cannot fit. It works during `--dry`, before synthesis or recording.

## Views

All views have `title`, optional `subtitle` and optional `note`. Without a subtitle the page shows
the base and head hashes. Text is escaped and cannot execute as HTML.

- `view: 'structure'`: `lanes` each have a title, optional subtitle and `boxes` in path order.
  Each box has a unique `id`, `file` and role `title`, with an optional `revision` (head by default).
  Existing modules are marked as existing; changed modules show their additions and removals.
  A lane's optional `boundaries` name `after` (a box id), `label` and `inferred: true` where needed.
  `arrows` have unique `id`, `from`, `to` (box ids), a short `label`, and optional `proof` ranges.
  Arrows point from user to used module; dashed arrows cross lanes. Tests, documentation and
  generated files are counted beneath the diagram. Standard generated directories and lockfiles
  are recognized; `generated` in the server options adds repository-relative generated paths.
- `view: 'patterns'`: `panels` have `id`, `title`, `chosen`, `alternative` (include why), `precedent`
  and `where` (one or more source ranges).
- `view: 'observations'`: `panels` have `id`, `title`, `fact`, `reason`, `tradeoff` and `where`.
- `view: 'evidence'`: `excerpts` have `id`, `file`, `from`, `to`, optional `revision` and `label`.
  One to three excerpts are stacked at full width.

A source range is `{ file, from, to, revision? }`, with inclusive, one-based line numbers. Every
box, panel location, arrow proof and excerpt is checked in git. Deleted files need a revision
where they exist, usually the base. Missing paths, non-text blobs and out-of-bounds ranges fail
with the path and a correction. Paths are literal, repository-relative paths, including names
with spaces or glob characters. Only regular files can be source evidence.

Each excerpt uses the same wrapping rule: expand tabs to two-column stops, remove the common
indentation of nonblank lines, then wrap at the available width, breaking long tokens where
necessary. A source line keeps one line number across all its visual rows. Added lines at head
and removed lines at base are marked; excerpts at other revisions show context.

## Narration parts

A scene accepts either the existing `say` with `run`, or `parts`. Each part has `say`, optional
`run(d)` and optional `light`. A part may contain several sentences; end each part at a complete
sentence boundary. A scene's `run` prepares the view before its narration clock starts. A part's `run` runs at its
spoken start, followed by its lighting:

```ts
{
  title: 'The path of the choice',
  run: d => d.showChange(structure),
  parts: [
    { say: 'The dialog saves through the settings API.',
      light: { boxes: ['dialog', 'settings'], arrows: ['save'] } },
    { say: 'Launch policy reads the stored choice.',
      light: { boxes: ['policy'], arrows: ['read'] } },
  ],
}
```

`light` can name `boxes`, `arrows`, `panels` (arrays of ids), or `lines` (ranges
`{ excerpt, from, to? }`, `to` defaulting to `from`). Each part replaces the previous lighting;
an omitted or empty `light` clears it. Unknown ids and lines outside a visible excerpt fail the
scene. `d.lightChange(light)` offers the same operation directly.

Parts share the existing scene narration, chapter and caption pipeline. Their offsets use the
caption sentence times, including heard-back speech alignment and the slowest subtitle language
in a silent render. No time fractions or reads of cached narration files belong in the script.
Existing `say` scenes and app-demo pointers keep their current behavior.

## Fit and limits

Layout measures text at its recording size. Structure supports one to three lanes, one to three
ordered boxes per lane and at most ten selected arrows. Three lanes with eight boxes and seven
labelled arrows, including an inferred boundary, are covered in the browser checks. Box titles,
paths and lane subtitles wrap; arrow labels stay one short phrase (up to 260 measured pixels).
Labels reserve space before arrows are routed; routes avoid boxes, headings, boundary labels and
all arrow labels. A diagram can still refuse within these counts when its text or routes need
more space. Excerpts and panels have the same frame-height check.

A refusal names the problem and asks for a concrete correction: shorten a title, label or note,
reduce the excerpt range, show fewer arrows or split the view into another scene. The renderer
keeps readable type rather than shrinking or clipping content. There are no author coordinates,
zoom factors or placement overrides.
