# Decisions log

One entry per non-obvious choice. Newest at the bottom.

## 2026-09-19 — Library lives in its own repo, not as a fork workspace package

The spec assumed a new workspace package inside the OpenCode fork. The user created `tui-dag` as a
separate repository (only a LICENSE at start). Consequence: the fork is consumed as a peer environment
(`../opencode-bio`) for verification, and Phase 4 adds the library as a dependency of `packages/tui`
instead of a `workspace:*` package. Keeps the fork diff at the plugin + one dependency line.

## 2026-09-19 — Verify against 0.4.5, not the online docs

The online docs describe 0.5.11 (npm latest, 2026-09-07); the fork pins 0.4.5 (2026-07-17). Everything
in the custom-renderable guide exists in 0.4.5. Known drift: renderer `render:error`/`handler:error`
events and `MouseEvent.currentTarget` are absent in 0.4.5. The docs' `TabFocus`, `onClick`, `onKeyUp`,
`RGBA.toHex`, `Renderable.setMeasureFunc` do not exist in either; use `rgbToHex()`,
`getLayoutNode().setMeasureFunc()`, compose click from `down`.

## 2026-09-19 — Subclass `Renderable`, even though the fork registers a FrameBufferRenderable

`packages/tui/src/component/bg-pulse.tsx` does register a `FrameBufferRenderable` subclass with Solid by
coercing `width`/`height` to `1` in the constructor, so the spec's "cannot be registered" is too strong.
We still subclass `Renderable`: the graph's size comes from a measure function, its rows are culled
individually, and a private frame buffer the size of a 10k-row graph would defeat that.

## 2026-09-19 — Loose peer ranges

`@opentui/solid` 0.4.5 declares an exact `solid-js: 1.9.12` peer while the fork pins a patched 1.9.10.
Our `peerDependencies` are `@opentui/core >=0.4.5`, `@opentui/solid >=0.4.5` (optional), `solid-js

> =1.9.0`(optional), mirroring`packages/plugin/package.json`, so bun resolves to the fork's single copies.

## 2026-09-19 — Two-sweep lane algorithm (tip-first "continuation" walk + forward lane pass)

