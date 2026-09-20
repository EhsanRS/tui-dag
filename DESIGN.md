# tui-dag — design

Status: Phases 1–3 done (core, `DagRenderable`, Solid bindings, one Solid demo), all tested; next is the
OpenCode integration, then horizontal mode and polish. Everything below was checked against the installed
`@opentui/core` / `@opentui/solid` **0.4.5** typings in the OpenCode fork, not against memory or the
(newer, 0.5.11) online docs. Where the two disagree, the installed types win; see `DECISIONS.md`.

## 1. Goal

A small, well-tested library that draws a directed acyclic graph as a **lane graph**: one row per node
along a time axis, each branch in its own column (lane) with its own colour, connectors that fork and
merge. `git log --graph`, but generic, and usable as a one-liner in a Solid OpenTUI view:

```
●  initial prompt
│
●  refine plan
├─╮
│ ●  approach B
● │  approach A
│ ●  B: tests pass
●─╯  merge B into A
│
●  final answer
```

First consumer: the OpenCode fork at `../opencode-bio` (OpenTUI 0.4.5, Solid 1.9.10). The library
itself lives in this repo and must stay reusable outside OpenCode.

## 2. What recon found (facts the design relies on)

Repository and conventions (fork):

- The TUI lives in `packages/tui/src` (`@opencode-ai/tui`). `packages/opencode/src/cli/cmd/tui.ts` is
  only the process entry point.
- Pinned: `@opentui/core|solid|keymap` 0.4.5, `solid-js` 1.9.10 (patched), `opentui-spinner` 0.0.7,
  TypeScript 5.8.2, bun 1.3.14. `@opentui/solid` 0.4.5 declares an **exact** `solid-js: 1.9.12` peer,
  so the fork already runs a peer mismatch; our peer range must be loose.
- Packages are source-consumed via `exports` pointing at `./src/*.ts(x)`, `"type": "module"`,
  scripts `typecheck: tsgo --noEmit` and `test: bun test`, no per-package lint (root `oxlint`),
  prettier `semi: false, printWidth: 120`. Tests live in a mirrored `test/` folder, never colocated.
  `packages/tui/bunfig.toml` preloads `@opentui/solid/preload` for tests. Test files start with
  `/** @jsxImportSource @opentui/solid */` and always `renderer.destroy()` in `finally`.
- The template for an OpenTUI-consuming package is `packages/plugin/package.json`: optional
  `peerDependencies` `>=0.4.5` plus `catalog:` devDependencies.
- Custom renderable precedent: `packages/tui/src/component/bg-pulse.tsx` subclasses
  `FrameBufferRenderable`, coerces `width`/`height` to `1` in the constructor, exposes setters that call
  `requestRender()`, augments `OpenTUIComponents` in the same file, and calls `extend({...})` at module
  load. `register-spinner.ts` guards idempotency with `getComponentCatalogue().spinner`.
- Theme: `useTheme()` returns a reactive proxy whose values are `RGBA` instances (`theme.primary`,
  `theme.accent`, `theme.textMuted`, `theme.border`, `theme.diffAdded`, ...). Plugins get the same
  object as `api.theme.current`.
- Keys: everything goes through `@opentui/keymap` layers via `useBindings(() => ({ bindings, mode,
enabled, priority }))`; named actions live in `packages/tui/src/config/keybind.ts` and map to dotted
  command ids. A modal mode stack suppresses base-mode bindings. Only two `useKeyboard` escape hatches
  exist. Session tree keys already exist: `session_parent` (up), `session_child_first` (leader+down),
  `session_child_cycle` (right / left), `session_timeline` (leader+g).
- The fork has a TUI **plugin system** (`@opencode-ai/plugin/tui`): built-in feature plugins are listed
  in `packages/tui/src/feature-plugins/builtins.ts`; a slot plugin registers into named slots such as
  `sidebar_content` (receives `session_id`) or a full-screen route with its own keymap layer
  (`feature-plugins/system/diff-viewer.tsx`). This is the smallest-diff integration path.
- Data: sessions carry `parentID`; subagent `task` tool parts carry `state.metadata.sessionId`; the
  server exposes `/session/:id/children` but the TUI never calls it. Forked sessions do **not** record
  their origin. The fork's `packages/core/src/research/*` module is a true DAG (roles lead/workstream/
  task/specialist/reviewer, `parentID`, `reviewOf` cross edges, `after` dependency edges) with no TUI.

OpenTUI 0.4.5 (installed types; all confirmed):

- `Renderable` constructor is `(ctx: RenderContext, options: RenderableOptions)`. Solid's reconciler
  constructs custom elements with `new Cls(renderer, { id })` and applies every JSX prop afterwards via
  `node[name] = value` (the `default:` branch of `setProperty`); `focused` maps to `focus()/blur()`,
  `on:<event>` maps to `node.on(event, fn)`, `ref` is called before props are applied. JSX prop types are
  derived from the constructor's **second parameter type**, so that type must be precise and all-optional.
- Draw in `renderSelf(buffer, deltaTime)`. Unbuffered: absolute `this.screenX/screenY`. Buffered: the
  private frame buffer at `(0,0)`. `render()` writes the hit grid entry automatically.
- Intrinsic size: `this.getLayoutNode().setMeasureFunc((w, wMode, h, hMode) => ({ width, height }))`
  with `MeasureMode` from `@opentui/core/yoga`; the node must be a leaf. Data change: `yogaNode.markDirty()`
  then `requestRender()`. Appearance-only change: `requestRender()`. `Renderable.setMeasureFunc`,
  `needsUpdate`, `layoutNode` do not exist.
- Clipping is done by ancestors with `overflow !== "visible"` through scissor rects executed by the root;
  a child cannot query the ambient scissor rect. A child inside a ScrollBox sees **negative `screenY`**
  when scrolled (content is translated). Row culling must therefore be done by the renderable itself using
  `screenY`, `ctx.height` and the rects of clipping ancestors (`overflow` is a public getter). ScrollBox
  `viewportCulling` skips whole children that do not overlap the viewport; a single tall child is fine.
