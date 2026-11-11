# Code-change walkthrough videos

> Plan for a second video beside a card's behaviour demo, made with the demo skill. This doc
> records the agreed design and the packages that can land in order; it implements none of them.
> When the project is done, move the lasting behaviour and decisions into the design chapters and
> remove this doc and its link from `CONTRIBUTING.md`.

## Goal

Let the owner judge a card's code quality before approving it, through a narrated tour of the
patterns chosen, the architecture the change fits into or alters, and the domain boundaries it
respects, draws or crosses. The code video works for backend design and user-visible surfaces
alike, beside the behaviour demo, and is off until a repository enables it.

## Where it stands

The demo skill in `plugin/skills/demo/` already scripts scenes, synthesises narration and records
a headless browser into a video with chapters and captions. Its instructions cover behaviour
only. A handover accepts one video or HTML artifact; the card's change list opens it in the same
area as changed files. Comments on a paused video reach the worker with the chapter, narration's
sentence and frame. Repository settings currently give `demo` a language and a sharing site.

Two trials established the level and the reusable pieces. Reading source from git by file and
range works. The first tour was too close to individual lines and treated design principles as
a checklist. Side-by-side excerpts, manually timed highlights, a resting pointer and a view with
its own tabs and footer made it harder to read.

The owner confirmed the second tour as the reference: 2:06 over change `8a82fe8a`, six chapters,
three of them on the structure view, with three patterns, one design observation and two evidence
excerpts. Its implementation is at commit `a1b31869`, under `plugin/skills/demo/prototype/`
(about 330 lines). Git-backed views and lighting driven by narration parts carry forward. Fixed
commit, excerpt selection and manual coordinates are shortcuts to remove. The awkward part was
placing boxes and arrows: a label overlapped a lane subtitle and an arrow crossed an inferred
boundary's label. Automatic layout is the largest piece still to build.

No product decisions remain open. The limits of a diagram that fits are to be established during
implementation, using the confirmed three-lane, eight-box view as a known readable case.

## Design

### Audience and narration

The card's own worker makes the code video in its session, after the behaviour demo. A normal
tour lasts 1–3 minutes according to the size of the change, in this order:

1. Where the change sits: the domains or layers it touches and the path through them.
2. Boundaries: what each side knows of the other, boundaries respected, newly drawn or crossed,
   and new dependencies between modules.
3. Chosen patterns, with the alternative not taken and why, and an existing use in the code base
   with file and lines.
4. What stands out, if anything: the fact first, then the worker's reason and its trade-off,
   with the location. Where nothing stands out, say that in a sentence.
5. A recap.

Code excerpts appear where a claim needs proof, at most three evidence scenes in a tour. Tests
and generated files are counted in the structure view and are not toured.

Principles are a lens, not chapters or a checklist. YAGNI, DRY, KISS, WET (up to two similar
implementations before an abstraction) and least astonishment are examples of what the owner
may value. Use the repository's docs and the setting's prose to learn what matters, and name a
principle only where the change gives reason to; other relevant principles may be named too.
The worker presents evidence and reasons without assigning a grade. The owner judges.

### The change view

The skill builds a local page from the change; no app needs to run. The existing director records
it in a smaller frame than an app demo, starting from the confirmed 1000 × 800 frame so text stays
large in the card's player. It has no pointer or navigation chrome of its own. Four views serve
the narration:

- **Structure, the main view.** Lanes use the domains or layers named by the repository's docs,
  layout and, where supplied, `demo.code`. Boxes show each module's role in this change, its path
  and change size, including modules the change relies on. Labelled arrows show who uses whom.
  Additions use the accent. Boundaries may be drawn inside a lane; an inferred one is marked
  inferred in the picture and narration. Every box's path is checked in git, and an arrow can
  carry the file and line that proves it. The path lights up box by box with the narration.
- **Patterns.** Each panel says what was chosen, what was not taken and why, and where the code
  base already uses the pattern, with file and lines.
