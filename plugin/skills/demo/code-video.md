# Code-video mode

Explain a change's design to the owner: where it fits, what knows about what, and why the chosen
patterns make sense here. The owner judges; present evidence and trade-offs without a grade.
Keep the tour at the level of domains, layers, module roles and dependencies. Source is proof
for a claim, not a line-by-line reading of the diff.

## Establish the change and its lens

Read the repository's instructions, design index and relevant chapters, plus the change's diff
and commit messages. Read the code-review prose supplied in the task or in `demo.code` of the
repository's `.obeya/settings.json`, when present. These are the lens and the names for the
domains and boundaries; source verifies that the picture is true. Without Obeya, read the same
files directly. If no code prose is supplied, use the repository's own design principles.
An absent opt-in does not prevent a directly requested code video.

Select **explicit base and head commits** and record their resolved hashes in the report:

- One commit: its parent and that commit.
- A supplied `BASE..HEAD` range: those exact endpoints. For `BASE...HEAD`, first compute
  `git merge-base BASE HEAD` and use it as the base.
- A branch or contributor change: the merge base with its target branch and its head.
- Own work: the complete card change, including its earlier commits, not just the last commit.
  Use the card's starting point when supplied; otherwise establish the base from the target
  branch and verify the diff covers the intended work.

`serveChangeView({ repo, base, head })` resolves refs once and reads only committed git objects;
it neither checks out a revision nor reads dirty files. If the intended change includes
uncommitted work, obtain a committed snapshot before recording: the normal authorized commit,
or a private temporary repository containing the intended before and after trees. Keep the
original checkout untouched and include tracked edits and intended new files in that snapshot.
State its provenance in the report. Do not silently omit dirty work or claim it is in a pinned
head. An unavailable revision or source is a limit to resolve or name, not evidence to invent.

Use principles as a lens, never as chapters or a checklist: YAGNI, DRY, KISS, WET (up to two
similar implementations before an abstraction) and least astonishment are examples, not a
mandatory list. Name one only when the change makes it useful; other repository principles may
matter more. Separate a documented reason from your interpretation. Say "the guide asks for…"
when it does, and "this appears to…" when the reason is inferred from code.

## Plan a complete tour

A normal tour takes 1–3 minutes, according to the change, in this order:

1. **Where it sits.** Show the domains or layers touched, module roles, and the path through
   them. Make the structure view the main view, returning to it as the explanation needs it.
2. **Boundaries.** Explain what each side knows, boundaries respected, drawn or crossed, and
   new dependencies. Use the repository's names. Name every inferred boundary explicitly in
   the narration and mark it `inferred: true` in the diagram; distinguish it from a documented
   domain boundary. Arrows mean "uses", with the caller pointing at what it uses.
3. **Patterns.** Explain the choice, the alternative not taken and why, and an existing use in
   this code base with file and lines. If there is no precedent, say so; do not manufacture one.
4. **What stands out, if anything.** State the observable **fact first**, then the reason and
   trade-off, with its location. An inferred reason stays identified as such. When nothing
   stands out, say that in one sentence instead of filling an observations panel.
5. **Recap.** Summarise the approach and the material trade-off in a sentence.

Show excerpts only where a claim needs proof, at most **three evidence scenes** in the whole
tour. Each has one excerpt or two to three stacked at full width, from explicit revisions and
inclusive line ranges. Place them beside the claim in the narration order. Count tests and
generated files in the structure view rather than touring them. Tests and source can support
claims about structure; a code video alone does not prove runtime behaviour or performance.

For a **prototype**, use the short form: **30–60 seconds**, showing the approach and structure,
what would carry into a build on this branch, and what is a shortcut. Keep the limited build
brief; it does not become production work for the sake of a tour. Keep the same evidence limits,
named inferences, fact-before-reason order and recap, combining them into fewer scenes.

## Script and render

Read the common setup and narration conventions in `SKILL.md` and run `lib/settings.ts` from
the subject repository before writing. Use its language and person for the narration, chapter
titles and report; keep the language explicit when rendering from a different directory.
Use the normal voice and subtitle settings. The runnable
[`example/code-video.ts`](example/code-video.ts) creates a tiny two-commit repository with its
own design prose and makes all four views, with captions and chapters. It needs Git and the
normal demo tools, but no app, accounts or Obeya. See [setup](../../../docs/demo-setup.md#code-videos-without-an-app).

For a real change, copy the script to its own directory under the configured demo directory.
Replace its fixture with the subject `repo`, `base` and `head`, and write the views and narration
from that change's docs and source. Replace the relative skill imports with absolute paths.
The example's paths and claims describe its fixture, not an arbitrary repository.

Start `serveChangeView`, pass its URL to `runDemo`, set `viewport: CHANGE_VIEWPORT` and
`pointer: false`, and close the server in `finally`. In `open`, load `/` and wait for
`window.__change`. In each scene's `run`, prepare its view with `d.showChange(view)`. Give
narration as `parts`, each ending at a full sentence and naming its `light` targets. The director
times lighting to the narration and captions; no hand-written highlight times are needed.
See [change-view.md](change-view.md) for view shapes, git validation and layout limits. A fit
refusal means shorten labels, select fewer elements or split a scene; keep the readable type.

Run `--dry`, then render with the shared pipeline in `SKILL.md` section 5. Record the exact range,
repository lens, snapshot provenance and any unverified claim in `report.meta` or `summary`.
Review the **entire video** as section 6 requires: legibility at both player sizes, complete
narration, correct lighting, and claims supported by the pinned evidence. Re-render until clean.

Keep `demo.mp4`, captions, chapters and `index.html` together. Without Obeya, give the owner the
local report page and its duration, with any open question or evidence limit. Under Obeya, use
the handover fields the session exposes for the requested video. Do not replace a requested behaviour demo
with a code tour. The code tour stays with its owner; sharing the behaviour demo does not
authorize sharing source or the code video.
