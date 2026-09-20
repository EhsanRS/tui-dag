# opentui-dag

Lane-graph rendering for terminals: a directed acyclic graph drawn as a branching timeline, one row per
node, each branch in its own coloured column, connectors that fork and merge. `git log --graph`, but for
any data, with an OpenTUI renderable and Solid bindings on top.

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

Status: core, OpenTUI renderable and Solid bindings are implemented and tested; horizontal mode and the
OpenCode integration are next. Run the demo with `bun demo/index.tsx`. It includes a seeded "lead
investigator with 2–6 parallel teams and their agents" generator (`demo/investigation.ts`) with two
check-in models; press `r` to reseed. That fixture uses `laneAllocation: "nested"`, which draws each team as a
block next to the lead line with its agents beside it, in a faded shade of the team colour with hollow markers.

## Install

```sh
bun add opentui-dag
```

The core entry point has no dependencies. `opentui-dag/opentui` needs `@opentui/core` ≥ 0.4.5 and
`opentui-dag/solid` additionally `@opentui/solid` ≥ 0.4.5 and `solid-js`; they are peer dependencies so
your app keeps a single copy of each.

## Quick start (core)

```ts
import { renderDag } from "opentui-dag"

console.log(
  renderDag([
    { id: "A", parents: [], label: "initial prompt" },
    { id: "B", parents: ["A"], label: "refine plan" },
    { id: "D", parents: ["B"], label: "approach B" },
    { id: "C", parents: ["B"], label: "approach A" },
    { id: "E", parents: ["D"], label: "B: tests pass" },
    { id: "F", parents: ["C", "E"], label: "merge B into A" },
    { id: "G", parents: ["F"], label: "final answer" },
  ]),
)
```

Nodes list their parents; `parents[0]` is the first parent and the node continues that parent's lane
whenever it can. Nodes are ordered topologically, ties broken by `time` and then input order.

For more control, run the three layers yourself:

```ts
import { validate, layoutDag, createRaster, renderToAnsi } from "opentui-dag"

const result = validate(nodes, { unknownParent: "stub" }) // never throws
if (!result.ok) throw new Error(result.issues.map(String).join(", "))

const layout = layoutDag(result.graph, { direction: "down", forkStyle: "row", rowGap: "auto" })
process.stdout.write(renderToAnsi(layout, { selectedId: "C", highlight: "ancestors" }))

const raster = createRaster(layout, { labels: false }) // lazy, per-row, memoised
raster.row(3) // Cell[] for one row
```

## Quick start (Solid)

```tsx
/** @jsxImportSource @opentui/solid */
import { DagView } from "opentui-dag/solid"
;<scrollbox flexGrow={1}>
  <DagView
    nodes={nodes()}
    selectedId={selected()}
    palette={[theme.primary, theme.accent, theme.success, theme.warning]}
    focused
    onNodeSelect={(node) => setSelected(node.id)}
    onNodeActivate={(node) => open(node)}
  />
</scrollbox>
```

Importing `opentui-dag/solid` registers the `<dag_view>` intrinsic element (typed through
`OpenTUIComponents`), so `<dag_view nodes={nodes()} />` works too. `DagView` is a thin typed wrapper; when
`nodes` changes, the existing renderable is updated through its setter, nothing is recreated.

The renderable is focusable and handles arrows, `j`/`k` (rows), `h`/`l` and left/right (parent/child),
Home/End and Enter itself. Pass `keys={false}` to disable that and drive it from your own key handling via
`moveSelection`, `selectParent`, `selectChild`, `selectFirst`, `selectLast` and `activate`. Clicks select,
double clicks activate, and a keyboard selection scrolls the nearest `<scrollbox>` to keep the row visible.
Colours accept hex strings, `{ r, g, b }` objects or OpenTUI `RGBA` values, so theme colours can be passed
straight through. `gutterOnly` draws only the lanes; use `createDagLayout` and `rowOf` to render your own
rows beside them.

