import type { Branch, DagLayout, DagRow, LaneCell, Link, NodeRow } from "../layout/types"
import { Attr, type ColorLike, type DagNode, type LabelSpan, type MarkerKind } from "../model/types"
import { need } from "../model/validate"
import { defaultPalette, hashString } from "./color"
import { armGlyph, resolveGlyphSet, type GlyphSet, type GlyphSetName } from "./glyphs"
import { defaultMeasureText, graphemes, type MeasureText } from "./text"

export type ColorStrategy = "lane" | "group" | "branch"
export type Highlight = "none" | "ancestors" | "descendants" | "both"

export interface Style {
  fg?: ColorLike
  bg?: ColorLike
  /** Bitmask of {@link Attr}. */
  attrs?: number
}

export interface RasterOptions {
  /** Glyph set name or custom set. Default `"rounded"`. */
  glyphs?: GlyphSetName | GlyphSet
  /** Colours cycled per branch/lane/group. Default: eight built-in colours. */
  palette?: readonly ColorLike[]
  /** `"branch"` (default): one colour per lane episode. `"lane"`: per column. `"group"`: hash of `node.group`. */
  colorStrategy?: ColorStrategy
  /** Explicit colours per group, consulted before the hash with `colorStrategy: "group"`. */
  groupColors?: Readonly<Record<string, ColorLike>>
  selectedId?: string
  /** Which nodes stay bright when a node is selected; everything else gets `dimStyle`. Default `"ancestors"`. */
  highlight?: Highlight
  /** Applied to nodes and edges outside the highlighted set. Default `{ attrs: Attr.DIM }`. */
  dimStyle?: Style
  /** Applied to the selected node's label; its marker is drawn bold. Default `{ attrs: Attr.INVERSE }`. */
  selectedStyle?: Style
  /** Draw labels (default `true`). `false` yields a gutter-only grid. */
  labels?: boolean
  /** Cells between the gutter and the label. Default 2. */
  labelGap?: number
  /** `"flow"` (default): after this row's rightmost lane. `"column"`: one global column for all rows. */
  labelAlign?: "flow" | "column"
  /** `"default"` (default): labels use the terminal's default colour. `"branch"`: the node's colour. */
  labelColor?: "default" | "branch"
  /** Truncate labels to this display width with an ellipsis. */
  maxLabelWidth?: number
  /** Truncate labels so no row exceeds this total width. */
  maxWidth?: number
  /** Derive `root`/`merge`/`tip` markers for nodes without an explicit `marker`. Default `false`. */
  autoMarkers?: boolean
  /** Display-width function. Default: `Bun.stringWidth` under Bun, else grapheme count. */
  measureText?: MeasureText
}

export interface ResolvedRasterOptions {
  readonly glyphs: GlyphSet
  readonly palette: readonly ColorLike[]
  readonly colorStrategy: ColorStrategy
  readonly groupColors: Readonly<Record<string, ColorLike>>
  readonly selectedId: string | undefined
  readonly highlight: Highlight
  readonly dimStyle: Style
  readonly selectedStyle: Style
  readonly labels: boolean
  readonly labelGap: number
  readonly labelAlign: "flow" | "column"
  readonly labelColor: "default" | "branch"
  readonly maxLabelWidth: number | undefined
  readonly maxWidth: number | undefined
  readonly autoMarkers: boolean
  readonly measureText: MeasureText
}

/** One terminal cell. A wide grapheme is followed by a continuation cell with `char: ""`. */
export interface Cell {
  readonly char: string
  readonly fg?: ColorLike
  readonly bg?: ColorLike
  /** Bitmask of {@link Attr}. */
  readonly attrs?: number
  readonly nodeId?: string
  readonly branchId?: string
}

/** Rows are rasterised lazily and memoised, so drawing a viewport costs only the rows it shows. */
export interface Raster<T = unknown> {
  readonly layout: DagLayout<T>
  readonly options: ResolvedRasterOptions
  /** Width of the widest row. */
  readonly width: number
  readonly height: number
  /** `2 × laneCount − 1`: the gutter width for `labelAlign: "column"`. */
  readonly gutterWidth: number
  /** Node id per row; `undefined` on connector rows. */
  readonly rowNodeIds: readonly (string | undefined)[]
  row(index: number): readonly Cell[]
  /** Same layout and metrics with a different selection; label widths are not measured again. */
  withSelection(selection: { selectedId?: string; highlight?: Highlight }): Raster<T>
}