- **What stands out.** The few design choices a reviewer would pause at, each as fact, reason
  and trade-off, with its location. No row per principle.
- **Evidence.** One excerpt, or two to three stacked at full width, in large type, read from git
  at an explicit revision by path and range. One wrapping rule handles long lines, preserving
  source line references.

The agent supplies lanes, each lane's boxes in path order, and arrows with labels. The view
places boxes, routes arrows and keeps labels clear of other text, including lane subtitles and
boundary labels. It refuses a diagram that does not fit, with a reason the worker can act on
(too many lanes or boxes, or a label too long). Discover and test concrete limits while building;
do not make the agent supply coordinates.

A scene gives narration in parts, each naming what it lights: boxes, arrows, panels or lines.
The director times lighting to the spoken part, without manually supplied highlight times. It
keeps the existing narration, chapter and caption pipeline, including silent renders.

### Repository setting

`demo.code` is one optional field of prose, like `app.run`. Its presence enables the code video;
its words describe what the owner looks for and can point to the repository's boundaries. No
separate boolean or list of principle switches is needed. Example:

```json
{
  "demo": {
    "code": "Explain the patterns, the architecture and the domain boundaries of the change. I value simple designs without speculative abstraction; think of YAGNI, DRY, KISS, WET and least astonishment. Our layers are described in docs/design.md."
  }
}
```

The field follows other repository settings: editable in Configuration for this machine, or
taken over into `.obeya/settings.json` for everyone. The worker receives the prose, and the skill
also reads it when used without Obeya. Existing demo language and voice settings apply.

### Handover and the card

`ready_for_review` accepts a second, explicitly identified video alongside the existing behaviour
demo or artifact. Keep and serve it with the same handover history, caption tracks, chapters,
remote-worker transfer and frame cleanup as a behaviour video. Existing cards and handovers
without one remain readable; a later handover can retain the earlier video as with the demo.

The change list has a second line, "Code video", under "Demo video" (or the behaviour artifact's
existing row). Selecting either uses the same player and its chapters and captions, on desktop
and phone. Only the behaviour demo starts automatically. Files and diffs stay in the background.
Comments made at a place in either video reach the worker with the video identity as well as
today's chapter, sentence and frame, so a later retake cannot confuse the reference.

The code video stays on the owner's card. Sharing, automatic publishing on approval, exports and
pages for colleagues keep the behaviour demo alone, including for contributor reviews.

### By kind of card

These requirements apply when `demo.code` is present:

- **Tasks that change code:** refuse an initial handover without a code video, as today without
  a behaviour demo. A docs-only change needs none. After feedback, whether to record it again is
  the worker's call, as with the demo. Use the card's complete change, not just its latest commit.
- **Contributor review cards:** after reviewing, tour the contributor's change from merge base
  to pull-request head, showing where each finding sits. A design problem needing a decision is
  recorded as a review finding through the existing mechanism. The code video is for the owner
  and never goes to the contributor. The required handover includes it.
- **Prototypes:** require a short code video, 30–60 s, showing the approach and structure, what
  would carry into a build on this branch and what is a shortcut. Keep the limited build brief;
  this tour does not turn a throwaway build into production work.

### Chosen approach and scope

Variant B, a separate code video from the demo skill, is settled. Live slide walkthroughs with a
diff slide (A), code chapters appended to the behaviour demo (C), and walkthrough exports (D) were
rejected: the owner prefers video, and colleagues watching the behaviour demo should not receive
the code tour. "Presentations" in the idea does not add a separate presentation feature.

This project does not add a code-quality score, a mandatory principle checklist, an app inspection
surface, or a second sharing system. It does not enable code videos for every repository by
default. This planning change adds only this doc and its link; all implementation is below.

## Workstreams

Land these in order, W1 → W2 → W3 → W4. Each package leaves a usable result: first a scriptable
change view, then a standalone skill mode, then task-card integration, then the remaining card
rules. Keep work sequential where the skill, director, settings or handover code overlaps.