Forward-only sweeps cannot know which child should continue a parent's lane; git solves this by walking
newest-first. We keep the time-ordered forward sweep (it maps 1:1 to rows and to a future incremental
mode) and add a first pass that walks first-parent chains back from the tips (optional `trunk` ids first,
then newest tip first), then from every merged-in head. Reproduces git's `--first-parent` column and the
target picture. Rejected: "earliest child continues" (puts the main line on a side lane whenever a side
branch is created first) and "newest child continues" (bends the trunk when a side branch starts after the
trunk's next node). Sources: git `graph.c`, Vigier's straight-branches algorithm, Sapling `renderdag`,
lazygit's pipe/cell model; see DESIGN.md §5.2.

## 2026-09-19 — Branch colours from a pool, lanes freed one row late, roots staggered

Colour = lowest palette index not used by a live lane (vscode-git-graph's pool), so neighbours differ and a
branch keeps its colour (git recolours at every merge). A lane closed by a merge is reusable from the next
row, so `╯` and `╮` never share a cell (renderdag does the same). A root right after a tip row avoids the
tip's lane so unrelated nodes never look connected (renderdag `stagger_consecutive_disconnected_nodes`).

## 2026-09-19 — Merges on the child's row, forks on a connector row after the parent

Keeps arms from above (merge) and arms to below (fork) on different rows, so no cell ever needs both
`╯` and `╮`. `forkStyle: "inline"` is offered for 1:1 row alignment with a documented ambiguity.

## 2026-09-19 — Arms bitmask in time/lane terms

Cells record `PREV | NEXT | LO | HI` instead of up/down/left/right, and glyph selection is a table lookup
after orientation mapping. `direction: "up"` is a row reversal plus a PREV/NEXT swap; a horizontal mode
later is a different mapping in the raster only.

## 2026-09-19 — Gap rows `"auto"` and labels `"flow"` by default

Read from the target picture: `│` rows appear only where two nodes on the same lane would be adjacent,
and labels start two cells after each row's rightmost lane rather than at a global column. Both are
options; open question 4 asks for confirmation.

## 2026-09-19 — Text width via `Bun.stringWidth` when available

Layers 1–3 have no dependencies. `Bun.stringWidth` is present in the target runtime and counts box
glyphs and `●` as width 1, `界` as 2. Fallback is grapheme count via `Intl.Segmenter`; `measureText` is
injectable.

## 2026-09-19 — `Attr` mirrors OpenTUI's `TextAttributes` bit layout

Layer 3 cannot import OpenTUI, so it defines the same bits (BOLD 1 … STRIKETHROUGH 128, verified in
0.4.5 `types.ts`). Layer 4 asserts equality at load so drift is caught by tests, not by wrong styling.

## 2026-09-19 — Keys are overridable and fully disable-able

OpenCode routes all keys through `@opentui/keymap` layers, so the renderable exposes `keys: false` plus
public movement methods (`moveSelection`, `selectParent`, ...) for a `useBindings` layer to call, while
standalone users get sensible built-in defaults.

## 2026-09-19 — Official OpenTUI agent skill not installed

`npx skills add anomalyco/opentui --skill opentui` exists but tracks 0.5.x; its index was saved to the
scratchpad for reference only. Installing a global skill is a user-environment change, left to the user.

## 2026-09-19 — Phase 0 answers from the user

Package name `opentui-dag` (published to npm later; until then the fork can use a git or file dependency).
First use case: session + subagent tree as the integration vehicle, research DAG as second consumer.
Horizontal mode is wanted, not just designed: it is scheduled after Phase 3 and the layout stays
orientation-neutral. Picture-derived defaults (`rowGap: "auto"`, `labelAlign: "flow"`, `forkStyle: "row"`)
confirmed. Peer packages and tooling installed as devDependencies; no runtime dependencies.

## 2026-09-19 — `DagLayout` is plain data; helpers are free functions

`rowOf(layout, id)` and `nodeAt(layout, row)` are functions rather than methods so a layout can be
serialised, compared with `toEqual` in tests, and passed across a worker boundary later.

## 2026-09-19 — Fatal vs non-fatal validation issues

Empty ids, duplicate ids, cycles and (in `unknownParent: "error"` mode) unknown parents make `validate()`
return `ok: false`. Unknown parents in `"root"`/`"stub"` mode are reported as non-fatal issues next to
the graph. Duplicate parent entries on one node are collapsed silently (first occurrence kept).

## 2026-09-19 — Horizontal link segments are recorded explicitly

Each row carries `links[i]` for the segment between lane `i` and `i+1` (branch and edge), so the raster
never has to infer which horizontal a spacer cell belongs to. When several horizontals share a spacer,
the one from the farthest lane wins so the long line reads continuous.

## 2026-09-19 — Gap rows key off the continuation map, not the lane's next edge

First implementation inserted a `│` row whenever the next node was the target of the edge occupying the
lane, which produced a `│ │` row before every merge (`E → F` in the picture). A merge is already visible
as `╯`, so the rule now checks `cont[node] === next`: only a true lane continuation gets a gap.

## 2026-09-19 — Lint stays at zero warnings, with the fork's oxlint config

The fork's `.oxlintrc.json` (type-aware, `suspicious` as warnings) is copied verbatim plus
`oxlint-tsgolint`. The library code avoids `as` casts by using `?? fallback`, `.at()` and explicit
`undefined` checks under `noUncheckedIndexedAccess`, which the fork relaxes but a library should keep.

## 2026-09-19 — Selection styling: label inverse, marker bold, dim everything outside the highlight

`selectedStyle` is applied to the label cells only (inverting a coloured `●` looks like a hole in a
block); the marker is drawn bold so a gutter-only view still shows the selection. Both are options.

## 2026-09-19 — Callback props are `onNodeSelect` / `onNodeActivate` / `onNodeHover`

The Solid reconciler special-cases the prop names `onSelect`, `onChange`, `onInput` and `onSubmit`; for
`onSelect` it wires Select/TabSelect events and otherwise drops the value silently, so `<dag_view
onSelect>` would never fire. The renderable's events keep the short names (`select`, `activate`, `hover`,
`layout`), reachable in Solid as `on:select` etc.

## 2026-09-19 — Height is never clamped by an `AtMost` measure constraint

Probing Yoga inside a ScrollBox showed it measures children with `AtMost` and the viewport height, then
re-measures with whatever height the child reports. Clamping made the graph exactly viewport-high and
unscrollable; OpenTUI's own text renderable reports its full height. Width still honours `AtMost` so labels
truncate to the space available. A flex column also stretches the view to its width by default
(`alignItems: "stretch"`), which is normal Yoga behaviour and left alone.

## 2026-09-19 — Layout recomputation is coalesced into a microtask

Solid applies all props of an element in one effect, each through a setter. Recomputing the layout in every
setter would lay out several times per change and could emit `layout` from inside a render pass. Setters
only mark the layout dirty and queue one microtask, which runs after the effect and before the next frame.

## 2026-09-19 — Draw runs of same-styled cells with `drawText`

Labels can contain wide or joined graphemes, which `setCell` cannot represent. Each row is drawn as runs of
consecutive cells with identical style through `drawText`, gutter glyphs included; a wide grapheme whose
continuation cell would fall outside the computed width is dropped rather than spilled.

## 2026-09-19 — One demo, written in Solid

The user asked for a single demo before integrating into OpenCode. OpenCode's TUI is Solid, so the demo is
the Solid app (`bun demo/index.tsx`); it exercises the renderable through the same binding OpenCode will use
and is smoke-tested headlessly with `testRender`.

## 2026-09-19 — `laneAllocation: "nearest"` as an option, leftmost stays the default

The hierarchical demo (lead → teams → agents) reads much better when a team's agents fork into lanes right
next to the team instead of the leftmost free lane anywhere, which can be on the far side of other teams.
The option takes the first free lane to the right of the parent and opens a new lane when there is none;
it never goes left (a first version fell back to the leftmost free lane, which put a rightmost team's agents
on the far left). The spec's narrow-graph default is unchanged.

## 2026-09-19 — `groupColors` alongside the hashed `group` strategy

Hashing six or seven group names into an eight-colour palette collides often. `groupColors` lets a consumer
pin groups to colours (a theme colour per agent role in OpenCode, palette order in the demo); unknown groups
still hash, so the spec's stability guarantee holds for the rest.

## 2026-09-19 — Check-ins modelled two ways in the investigation demo

A team reporting to the lead while continuing its work is either a _rejoin_ (report merges into the lead's
check-in, the team resumes from that lead node: compact, lane restarts in place) or a _report_ (side edge
into the check-in, the team's lane continues: lane-stable but one temporary lane and a crossing per report).
Both are offered because the OpenCode data can be mapped either way; the layout handles both without
special cases.

## 2026-09-20 — Layout split into sweep, lane assignment and row building; `nested` policy added

The user's hierarchical scenario (lead assigns teams, teams spawn agents) looked like spaghetti under the
greedy sweep: agents took whatever lane was free on the far right and every team forked from one node. A
greedy time-ordered allocation cannot keep a subtree together, so lane numbers are now assigned after the
sweep from branch lifetimes, and `"nested"` places the branch tree depth first. `leftmost`/`nearest` are
reproduced exactly by interval-based allocation in start order (all existing snapshots unchanged).

## 2026-09-20 — Investigation demo: assignments on the main line, report-style check-ins

Following the user's description, every team now branches from its own "lead assigns …" node on the lead
line, and check-ins are side edges into the lead's periodic check-in nodes so each team keeps one lane for
the whole investigation. The `rejoin` model stays available in the generator but is no longer a demo
fixture, because under `nested` a resumed team moves right of every live block.

## 2026-09-20 — An edge-only branch takes its source's group

A forked branch that the child will live in belongs to the child (`child.parents[0] === parent`); a branch
that only carries an edge into the child's own lane — a report, a merge back — is the parent's lineage and
now keeps the parent's group, so a team's report to the lead is drawn in the team colour rather than the
lead's. Same rule the OpenCode view needs for a subagent's result flowing back into its session.

## 2026-09-20 — Hierarchy and text in the investigation demo

User feedback: three same-coloured parallel lines per team were unreadable and the labels too long. Agents
now live in a `<team>/agents` group drawn in a faded shade of the team colour with hollow `○` markers and
dimmed one-word labels; team nodes keep the bright colour and phase names; lead labels are bold and short.
The fade is computed in the demo from the active palette, nothing in the library changed for it.

## 2026-09-20 — Phase labels sit at the fork, not at the merge

User feedback: "2 agents" belongs where the agents are spawned. A phase with agents now has a team node at the
split labelled `phase · N agents`; the merge node that receives the agents' results is just `done`.