const BLANK: Cell = Object.freeze({ char: " " })

export function resolveRasterOptions(options: RasterOptions = {}): ResolvedRasterOptions {
  return {
    glyphs: resolveGlyphSet(options.glyphs),
    palette: options.palette ?? defaultPalette,
    colorStrategy: options.colorStrategy ?? "branch",
    groupColors: options.groupColors ?? {},
    selectedId: options.selectedId,
    highlight: options.highlight ?? "ancestors",
    dimStyle: options.dimStyle ?? { attrs: Attr.DIM },
    selectedStyle: options.selectedStyle ?? { attrs: Attr.INVERSE },
    labels: options.labels ?? true,
    labelGap: options.labelGap ?? 2,
    labelAlign: options.labelAlign ?? "flow",
    labelColor: options.labelColor ?? "default",
    maxLabelWidth: options.maxLabelWidth,
    maxWidth: options.maxWidth,
    autoMarkers: options.autoMarkers ?? false,
    measureText: options.measureText ?? defaultMeasureText,
  }
}

/** Selection-independent measurements, shared between rasters of the same layout. */
interface Shared {
  readonly branches: ReadonlyMap<string, Branch>
  readonly gutterWidth: number
  readonly width: number
  /** Column where the label starts, or -1 when the row has no label. */
  readonly labelStart: Int32Array
  /** Full display width of the label. */
  readonly labelFull: Int32Array
  /** Display width actually shown after truncation. */
  readonly labelShown: Int32Array
  readonly rowNodeIds: readonly (string | undefined)[]
}

export function createRaster<T>(layout: DagLayout<T>, options: RasterOptions = {}): Raster<T> {
  const resolved = resolveRasterOptions(options)
  return makeRaster(layout, resolved, measure(layout, resolved))
}

function measure<T>(layout: DagLayout<T>, options: ResolvedRasterOptions): Shared {
  const rows = layout.rows
  const gutterWidth = Math.max(0, 2 * layout.laneCount - 1)
  const labelStart = new Int32Array(rows.length).fill(-1)
  const labelFull = new Int32Array(rows.length)
  const labelShown = new Int32Array(rows.length)
  const rowNodeIds = Array.from({ length: rows.length }, (): string | undefined => undefined)
  let width = gutterWidth
  rows.forEach((row, i) => {
    if (row.kind !== "node") return
    rowNodeIds[i] = row.nodeId
    if (!options.labels) return
    const node = need(layout.graph.byId, row.nodeId)
    const full = options.measureText(labelText(node.label))
    if (full === 0) return
    const start = (options.labelAlign === "flow" ? usedWidth(row) : gutterWidth) + options.labelGap
    const limit = Math.min(
      options.maxLabelWidth ?? Number.POSITIVE_INFINITY,
      options.maxWidth === undefined ? Number.POSITIVE_INFINITY : options.maxWidth - start,
    )
    const shown = limit < 1 ? 0 : Math.min(full, limit)
    labelStart[i] = start
    labelFull[i] = full
    labelShown[i] = shown
    width = Math.max(width, start + shown)
  })
  return {
    branches: new Map(layout.branches.map((b) => [b.id, b])),
    gutterWidth,
    width,
    labelStart,
    labelFull,
    labelShown,
    rowNodeIds,
  }
}

/** Width of the gutter actually used by a row: up to and including its last occupied lane. */
function usedWidth(row: DagRow): number {
  for (let lane = row.cells.length - 1; lane >= 0; lane--) if (row.cells[lane] !== null) return 2 * lane + 1
  return 0
}

function labelText(label: DagNode["label"]): string {
  if (label === undefined) return ""
  return typeof label === "string" ? label : label.map((span) => span.text).join("")
}