- `OptimizedBuffer.setCell` writes one code point; `drawText(text, x, y, fg, bg?, attrs?)` handles
  graphemes. Scissor stack: `pushScissorRect/popScissorRect/clearScissorRects` only.
- `RGBA.fromHex`, `RGBA.fromInts`, `parseColor(ColorInput)`; `rgbToHex()` is a free function.
  `TextAttributes` is a const object: BOLD 1, DIM 2, ITALIC 4, UNDERLINE 8, BLINK 16, INVERSE 32,
  HIDDEN 64, STRIKETHROUGH 128.
- Interaction: `focusable` is a property (not in base `RenderableOptions`); `handleKeyPress(key): boolean`
  runs after the `onKeyDown` setter handler and only when focused; global `renderer.keyInput` listeners run
  first and may `preventDefault()`. Mouse: `onMouseDown/Up/Move/Over/Out/Scroll` setters and the
  `onMouseEvent` override; `MouseEvent.x/y` are absolute terminal cells; no `click`, no `currentTarget`.
- Events: `Renderable` extends Node's `EventEmitter`.
- Cleanup: override `protected destroySelf()` and call `super.destroySelf()`.
- Testing: `createTestRenderer({ width, height })` from `@opentui/core/testing` returns `{ renderer,
mockInput, mockMouse, renderOnce, captureCharFrame, captureSpans, resize, ... }`; `captureSpans()` exposes
  per-span `fg/bg/attributes`. `testRender(() => <App/>, { width, height })` from `@opentui/solid` returns
  the same setup.
- Solid: `extend()` / `getComponentCatalogue()` from `@opentui/solid/components`; augmentation target is
  `declare module "@opentui/solid" { interface OpenTUIComponents { ... } }`.
- Missing in 0.4.5 (present in docs): renderer `render:error`, `MouseEvent.currentTarget`.

## 3. Architecture

Five layers; each imports only from the layers before it. Layers 1–3 import nothing from OpenTUI or Solid.

| #   | Layer   | Module        | Responsibility                                                   |
| --- | ------- | ------------- | ---------------------------------------------------------------- |
| 1   | model   | `src/model`   | Types, validation, deterministic topological order, children map |
| 2   | layout  | `src/layout`  | Lane assignment → orientation-neutral rows of lane cells         |
| 3   | raster  | `src/raster`  | Rows → styled `Cell`s, `renderToString`, `renderToAnsi`          |
| 4   | opentui | `src/opentui` | `DagRenderable extends Renderable`                               |
| 5   | solid   | `src/solid`   | `extend({ dag_view })`, typed `<DagView>` wrapper, helpers       |

Package entry points: `.` (layers 1–3), `./opentui`, `./solid`.