- [ ] **W1:** Change view and narration-driven lighting. Builds on the prototype "Design-level
  code video", taking over its branch and the reusable views at `a1b31869` under
  `plugin/skills/demo/prototype/`. Bring those into the demo skill as supported code, removing
  the fixed change and manual coordinates. Implement the four views above, git validation and
  excerpts, the shared long-line wrapping rule, automatic structure layout and actionable fit
  refusal. Extend the director for narration parts and their lighting, using the smaller frame
  without a pointer. Test valid and missing git paths/ranges, readable layout, label and boundary
  clearance, overflow refusal, lighting and existing demo compatibility. Done when a video of a
  landed change can be scripted with lanes, ordered boxes and labelled arrows without any manual
  placement or highlight timing, and its video is legible in the card's player and enlarged.
- [ ] **W2:** Code-video mode in the demo skill. After W1, write its instructions and an example
  script: purpose, design level, narration order, evidence limits, principles as a lens, fact
  before reason, named inferred boundaries, and the short form defined above. Keep behaviour-demo
  guidance scoped to that mode, so its current instruction to omit code does not block the new
  one. Use repository prose and docs for the lens and boundaries; support explicit change ranges
  and use without Obeya. Have the worker watch its whole video for legibility, complete narration,
  correct lighting and claims supported by evidence. Update `docs/design/demos.md` and relevant
  demo setup guidance. Done when the example produces a complete tour without an app or Obeya,
  at the confirmed design level, with captions and chapters, and normal behaviour demos still
  follow their existing recipe.
- [ ] **W3:** Repository opt-in and task-card integration. After W2, carry `demo.code` through
  settings validation, resolution, Configuration, worker briefs, `docs/settings.md` and the
  settings skill. Extend `ready_for_review` and stored handovers to accept and require the second
  video for code-changing tasks, exempt docs-only changes and retain an earlier video after
  feedback. Keep, transfer and serve both videos; identify which video a timed comment concerns.
  Add the second change-list row using the shared player on desktop and phone, with chapters,
  captions and autoplay only for the behaviour demo. Keep code videos out of sharing, publishing
  and exports. Add both string tables and update the affected design chapters (demos,
  repositories and configuration, card lifecycle, conversation on the card, sharing and data).
  Verify opt-in and opt-out, the docs-only exemption, refusal before a required video is supplied,
  old handovers, later handovers, history and copying, comments on both videos and sharing only
  the behaviour demo. Check desktop and phone in a scratch Obeya. Done when an enabled task
  hands over both videos and the owner can watch and comment on each before approving.
- [ ] **W4:** Contributor reviews and short-form handovers. After W3, extend the remaining card
  briefs and required handovers according to By kind of card: the contributor's merge-base-to-head
  tour after review, with findings located in it, and the 30–60 s tour of approach, structure,
  carry-forward parts and shortcuts. Keep finding decisions in the existing review mechanism and
  code videos out of contributor communication. Reuse the setting, storage, player and timed
  comments from W3. Update the landing and ideas design chapters and verify required, retained
  and disabled videos for these card kinds, including a new contributor head. Done when both
  follow their respective narration and handover rules end to end. Move the lasting design and
  decisions out of this plan, remove its link, then remove the completed plan doc.

## Validation and effort

Every package runs the repository's checks (`bun run test`, `bun run typecheck`), with focused
tests for its new behaviour and a demo of its result. Layout and narration need visual review of
the rendered video, not just tests. W3 and W4 use a scratch Obeya, including phone-sized checks;
never use the owner's instance for tests. Keep videos, recordings and render frames out of git.

W1 is the largest package (roughly one to two worker tasks); W2 is about one, W3 one to two, W4
half to one. The two measured tours took 12 and 14 minutes with two renders each, including
extending the view. With the view in the skill, the expected per-card cost is 5–10 minutes of
agent work for the script and one or two renders. This is an estimate to verify in use. Frames
take about half a gigabyte until the existing cleanup removes them; no application startup is
needed for the code video.

## Open questions

None. Fit limits and layout details are implementation work, not a reopened product choice.