function labelSpans(label: DagNode["label"]): readonly LabelSpan[] {
  if (label === undefined) return []
  return typeof label === "string" ? [{ text: label }] : label
}

function makeRaster<T>(layout: DagLayout<T>, options: ResolvedRasterOptions, shared: Shared): Raster<T> {
  const lit = highlighted(layout, options.selectedId, options.highlight)
  const cache = Array.from({ length: layout.rows.length }, (): Cell[] | undefined => undefined)
  const palette = options.palette
  const glyphs = options.glyphs

  const paletteColor = (index: number): ColorLike | undefined =>
    palette.length === 0 ? undefined : palette[index % palette.length]

  const groupColor = (group: string): ColorLike | undefined =>
    options.groupColors[group] ?? paletteColor(hashString(group))

  const branchColor = (branchId: string, lane: number): ColorLike | undefined => {
    const branch = shared.branches.get(branchId)
    if (options.colorStrategy === "lane") return paletteColor(lane)
    if (branch === undefined) return paletteColor(lane)
    if (options.colorStrategy === "group" && branch.group !== undefined) return groupColor(branch.group)
    return paletteColor(branch.colorSlot)
  }

  const nodeColor = (node: DagNode<T>, branchId: string, lane: number): ColorLike | undefined => {
    if (node.color !== undefined) return node.color
    if (options.colorStrategy === "group" && node.group !== undefined) return groupColor(node.group)
    return branchColor(branchId, lane)
  }

  const markerGlyph = (node: DagNode<T>): string => {
    const kind: MarkerKind = node.marker ?? (options.autoMarkers ? autoMarker(layout, node) : "node")
    if (typeof kind === "object") return options.measureText(kind.glyph) === 1 ? kind.glyph : glyphs.node
    return glyphs[kind]
  }

  const edgeDim = (cell: LaneCell | Link): boolean =>
    lit !== undefined && cell.edge !== undefined && !(lit.has(cell.edge.parent) && lit.has(cell.edge.child))

  const connector = (char: string, branchId: string, lane: number, dim: boolean): Cell => {
    const color = branchColor(branchId, lane)
    return {
      char,
      fg: dim ? (options.dimStyle.fg ?? color) : color,
      attrs: dim ? options.dimStyle.attrs || undefined : undefined,
      branchId,
    }
  }

  const nodeCell = (row: NodeRow, cell: LaneCell): Cell => {
    const node = need(layout.graph.byId, row.nodeId)
    const color = nodeColor(node, cell.branchId, row.lane)
    const selected = node.id === options.selectedId
    const dim = lit !== undefined && !lit.has(node.id)
    const attrs = (dim ? (options.dimStyle.attrs ?? 0) : 0) | (selected ? Attr.BOLD : 0)
    return {
      char: markerGlyph(node),
      fg: dim ? (options.dimStyle.fg ?? color) : color,
      attrs: attrs || undefined,
      nodeId: node.id,
      branchId: cell.branchId,
    }
  }

  const pushLabel = (out: Cell[], row: NodeRow, index: number) => {
    const node = need(layout.graph.byId, row.nodeId)
    const shown = shared.labelShown[index] ?? 0
    const truncated = (shared.labelFull[index] ?? 0) > shown
    const budget = truncated ? shown - 1 : shown
    const selected = node.id === options.selectedId
    const dim = lit !== undefined && !lit.has(node.id)
    const base = options.labelColor === "branch" ? nodeColor(node, row.branchId, row.lane) : undefined
    const styled = (span: LabelSpan | undefined, char: string): Cell => {
      const fg = (selected ? options.selectedStyle.fg : undefined) ?? span?.fg ?? base
      const bg = (selected ? options.selectedStyle.bg : undefined) ?? span?.bg
      const attrs =
        (span?.attrs ?? 0) |
        (selected ? (options.selectedStyle.attrs ?? 0) : 0) |
        (dim ? (options.dimStyle.attrs ?? 0) : 0)
      return { char, fg: dim ? (options.dimStyle.fg ?? fg) : fg, bg, attrs: attrs || undefined, nodeId: node.id }
    }
    let used = 0
    let last: LabelSpan | undefined
    for (const span of labelSpans(node.label)) {
      last = span
      let stop = false
      for (const grapheme of graphemes(span.text)) {
        const w = options.measureText(grapheme)
        if (w <= 0) continue
        if (used + w > budget) {
          stop = true
          break
        }
        out.push(styled(span, grapheme))
        for (let k = 1; k < w; k++) out.push(styled(span, ""))
        used += w
      }
      if (stop) break
    }
    if (truncated && shown >= 1) out.push(styled(last, glyphs.ellipsis))
  }

  const buildRow = (row: DagRow, index: number): Cell[] => {
    const out: Cell[] = []
    const lanes = row.cells.length
    for (let lane = 0; lane < lanes; lane++) {
      const cell = row.cells[lane] ?? null
      if (cell === null) out.push(BLANK)
      else if (cell.role === "node" && row.kind === "node") out.push(nodeCell(row, cell))
      else out.push(connector(armGlyph(glyphs, cell.arms), cell.branchId, lane, edgeDim(cell)))
      if (lane === lanes - 1) continue
      const link = row.links[lane] ?? null
      out.push(link === null ? BLANK : connector(glyphs.h, link.branchId, lane, edgeDim(link)))
    }
    while (out.length > 0 && out[out.length - 1] === BLANK) out.pop()
    const start = shared.labelStart[index] ?? -1
    if (row.kind !== "node" || start < 0 || (shared.labelShown[index] ?? 0) <= 0) return out
    while (out.length < start) out.push(BLANK)
    pushLabel(out, row, index)
    return out
  }

  return {
    layout,
    options,
    width: shared.width,
    height: layout.rows.length,
    gutterWidth: shared.gutterWidth,
    rowNodeIds: shared.rowNodeIds,
    row(index) {
      const cached = cache[index]
      if (cached !== undefined) return cached
      const row = layout.rows[index]
      if (row === undefined) return []
      const built = buildRow(row, index)
      cache[index] = built
      return built
    },
    withSelection(selection) {
      return makeRaster(
        layout,
        { ...options, selectedId: selection.selectedId, highlight: selection.highlight ?? options.highlight },
        shared,
      )
    },
  }
}