Package skeleton (mirrors the fork's conventions; standalone repo):

```
package.json        name tui-dag (see open question 3), type module, exports → ./src/*, files dist
                    peerDependencies: @opentui/core >=0.4.5, @opentui/solid >=0.4.5 (optional),
                                      solid-js >=1.9.0 (optional)
                    devDependencies: @opentui/core 0.4.5, @opentui/solid 0.4.5, solid-js 1.9.10,
                                      @types/bun, @tsconfig/bun, typescript 5.8.2, oxlint, prettier
                    scripts: test (bun test), typecheck (tsc --noEmit), lint (oxlint), format
tsconfig.json       extends @tsconfig/bun; jsx preserve; jsxImportSource @opentui/solid
bunfig.toml         preload @opentui/solid/preload (also under [test])
.oxlintrc.json      copy of the fork's rules
src/{model,layout,raster,opentui,solid}/  test/{model,layout,raster,opentui,solid}/  test/fixtures/
demo/core.ts  demo/solid.tsx
DESIGN.md  DECISIONS.md  README.md  CHANGELOG.md
```

No runtime dependencies. Dev dependencies are the peer packages themselves plus tooling.

## 4. Public API

### 4.1 Model (`tui-dag`)

```ts
export type ColorLike = string | { r: number; g: number; b: number; a?: number } // hex or 0–255 ints
export type MarkerKind = "node" | "root" | "merge" | "tip" | "current" | "stub" | { glyph: string }
export interface LabelSpan {
  text: string
  fg?: ColorLike
  bg?: ColorLike
  attrs?: number
}

export interface DagNode<T = unknown> {
  id: string
  /** [] means root. parents[0] is the first parent: the node continues that parent's lane when it can. */
  parents: readonly string[]
  /** Epoch ms. Tie-break for ordering. */
  time?: number
  /** One line. Spans carry fg, bg and text attributes. */
  label?: string | readonly LabelSpan[]
  /** Branch or series key, mapped to a stable colour with colorStrategy "group". */
  group?: string
  marker?: MarkerKind
  /** Per-node colour override for the marker and label. */
  color?: ColorLike
  data?: T
}

/** Same bit layout as OpenTUI's TextAttributes; layer 4 asserts this at load. */
export const Attr = {
  NONE: 0,
  BOLD: 1,
  DIM: 2,
  ITALIC: 4,
  UNDERLINE: 8,
  BLINK: 16,
  INVERSE: 32,
  HIDDEN: 64,
  STRIKETHROUGH: 128,
} as const

export type ValidationIssue =
  | { code: "empty-id"; index: number }
  | { code: "duplicate-id"; id: string; index: number }
  | { code: "unknown-parent"; id: string; parent: string }
  | { code: "cycle"; path: string[] } // path[0] === path.at(-1)

export interface ValidateOptions {
  unknownParent?: "error" | "root" | "stub"
} // default "error"

export type ValidationResult<T> =
  | { ok: true; graph: DagGraph<T>; issues: ValidationIssue[] } // issues = non-fatal (unknown parents handled)
  | { ok: false; issues: ValidationIssue[] }

export interface DagGraph<T> {
  nodes: readonly DagNode<T>[] // input order, duplicates removed (first wins)
  byId: ReadonlyMap<string, DagNode<T>>
  children: ReadonlyMap<string, readonly string[]> // in topological order of the children
  order: readonly string[] // topological order, parents first
  stubs: ReadonlySet<string> // synthetic roots created for unknownParent: "stub"
}

export function validate<T>(nodes: readonly DagNode<T>[], opts?: ValidateOptions): ValidationResult<T>
```

Validation never throws. Ordering is Kahn's algorithm with a min-heap on `(time ?? +∞, inputIndex)`:
timed nodes by time, untimed nodes after them by input order, all deterministic. Cycle detection reports
one cycle path found by DFS over the leftover nodes. `unknownParent: "root"` drops the missing parent from
`parents` (and if that leaves none, the node is a root); `"stub"` inserts a synthetic root node with
`marker: "stub"` right before its child so the edge is drawn as a short dangling line.

### 4.2 Layout

```ts
export interface LayoutOptions {
  direction?: "down" | "up" // oldest at top (default) or at bottom
  forkStyle?: "row" | "inline" // connector row after the parent (default) or ├─╮ drawn on the parent's row
  rowGap?: "auto" | "none" | "always" // spacer rows (│) between nodes; see §5.5
  trunk?: readonly string[] // ids whose first-parent chains claim lanes first (e.g. the main session tip)
  staggerRoots?: boolean // default: true only for rowGap "none"; see §5.3 step 4
  laneAllocation?: "leftmost" | "nearest" | "nested" // see §5.9
}
// maxLanes is designed (§5.8) but not part of the implemented options.

/** Arms of a cell in time/lane terms so the same rows serve a horizontal mode later. */
export const Arm = { PREV: 1, NEXT: 2, LO: 4, HI: 8 } as const // toward earlier step, later step, lower lane, higher lane

export interface LaneCell {
  arms: number // bitmask of Arm
  branchId: string
  role: "node" | "pass" | "cross" | "horizontal" | "fork-source" | "fork-target" | "merge-source"
  edge?: { parent: string; child: string } // the edge this cell carries; absent on node cells
}
export interface Link {
  branchId: string
  edge: EdgeRef
} // horizontal segment between lane i and i + 1
export type DagRow =
  | { kind: "node"; index; nodeId; lane; branchId; cells: (LaneCell | null)[]; links: (Link | null)[] }
  | { kind: "fork"; index; sourceId; cells; links }
  | { kind: "gap"; index; cells; links }

export interface Branch {
  id
  ordinal
  lane
  startRow
  endRow
  headId
  colorSlot
  group?
}
export interface EdgeRoute {
  parent
  child
  lane
  forkRow: number | null
  mergeRow: number | null
}

export interface DagLayout<T> {
  // plain data; query with the free functions below
  graph: DagGraph<T>
  options: ResolvedLayoutOptions
  rows: readonly DagRow[] // already in display order for `direction`
  laneCount: number
  branches: readonly Branch[]
  edges: readonly EdgeRoute[] // one per (parent, child) edge; the connectivity test oracle
  rowIndex: ReadonlyMap<string, number>
  continuation: ReadonlyMap<string, string> // parent → child that continues its lane
}
export function rowOf(layout, id): number | undefined
export function nodeAt(layout, row): DagNode<T> | undefined
export function laneOf(layout, id): number | undefined

export function layoutDag<T>(graph: DagGraph<T>, opts?: LayoutOptions): DagLayout<T>
export function layoutNodes<T>(nodes: readonly DagNode<T>[], opts?: LayoutOptions & ValidateOptions): DagLayout<T> // throws DagValidationError
```

### 4.3 Raster

```ts
export type GlyphSetName = "rounded" | "square" | "heavy" | "ascii"
export interface GlyphSet {
  v: string; h: string; dr: string; dl: string; ur: string; ul: string     // │ ─ ╭ ╮ ╰ ╯
  vr: string; vl: string; hd: string; hu: string; cross: string           // ├ ┤ ┬ ┴ ┼
  node: string; root: string; merge: string; tip: string; current: string; stub: string; ellipsis: string
}
export function validateGlyphSet(set: GlyphSet, measure?: (s: string) => number): ValidationIssue[]

export interface RasterOptions {
  glyphs?: GlyphSetName | GlyphSet          // default "rounded"
  palette?: readonly ColorLike[]            // default: 8 built-in colours
  colorStrategy?: "lane" | "group" | "branch"   // default "branch"
  groupColors?: Record<string, ColorLike>   // explicit group colours, consulted before the hash
  selectedId?: string
  highlight?: "none" | "ancestors" | "descendants" | "both"   // default "ancestors"
  dimStyle?: { fg?: ColorLike; attrs?: number }                // default { attrs: Attr.DIM }
  selectedStyle?: { fg?: ColorLike; bg?: ColorLike; attrs?: number } // default { attrs: Attr.INVERSE } on the label
  labels?: boolean                          // false for gutter-only output
  labelGap?: number                         // spaces between gutter and label, default 2
  labelAlign?: "flow" | "column"            // after this row's rightmost lane (default) or one global column
  labelColor?: "default" | "branch"         // terminal default (default) or the node's colour
  maxLabelWidth?: number                    // truncate with ellipsis by display width
  maxWidth?: number                         // truncate labels so no row exceeds this width
  autoMarkers?: boolean                     // derive root/merge/tip kinds when node.marker is undefined
  measureText?: (s: string) => number       // default Bun.stringWidth when available, else grapheme count
}

export interface Cell { char: string; fg?: ColorLike; bg?: ColorLike; attrs?: number; nodeId?: string; branchId?: string }
export interface Raster {
  width: number; height: number; gutterWidth: number
  row(i: number): readonly Cell[]           // lazily rasterised and memoised per row
  rowNodeIds: readonly (string | undefined)[]
  withSelection({ selectedId?, highlight? }): Raster   // shares the measured label widths
}
export function createRaster<T>(layout: DagLayout<T>, opts?: RasterOptions): Raster
export function rasterize<T>(layout: DagLayout<T>, opts?: RasterOptions): Cell[][]
export function renderToString<T>(layout: DagLayout<T>, opts?: RasterOptions): string   // no colour
export function renderToAnsi<T>(layout: DagLayout<T>, opts?: RasterOptions): string     // 24-bit SGR
export function renderDag<T>(nodes: readonly DagNode<T>[], opts?: LayoutOptions & RasterOptions): string
```

Colours stay plain data (`ColorLike`) in this layer. Conversion to `RGBA` happens in layer 4.

### 4.4 OpenTUI (`opentui-dag/opentui`) — implemented

```ts
export interface DagKeys { up; down; parent; child; first; last; activate }   // string[] key specs, e.g. "ctrl+n"
export const defaultDagKeys: DagKeys   // up/k, down/j, left/h, right/l, home, end, return

export interface DagViewOptions<T = unknown>
  extends RenderableOptions<DagRenderable<T>>, LayoutOptions, Omit<RasterOptions, "labels" | "maxWidth" | "selectedId"> {
  nodes?: readonly DagNode<T>[]
  unknownParent?: "error" | "root" | "stub"
  selectedId?: string
  gutterOnly?: boolean
  focusable?: boolean                      // default true
  focused?: boolean                        // focus after construction; Solid applies it reactively
  keys?: Partial<DagKeys> | false          // false: no built-in key handling
  followSelection?: boolean                // scroll the nearest ScrollBox to a keyboard-selected row (default true)
  fg?: ColorLike                           // default label colour (default: terminal foreground)
  onNodeSelect?, onNodeActivate?: (node, { row, lane }) => void
  onNodeHover?: (node | null) => void
  onLayout?: (layout | undefined, issues) => void
}

export class DagRenderable<T = unknown> extends Renderable {
  constructor(ctx: RenderContext, options: DagViewOptions<T>)   // works with { id } only
  // every option is also a settable property
  readonly layout: DagLayout<T> | undefined; readonly issues: ValidationIssue[]; readonly hoveredId: string | null
  rowOf(id): number | undefined; nodeAt(row): DagNode<T> | undefined
  select(id | undefined, { emit? }); moveSelection(delta); selectParent(); selectChild(); selectFirst(); selectLast(); activate()
  scrollIntoView(id = selectedId); visibleRowRange(): [first, end)
  // events: "select" (node, info), "activate" (node, info), "hover" (node | null), "layout" (layout, issues)
}
```

Colours accept hex strings, `{ r, g, b, a? }` objects (0–255) or OpenTUI `RGBA` instances (detected by
`instanceof` in this layer and by duck typing in `parseColorLike`), so theme values pass straight through.
The callback props are not called `onSelect`/`onChange` because the Solid reconciler reserves those names.

### 4.5 Solid (`opentui-dag/solid`) — implemented

```ts
declare module "@opentui/solid" {
  interface OpenTUIComponents {
    dag_view: typeof DagRenderable
  }
}
export function registerDagView(): void // idempotent; runs on import
export type DagViewProps<T> = DagViewOptions<T> & { ref?: (r: DagRenderable<T>) => void }
export function DagView<T>(props: DagViewProps<T>): JSX.Element // <dag_view {...props} />
export function createDagLayout<T>(
  nodes: Accessor<readonly DagNode<T>[]>,
  options?: Accessor<LayoutOptions & ValidateOptions>,
): Accessor<{ layout: DagLayout<T> | undefined; issues: readonly ValidationIssue[] }>
export { rowOf, laneOf, nodeAt, DagRenderable, defaultDagKeys }
```

`DagView` never recreates the renderable when `nodes` changes: Solid applies the new array through the
`nodes` setter, the renderable marks its layout dirty, recomputes it once in a microtask, calls
`yogaNode.markDirty()` and `requestRender()`.

`gutterOnly` consumers render their own rows beside the gutter:

```tsx
const state = createDagLayout(() => nodes())
<box flexDirection="row">
  <DagView nodes={nodes()} gutterOnly />
  <box>
    <For each={state().layout?.rows ?? []}>{(row) => <text height={1}>{row.kind === "node" ? titleOf(row.nodeId) : ""}</text>}</For>
  </box>
</box>
```

## 5. Layout algorithm

### 5.1 Requirements recap

Lane stability (a branch never changes column; first-parent chains are straight), leftmost free lane
reuse, deterministic, ~O(n × lanes), N-way forks, octopus merges, criss-cross merges, long skip edges,
crossings, multiple roots and tips, `direction` up/down, orientation-neutral output.

### 5.2 Prior art considered

- **git `graph.c`** walks newest → oldest. Each column carries "an edge toward a commit expected later"
  (a parent). A commit takes the column of the first edge expecting it; its first parent inherits that
  column; other parents get new columns to the right; columns _collapse leftwards_ when a branch ends,
  which git draws with extra `|/` rows. Consequences: extra pre-commit/collapse rows, and **columns are
  not stable** — a branch drifts left as branches to its left end. Good ideas to keep: one column per
  in-flight edge, first parent inherits the column, colours assigned per column episode.
- **"Straight branches" family** (Vigier, gitamine; also GitKraken/Fork/VS Code Git Graph): assign each
  commit to a _branch_; a commit inherits the branch of the child that lists it as first parent
  (walking newest first), otherwise starts a new branch; branches take the leftmost free column at
  creation and never move; a branch's column is released when its last commit is drawn. This is lane
  stability by construction. Merges draw a curve from the merge commit to the second parent's column.
- **Sapling `renderdag` / Mercurial `graphmod`**: row-oriented output model (node line, link line,
  termination line), pending-edge columns with explicit "reserve column" for a future node. Confirms the
  data model: rows as arrays of per-column glyph roles, edges routed per column.
- **lazygit graph**: rows of _pipes_ `{ fromPos, toPos, kind: starts|terminates|continues, color }`,
  coloured per branch. Confirms that a per-row "what passes through each lane" record is enough for a
  terminal renderer.

Verified against the sources on 2026-09-19 (git `graph.c` master, ~2000 lines, behaviour re-checked with
git 2.34.1 on a synthetic repo; Vigier's post and gitamine; Mercurial `graphmod.py`; Sapling
`eden/scm/lib/renderdag`; vscode-git-graph `web/graph.ts`; lazygit `graph.go`/`cell.go`). Two details
from that reading shaped the design below: renderdag's "first parent takes the node's own column, other
parents take the leftmost empty column anywhere", and Vigier's insight that columns must be _nil'ed, never
removed_ to stay straight. lazygit is the precedent for drawing forks and merges on the node's own row
with a 4-arm cell model (`up/down/left/right` → box glyph), which is what §5.7 and §6 do.

### 5.3 Chosen algorithm: two sweeps, lanes hold in-flight edges

Time flows from parents to children, so the sweep goes **oldest → newest** (the `direction: "up"`
variant only reverses the finished rows). Because children are unknown when the parent is placed in a
forward sweep, the "which child continues my lane" decision is precomputed by a **reverse sweep**,
which reproduces git's first-parent semantics.

**Pass 1 — continuation.** Walk first-parent chains backwards from the tips, most important tip
first: `trunk` ids in the given order, then remaining tips newest-first (highest row). `walk(x)`: while
`x` has a first parent `p` and `cont[p]` is unset, set `cont[p] = x` and continue with `p`; stop as soon as
a chain that was already claimed is reached. After the tips, do the same for every non-first parent of
every node (newest node first), so merged-in branches get straight lanes too. Result: the first-parent
chain of the highest-priority tip owns its lanes end to end, exactly like git's `--first-parent` column,
and it yields the target picture: `G` is the only tip, so `cont[F]=G, cont[C]=F, cont[B]=C, cont[A]=B`;
`E` is reached from `F`'s second parent and claims `cont[D]=E`; `D` forks off `B`.

A simpler per-node rule ("the newest child naming `p` as first parent continues it") was rejected: when a
side branch is created _after_ the trunk's next node, e.g. `X → Y → M[Y, S]` with `S[X]` newer than `Y`,
it hands `X`'s lane to `S` and bends the trunk. The chain walk keeps the trunk straight because `M`'s
chain claims `Y → X` before `S` is considered. Consumers with a known main line (the current session)
pass it as `trunk`.

**Pass 2 — lane assignment (forward topological order).** State: `lanes: (Pending | null)[]`, where
`Pending = { edge: { parent, child }, branchId }` is an in-flight edge occupying the lane from the row
after its parent (or after the fork row) to the row of its child.

For each node `v` in order:

1. **Land.** Collect lanes whose pending edge has `child === v`. If `v` is a root, allocate the leftmost
   free lane and open a new branch. Otherwise `v` lands in the lane of the edge from `parents[0]` (always
   present, because every edge got a lane when its parent was placed). `v`'s branch is that lane's branch.
2. **Merge.** Every other lane targeting `v` ends here: record a horizontal segment from that lane to
   `v`'s lane on `v`'s row (`Arm.PREV | Arm.LO/HI` at the source, `Arm.LO | Arm.HI` in between,
   `Arm.PREV | Arm.NEXT | Arm.LO | Arm.HI` on lanes that merely pass through = a crossing). Free those
   lanes after the row.
3. **Continue.** If `cont[v]` exists, replace `v`'s lane content with the pending edge `v → cont[v]`
   (same branch, straight down). Otherwise, if `v` has children at all, the earliest child by row keeps
   `v`'s lane with edge `v → child` (same branch id — it is `v`'s lineage flowing into a merge). If `v` has
   no children, the lane becomes free after the row (tip).