Imperative use: `new DagRenderable(renderer, { nodes })` from `opentui-dag/opentui`, then add it to a parent.
Events: `select`, `activate`, `hover`, `layout`.

## Options

Layout (`LayoutOptions`):

| option           | values                              | default      | effect                                                                                   |
| ---------------- | ----------------------------------- | ------------ | ---------------------------------------------------------------------------------------- |
| `direction`      | `"down"` `"up"`                     | `"down"`     | oldest at the top or at the bottom                                                       |
| `forkStyle`      | `"row"` `"inline"`                  | `"row"`      | `├─╮` on its own row after the parent, or on the parent's row                            |
| `rowGap`         | `"auto"` `"none"` `"always"`        | `"auto"`     | `│` rows between nodes; `"none"` + `"inline"` = one row per node                         |
| `trunk`          | node ids                            | `[]`         | first-parent chains that claim their lanes first                                         |
| `staggerRoots`   | boolean                             | see docs     | keep a root out of the lane an unrelated tip just freed                                  |
| `laneAllocation` | `"leftmost"` `"nearest"` `"nested"` | `"leftmost"` | narrowest graph; next to the parent; or a block per branch tree (teams and their agents) |

Raster (`RasterOptions`):

| option          | values                                                     | default                             |
| --------------- | ---------------------------------------------------------- | ----------------------------------- | ------------------------------------------ |
| `glyphs`        | `"rounded"` `"square"` `"heavy"` `"ascii"` or a `GlyphSet` | `"rounded"`                         |
| `palette`       | `ColorLike[]`                                              | 8 built-in colours                  |
| `colorStrategy` | `"branch"` `"lane"` `"group"`                              | `"branch"`                          |
| `groupColors`   | `Record<string, ColorLike>`                                | `{}`                                | explicit colours per group, before hashing |
| `selectedId`    | node id                                                    | –                                   |
| `highlight`     | `"none"` `"ancestors"` `"descendants"` `"both"`            | `"ancestors"`                       |
| `dimStyle`      | `{ fg?, bg?, attrs? }`                                     | `{ attrs: Attr.DIM }`               |
| `selectedStyle` | `{ fg?, bg?, attrs? }`                                     | `{ attrs: Attr.INVERSE }`           |
| `labels`        | boolean                                                    | `true`                              |
| `labelGap`      | number                                                     | `2`                                 |
| `labelAlign`    | `"flow"` `"column"`                                        | `"flow"`                            |
| `labelColor`    | `"default"` `"branch"`                                     | `"default"`                         |
| `maxLabelWidth` | number                                                     | –                                   |
| `maxWidth`      | number                                                     | –                                   |
| `autoMarkers`   | boolean                                                    | `false`                             |
| `measureText`   | `(text) => width`                                          | `Bun.stringWidth` or grapheme count |

Validation (`ValidateOptions`): `unknownParent: "error" | "root" | "stub"`.

Renderable / `DagView` extras: `nodes`, `selectedId`, `gutterOnly`, `focusable` (default true), `focused`,
`keys` (`Partial<DagKeys> | false`), `followSelection`, `fg` (default label colour), `onNodeSelect`,
`onNodeActivate`, `onNodeHover`, `onLayout`, plus every OpenTUI layout prop (`flexGrow`, `width`, ...).

## Glyphs and width

Box-drawing characters and `●` are East Asian Ambiguous width. Most terminals draw them one cell wide,
but a terminal configured for double-width ambiguous characters will misalign the graph; use
`glyphs: "ascii"` there. Custom glyph sets are checked with `validateGlyphSet`, which reports any glyph
that is not exactly one cell wide.

## Performance

Layout is O((n + e) log n) for ordering plus O(rows × lanes) for the sweep; rows are rasterised lazily
and memoised. Measured on a random 10k-node DAG (13.8k rows, 27 lanes): layout 140 ms, full string
render 181 ms.

## Documentation

`DESIGN.md` describes the architecture and the layout algorithm with a worked example; `DECISIONS.md`
logs every non-obvious choice.

## License

MIT