function autoMarker<T>(layout: DagLayout<T>, node: DagNode<T>): MarkerKind {
  if (layout.graph.stubs.has(node.id)) return "stub"
  if (node.parents.length === 0) return "root"
  if (node.parents.length >= 2) return "merge"
  if ((layout.graph.children.get(node.id)?.length ?? 0) === 0) return "tip"
  return "node"
}

/** Nodes that stay bright for a selection, or `undefined` when nothing should be dimmed. */
function highlighted(layout: DagLayout, selectedId: string | undefined, highlight: Highlight): Set<string> | undefined {
  if (selectedId === undefined || highlight === "none" || !layout.graph.byId.has(selectedId)) return undefined
  const lit = new Set<string>([selectedId])
  const spread = (next: (id: string) => readonly string[]) => {
    const queue = [selectedId]
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head]
      if (current === undefined) break
      for (const id of next(current)) {
        if (lit.has(id)) continue
        lit.add(id)
        queue.push(id)
      }
    }
  }
  if (highlight !== "descendants") spread((id) => layout.graph.byId.get(id)?.parents ?? [])
  if (highlight !== "ancestors") spread((id) => layout.graph.children.get(id) ?? [])
  return lit
}

/** All rows as a rectangular grid padded with blank cells. */
export function rasterize<T>(layout: DagLayout<T>, options: RasterOptions = {}): Cell[][] {
  const raster = createRaster(layout, options)
  return layout.rows.map((_, i) => {
    const row = [...raster.row(i)]
    while (row.length < raster.width) row.push(BLANK)
    return row
  })
}

/** Plain text rendering, trailing spaces trimmed. The primary test oracle. */
export function renderToString<T>(layout: DagLayout<T>, options: RasterOptions = {}): string {
  const raster = createRaster(layout, options)
  return layout.rows
    .map((_, i) =>
      raster
        .row(i)
        .map((cell) => cell.char)
        .join("")
        .replace(/ +$/, ""),
    )
    .join("\n")
}