4. **Fork.** Each remaining child `c` gets the leftmost free lane, a **new branch** (new colour), and a
   pending edge `v → c`. Lanes closed by a merge on this row become free only from the next row, so a
   `╯` and a `╮` never share a cell (with `forkStyle: "row"` the fork row _is_ the next row, so the lane
   is reused immediately). A root placed right after a tip row avoids the tip's lane so two unrelated
   nodes never look connected (renderdag's stagger rule). If any fork happened, emit a **fork row** right after `v`'s row: `v`'s lane gets
   `Arm.PREV | Arm.NEXT` plus `LO`/`HI` toward the forked lanes, each forked lane gets `Arm.NEXT` plus the
   arm toward `v`, lanes in between get `Arm.LO | Arm.HI` (or a crossing if they carry an edge).
   With `forkStyle: "inline"` the same arms are added to `v`'s own row instead (see §5.6).
5. **Emit** the node row: `v`'s lane has role `node`; every occupied lane has role `pass` with
   `Arm.PREV | Arm.NEXT`, merged with any horizontal arms from step 2.

A forked branch's `group` is the child's when the child will live in it (`child.parents[0] === parent`)
and the parent's when the branch only carries an edge into the child's own lane (a report or merge), so
`colorStrategy: "group"` draws a team's report in the team colour.

Branch colours are chosen at lane opening as the lowest palette index not used by any live lane
(falling back to `ordinal mod palette.length`), so neighbouring lanes rarely share a colour and a branch
keeps its colour for life — unlike git, which recolours every column at every merge.

Every row is built as an array of `laneCount` cells, so the whole thing is O(rows × lanes) after the
O((n + e) log n) ordering. Lane allocation is "leftmost `null`", which keeps width small and reuses
lanes as soon as a branch ends. All choices are total orders over ids/rows, hence deterministic.

Why one row per node suffices (plus optional fork rows): merges are drawn on the child's row (arms
coming from above), forks on the row after the parent (arms going below). The two never share a row, so
no cell needs both a `╯` and a `╮`. The only remaining cell conflicts are colour conflicts on crossings,
resolved by rule (§5.7).

### 5.4 Worked example (the picture in §1)

Nodes (id[parents], time order gives A,B,D,C,E,F,G): `A[]`, `B[A]`, `D[B]` approach B, `C[B]` approach A,
`E[D]` tests pass, `F[C,E]` merge, `G[F]` final.

Pass 1: tips = `{G}` → `walk(G)`: `cont[F]=G`, `cont[C]=F`, `cont[B]=C`, `cont[A]=B`. Non-first
parents, newest node first: `F`'s second parent `E` → `walk(E)`: `cont[D]=E`, then `B` is already claimed.
`D` therefore forks off `B`.

Pass 2:

| row | node | lanes before | actions                                                         | cells (lane0, lane1)   |
| --- | ---- | ------------ | --------------------------------------------------------------- | ---------------------- |
| 0   | A    | `[]`         | root → lane 0, branch b0; cont → pending A→B in lane 0          | `●`                    |
| 1   | B    | `[A→B]`      | land 0; cont → B→C in lane 0; D forks → lane 1, branch b1, B→D  | `●`                    |
| 2   | fork |              | fork row for B                                                  | `├` `╮`                |
| 3   | D    | `[B→C, B→D]` | land 1; cont → D→E in lane 1                                    | `│` `●`                |
| 4   | C    | `[B→C, D→E]` | land 0; cont → C→F in lane 0                                    | `●` `│`                |
| 5   | E    | `[C→F, D→E]` | land 1; no cont; only child F keeps lane 1 with E→F             | `│` `●`                |
| 6   | F    | `[C→F, E→F]` | land 0 (first parent C); lane 1 merges in; cont → F→G in lane 0 | `●` `╯` (+ `─` spacer) |
| 7   | G    | `[F→G]`      | land 0; tip → lane 0 free                                       | `●`                    |

With `rowGap: "auto"` a `│` gap row is inserted between rows 0–1 and 6–7 (same lane, adjacent). The
raster places lane _i_ at column `2i`, fills the odd spacer column with `─` where a horizontal passes,
and puts the label two cells after the row's rightmost used lane, which reproduces §1 exactly.

Expected shapes for the harder fixtures (inline fork style, from a throwaway prototype of the algorithm):

```
octopus M[B,C,D]   criss-cross D[B,C] E[C,B]   two roots, root after tip   long edge F[E,A]   merge+fork X[R,Q]→Y,Z
●─┬─╮  A           ●─╮  A                      ●  R                        ●─╮  A             ●─╮  P
● │ │  B           │ ●─╮  B                    │ ●  S                      ● │  B             │ ●  Q
│ ● │  C           ●─┼─┼─╮  C                  ● │  X                      ● │  C             ● │  R
│ │ ●  D           │ ●─┼─╯  D                  │ ●  Y                      ● │  D             ●─┴─╮  X
●─┴─╯  M           ●─┼─╯  E                    ●─╯  M                      ● │  E             ●   │  Y
●  N               │ ●  F                        ●  Z  (staggered)         ●─╯  F             │   ●  Z
                   ●  G                          ●  W                                         ●───╯  W
```

The octopus and criss-cross rows show why arms are unioned: lane 1 on `M`'s row has its own edge ending
(`PREV`) plus the bus from lane 2 passing (`LO | HI`), which is `┴`; the criss-cross needs `┼` crossings,
which no lane-stable, one-row-per-node layout can avoid.

### 5.5 Gap rows

`rowGap: "auto"` (default) inserts a `│`-only row between two consecutive node rows when the second
node is the first one's _continuation_ (`cont[first] === second`; a merge edge into the next row is
already visible as `╯` and gets no gap), so every edge has at least one visible connector cell
(this is what the target picture does between `initial prompt`/`refine plan` and `merge`/`final answer`,
but not inside the two-lane section). `"always"` inserts a gap after every node row that is not followed
by a fork row; `"none"` never does, which together with `forkStyle: "inline"` gives exactly one row per
node — needed when a consumer aligns rich rows 1:1 with nodes.

### 5.6 Inline forks

`forkStyle: "inline"` adds the fork arms to the parent's own row: `●─┬─╮`. Merges into that same row
are unioned into the same cells. A lane that ends by merging and immediately restarts as a fork target
renders as `┤`/`├`, which is visually ambiguous with a pass-through; this is a documented limitation of
the compact style, not of the default.

### 5.7 Cell conflicts and colour precedence

Arms are unioned, so the glyph is never ambiguous. Colour (branch id) of a cell is chosen by this
precedence: node > merge-source/fork-target (the lane that starts or ends here) > pass-through vertical >
horizontal segment. On a crossing (`┼`) the vertical lane keeps its colour so branch lines stay
continuous; on a shared spacer cell between two horizontals, the merge (incoming) colour wins.

### 5.8 Designed, not implemented in Phase 1

- **`maxLanes`**: when the leftmost free lane index would be ≥ `maxLanes`, the edge is routed through the
  shared last lane and its cells carry role `"overflow"`, drawn with the `ellipsis` glyph. Implement only
  if a consumer needs it.
- **Incremental append** (`createLayoutBuilder(opts).append(node)`): keeps every tip's lane reserved as
  an open edge, so a later child can land in O(lanes) without touching earlier rows. Trade-off: pass 1
  cannot run, so the _first-arriving_ child continues the lane instead of the highest-priority one; fine
  for live streams where arrival order is time order. Earlier rows are never rewritten. Appending a node
  whose parent is no longer an open tip needs a fork on that parent's row, so the builder recomputes from
  that row on (the sweep is causal: rows before it stay valid).
- **Horizontal mode**: rows become columns; the raster maps `Arm.PREV/NEXT` to left/right and `LO/HI` to
  up/down, with a different glyph mapping (`╭ ╮ ╰ ╯` rotate). Layout output needs no change.

### 5.9 Lane policies and the three-step structure

The sweep no longer chooses lane numbers. It produces _branches_ (id, head node, start row, end row, the
branch it forked from, whether it ended at a tip) and lane-independent row specs (node/fork/gap, the branches
merging or forking on the row, and the edges alive on the row). A lane policy then assigns one lane per
branch using per-lane interval occupancy, so a lane is only taken when it is free for the branch's whole
lifetime, which is exactly what the earlier greedy sweep produced for `leftmost` and `nearest` (the 80
snapshots did not change). Row building maps branches to lanes and draws the buses.

- `leftmost`: branches in start order, lowest free lane.
- `nearest`: branches in start order, lowest free lane right of the parent branch's lane (never left).
- `nested`: depth first over the branch tree, siblings in start order. A branch takes the lowest free lane
  right of its parent; its sub-branches are placed before its later siblings; a sibling whose subtree
  overlaps an earlier sibling's subtree in time starts right of that block. Roots are siblings of a virtual
  parent at lane −1. Result: a team is a block (team lane, then its agents), the next team starts right of the
  block, and the lead's forks cross earlier blocks with one bus each. A branch that ends and restarts (the
  `rejoin` check-in model) moves right of everything alive, so hierarchical data should keep one branch per
  actor and express check-ins as side edges.

Colour slots are assigned the same way in start order (lowest slot free over the lifetime).

## 6. Raster

Geometry: lane _i_ occupies column `2i`; odd columns are spacers (`─` when a horizontal arm crosses
them, else space). `gutterWidth = 2 × laneCount − 1`. Labels start at `rightmostUsedColumn + 1 + labelGap`
(`labelAlign: "flow"`) or at `gutterWidth + labelGap` (`"column"`).

Glyph selection is a table lookup on the arms bitmask after mapping arms to the screen orientation
(`direction: "down"`: PREV→up, NEXT→down, LO→left, HI→right; `"up"` swaps PREV/NEXT). Node cells use the
marker glyph. Glyph sets:

| set     | │ ─ ╭ ╮ ╰ ╯ ├ ┤ ┬ ┴ ┼      | node root merge tip current stub |
| ------- | -------------------------- | -------------------------------- |
| rounded | `│ ─ ╭ ╮ ╰ ╯ ├ ┤ ┬ ┴ ┼`    | `● ◎ ◆ ○ ◉ ┆`                    |
| square  | `│ ─ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼`    | same                             |
| heavy   | `┃ ━ ┏ ┓ ┗ ┛ ┣ ┫ ┳ ┻ ╋`    | same                             |
| ascii   | `\| - / \ \ / \| \| - - +` | `* o * o @ :`                    |

`validateGlyphSet` checks every glyph is one cell wide with `measureText`. The README will note that
box-drawing characters and `●` are East Asian Ambiguous width, so `ascii` is the safe fallback.

Colours: `palette` cycled per branch (`"branch"`), per lane (`"lane"`), or by FNV-1a hash of `group`
(`"group"`, falling back to branch for ungrouped nodes). A node's `color` overrides its marker and label.
Highlight: with a `selectedId`, the set of highlighted nodes is computed once by BFS over
parents/children per `highlight`; cells of nodes or edges outside the set get `dimStyle`; the selected
row's label gets `selectedStyle`.

`renderToString` joins `row(i)` chars with trailing spaces trimmed. `renderToAnsi` emits 24-bit SGR
(`38;2;r;g;b`, `48;2;...`) plus attribute codes, resetting only when the style changes.

Text width: `measureText` defaults to `Bun.stringWidth` when running under Bun (verified: box glyphs
and `●` measure 1, `界` measures 2), else grapheme count via `Intl.Segmenter`. Labels are truncated to
`maxLabelWidth` by display width with the `ellipsis` glyph.

## 7. OpenTUI renderable

- **Construction**: `constructor(ctx, options = {})` copies options into private fields with defaults.
  Nothing is required or readonly. Each option is a getter/setter. `nodes`, `unknownParent` and layout
  options invalidate the layout (and raster), call `yogaNode.markDirty()` and `requestRender()`. Raster
  options and `selectedId` invalidate the raster and call `requestRender()`. `focusable` is applied via
  the inherited `focusable` setter (default true).
- **Measure**: `getLayoutNode().setMeasureFunc((w, wMode, h, hMode) => ...)`. Width = the raster's
  natural width (gutter, or gutter + gap + widest label), clamped to `w` under `AtMost`, exactly `w` under
  `Exactly`. Height = `rows.length`, honouring only `Exactly`: a ScrollBox measures children with `AtMost`
  = viewport height and clamping there made the graph unscrollable (verified by probing; OpenTUI's text
  renderable behaves the same). The natural raster is memoised; a second, width-fitted raster (labels
  truncated with an ellipsis to the computed width) is memoised per width.
- **Draw** (`renderSelf(buffer)`): origin `(ox, oy)` = `(0, 0)` when `buffered` else
  `(screenX, screenY)`. Visible row range = `[0, rows)` ∩ terminal rows (`-screenY .. ctx.height - screenY`)
  ∩ the rect of every ancestor whose `overflow !== "visible"` (walk `parent`; both are public). Only
  those rows are rasterised (lazily, memoised) and drawn: gutter cells with `setCell` (one code point,
  width validated), labels with `drawText` (graphemes). Cost is O(visible rows × width). Nothing in
  `renderSelf` mutates state or requests a render.
- **Colours**: `ColorLike → RGBA` through `parseColor`/`RGBA.fromInts`, memoised in a `Map` keyed by
  the hex string or `r,g,b,a`. Palette conversion happens once per palette change. Layer 4 asserts at
  module load that `Attr` matches `TextAttributes`.
- **Interaction** (built-in systems only): `_focusable` true; `handleKeyPress(key)` matches `key.name`
  plus modifiers against `keys` (overridable; `keys: false` disables and returns false so the event
  bubbles). Keyboard selection calls `scrollIntoView` when `followSelection` is on. Mouse via the `onMouseEvent` override: left `down` → select the row under `event.y - screenY`;
  a second `down` on the same row within 400 ms → activate; `move` → hover (emitted only on change);
  `out` → hover null. The hit grid entry is the renderable's rectangle, written by `render()` itself.
- **Events**: `emit("select" | "activate" | "hover" | "layout")`, plus `onNodeSelect/onNodeActivate/onNodeHover/
onLayout` setter props for JSX. `scrollIntoView(id)` walks `parent` to the nearest `ScrollBoxRenderable`
  and adjusts `scrollTop` so the row is inside `viewport` (same maths as the fork's diff viewer).
- **Cleanup**: `destroySelf()` clears caches and listeners, then `super.destroySelf()`.

## 8. Data flow

```
DagNode[] ──validate──▶ DagGraph {order, children} ──layoutDag──▶ DagLayout {rows[lane cells], branches, edges}
   ──createRaster──▶ Raster {row(i): Cell[]} ──renderToString/Ansi──▶ string
                                                └─DagRenderable.renderSelf──▶ OptimizedBuffer (visible rows only)
```

Caches in the renderable: layout (keyed by nodes + layout options), raster (keyed by layout + raster
options + selection), RGBA per ColorLike, measured label widths per label.

## 9. Test plan

Fixtures (`test/fixtures`): linear chain; single fork; fork + merge (§1 picture); two roots; three-way
fork; octopus merge (3 parents); criss-cross merge; long skip edge crossing other lanes; lane reuse after
a branch ends; side branch newer than the trunk (`trunk` option); unknown parent (each mode); cycle;
seeded random DAGs (`test/fixtures/random.ts`, mulberry32) including the 10k-node performance graph.

Status: 100 tests across 10 files, 83 snapshots (10 fixtures × 4 glyph sets × 2 fork styles), all passing.
Renderable tests use `createTestRenderer` (frames equal `renderToString`, span colours, keyboard and mouse
through the mock inputs, culling inside a ScrollBox, width truncation, invalid input, destroy). Solid tests
use `testRender` (intrinsic element, signal updates without remount, events, gutter-only rows). The demo's
`App` is smoke-tested headlessly through every key it handles, and the investigation generator is checked
for validity and lane-0 lead placement over 40 seeds in both check-in modes.

- **model**: validation results per fixture; order determinism; cycle path shape; unknown-parent modes.
- **layout**: per fixture, assert lanes/rows/edges; properties over seeded random DAGs (200 graphs):
  determinism (same input → deep-equal output); every `EdgeRoute` is a connected path of cells from
  parent row to child row (vertical cells have PREV|NEXT, fork/merge rows have the horizontal arms); no
  lane holds two edges at once; first-parent chains via `cont` stay in one lane; lane count ≤ max
  concurrent edges + 1.
- **raster**: snapshot of `renderToString` for every fixture × glyph set (bun `toMatchSnapshot`);
  ANSI spot checks (fork connector coloured like the child branch, merge like the incoming branch,
  dimming outside the highlight set, per-node override wins); glyph-set validation rejects wide glyphs.
- **performance**: 10k-node random DAG layout + full string render, asserted < 1000 ms, measured value
  printed and recorded in `DESIGN.md`.
- **opentui** (Phase 2): `createTestRenderer`; `captureCharFrame()` equals `renderToString` for each
  fixture; `captureSpans()` checks fg of specific cells; arrow keys and `j/k` move selection and emit
  `select`; `mockMouse.click` selects the row; `keys: false` lets keys bubble; inside a 5-row scrollbox
  with 2000 rows only the visible rows are rasterised (spy on `row()`); destroy leaves no listeners.
- **solid** (Phase 3): `testRender` mounts `<DagView nodes={...}/>`; changing `nodes`, `selectedId`,
  `palette` signals updates the frame without a new renderable (`ref` identity); `onNodeSelect` fires on key
  and mouse; `renderer.destroy()` disposes cleanly.

## 10. Performance

Layout O((n + e) log n + rows × lanes). Raster lazy per row. Draw cost proportional to visible rows.
Highlight BFS O(n + e) per selection change.

Measured (Phase 1, bun 1.4.2, `test/raster/perf.test.ts`, random 10k-node DAG with 20 % merges →
13 759 rows, 27 lanes): layout 138 ms, full `renderToString` 137 ms, creating a raster with a selection
and rasterising 50 rows 8 ms. The test asserts both layout and full render stay under 1 000 ms.

## 11. Integration plan (Phase 4, proposed; not applied yet)

A built-in feature plugin `packages/tui/src/feature-plugins/sidebar/timeline.tsx` registered in
`builtins.ts` (two-line diff) renders `<DagView>` into the `sidebar_content` slot. Nodes come from the
plugin API only (`api.state.session.get/messages/status`, `api.state.part`), no network calls:

- walk `parentID` up to the root session; the root is the first node of lane 0;
- for every `task` tool part in a session (in message order) add a _spawn_ node in that session's lane
  (time = `state.time.start`) and a _session_ node for `state.metadata.sessionId` that forks off it;
  recurse into the child's own task parts;
- when the part is completed or errored, add a _done_ node in the parent lane whose parents are the previous
  parent node and the child's last node (time = `state.time.end`): the branch merges back. Running
  subagents stay open tips.

Colours from `api.theme.current`: palette `[primary, accent, success, warning, info, secondary, error]`,
labels `text`, dim `textMuted`; busy sessions get the `current` marker. The current route's session is the
selection with `highlight: "ancestors"`; clicking a node navigates to its session. `keys={false}`: keyboard
navigation stays with OpenCode's existing `session_parent` / `session_child_*` commands. Dependency:
`opentui-dag` as a git dependency of `packages/tui` (or a packed tarball while iterating); `bun pm pack`
ships only `src`, so the fork keeps its single copies of `@opentui/*` and `solid-js`.

## 12. Open questions

1. **First use case.** Candidates: (A) session + subagent tree (task-tool `parentID`, data already in
   the TUI store, tree-shaped); (B) the research module DAG (roles, dependency and review edges — a real
   DAG, no TUI yet, data via new client calls); (C) message-level timeline with forks (needs a small core
   change to record `forkedFrom`). Recommendation: build for (A) as the vehicle, with (B) as the second
   consumer that exercises merges.
2. **Horizontal mode.** Your message asks for horizontal _and_ vertical; the spec defers horizontal.
   The layout is orientation-neutral by design; proposal: add the horizontal raster/renderable after
   Phase 3, before polish. Confirm.
3. **Package name and how the fork consumes it**: `tui-dag` vs `opentui-dag` (opentui-spinner style);
   npm publish + catalog pin (cleanest for rebases) vs `file:`/git dependency.
4. **Defaults read from the picture**: gap rows only between adjacent same-lane nodes (`rowGap: "auto"`),
   labels flowing after the row's rightmost lane (`labelAlign: "flow"`), fork connector rows
   (`forkStyle: "row"`). Are these the intended defaults, or should the sidebar use the compact 1:1 style?
5. **Dev dependencies**: the peer packages (`@opentui/core` 0.4.5, `@opentui/solid` 0.4.5,
   `solid-js` 1.9.10) plus TypeScript/oxlint/prettier need to be installed as devDependencies to test
   this repo standalone. No runtime dependencies. Assumed OK.
6. **Default key bindings** for the library (arrows + j/k, left/right for parent/child, home/end, enter);
   OpenCode will override via keymap anyway.
