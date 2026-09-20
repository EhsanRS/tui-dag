import {
  MouseButton,
  parseColor,
  Renderable,
  RGBA,
  ScrollBoxRenderable,
  TextAttributes,
  type KeyEvent,
  type MouseEvent,
  type OptimizedBuffer,
  type RenderContext,
  type RenderableOptions,
} from "@opentui/core"
import { MeasureMode } from "@opentui/core/yoga"
import { layoutDag } from "../layout/layout"
import { laneOf, rowOf, type DagLayout, type LayoutOptions } from "../layout/types"
import { Attr, type ColorLike, type DagNode } from "../model/types"
import { validate, type UnknownParentMode, type ValidationIssue } from "../model/validate"
import { createRaster, type Cell, type Raster, type RasterOptions } from "../raster/raster"

// Layer 3 defines its own attribute bits so it can stay free of OpenTUI; they must match exactly.
const attrPairs: readonly (readonly [number, number])[] = [
  [Attr.BOLD, TextAttributes.BOLD],
  [Attr.DIM, TextAttributes.DIM],
  [Attr.ITALIC, TextAttributes.ITALIC],
  [Attr.UNDERLINE, TextAttributes.UNDERLINE],
  [Attr.BLINK, TextAttributes.BLINK],
  [Attr.INVERSE, TextAttributes.INVERSE],
  [Attr.HIDDEN, TextAttributes.HIDDEN],
  [Attr.STRIKETHROUGH, TextAttributes.STRIKETHROUGH],
]
if (attrPairs.some(([ours, theirs]) => ours !== theirs)) {
  throw new Error("opentui-dag: Attr bits do not match @opentui/core TextAttributes")
}

// Widened once so the comparison with `MouseEvent.button` (a plain number) needs no enum coercion.
const LEFT_BUTTON: number = MouseButton.LEFT

/** Row and lane of a node, handed to selection callbacks. */
export interface DagNodeInfo {
  row: number
  lane: number
}

export type DagNodeHandler<T> = (node: DagNode<T>, info: DagNodeInfo) => void

/** Key specs per action, e.g. `"down"`, `"j"`, `"ctrl+n"`. Names follow OpenTUI's `KeyEvent.name`. */
export interface DagKeys {
  up: readonly string[]
  down: readonly string[]
  parent: readonly string[]
  child: readonly string[]
  first: readonly string[]
  last: readonly string[]
  activate: readonly string[]
}

export const defaultDagKeys: DagKeys = {
  up: ["up", "k"],
  down: ["down", "j"],
  parent: ["left", "h"],
  child: ["right", "l"],
  first: ["home"],
  last: ["end"],
  activate: ["return"],
}

type StyleOptions = Omit<RasterOptions, "labels" | "maxWidth" | "selectedId">

/**
 * Options of {@link DagRenderable}. Every field is optional and is also a settable property, so Solid can
 * construct the renderable with `{ id }` and assign props afterwards. Colours accept hex strings, 0–255
 * channel objects or OpenTUI `RGBA` instances.
 */
export interface DagViewOptions<T = unknown> extends RenderableOptions<DagRenderable<T>>, LayoutOptions, StyleOptions {
  nodes?: readonly DagNode<T>[]
  /** How unknown parent ids are treated; see `validate`. Default `"error"` (the graph is not drawn). */
  unknownParent?: UnknownParentMode
  selectedId?: string
  /** Draw only the lanes; the consumer renders row content beside the gutter. */
  gutterOnly?: boolean
  /** Default `true`. */
  focusable?: boolean
  /** Focus right after construction. Solid also applies this prop reactively through `focus()`/`blur()`. */
  focused?: boolean
  /** Key bindings for the built-in handler, or `false` to disable it and drive selection through methods. */
  keys?: Partial<DagKeys> | false
  /** Scroll the nearest ScrollBox ancestor to keep a keyboard-selected row visible. Default `true`. */
  followSelection?: boolean
  /** Default colour for label text without an explicit colour. Default: the terminal's default foreground. */
  fg?: ColorLike
  /** Fires on keyboard or mouse selection. Named `onNodeSelect` because Solid reserves `onSelect` for Select. */
  onNodeSelect?: DagNodeHandler<T>
  /** Fires on Enter or double click. */
  onNodeActivate?: DagNodeHandler<T>
  /** Fires when the node under the mouse changes; `null` when the pointer leaves the graph. */
  onNodeHover?: (node: DagNode<T> | null) => void
  /** Fires after nodes or layout options changed and the layout was recomputed. */
  onLayout?: (layout: DagLayout<T> | undefined, issues: readonly ValidationIssue[]) => void
}

/**
 * Draws a DAG as a lane graph. Size comes from a Yoga measure function (gutter plus labels wide, one cell
 * per row tall); only rows inside the terminal and every clipping ancestor are rasterised and drawn, so a
 * graph with thousands of rows inside a ScrollBox costs only its visible part.
 *
 * Events (also available as `on*` props): `"select"`, `"activate"`, `"hover"`, `"layout"`.
 */
export class DagRenderable<T = unknown> extends Renderable {
  private _nodes: readonly DagNode<T>[] = []
  private _unknownParent: UnknownParentMode = "error"
  private _layoutOptions: LayoutOptions = {}
  private _style: StyleOptions = {}
  private _selectedId: string | undefined
  private _gutterOnly = false
  private _keys: DagKeys | false = defaultDagKeys
  private _followSelection = true
  private _fg: ColorLike | undefined
  private _onSelect: DagNodeHandler<T> | undefined
  private _onActivate: DagNodeHandler<T> | undefined
  private _onHover: ((node: DagNode<T> | null) => void) | undefined
  private _onLayout: ((layout: DagLayout<T> | undefined, issues: readonly ValidationIssue[]) => void) | undefined

  private _layout: DagLayout<T> | undefined
  private _issues: readonly ValidationIssue[] = []
  private _layoutDirty = true
  private _layoutScheduled = false
  private _base: Raster<T> | undefined
  private _fitted: Raster<T> | undefined
  private _fittedWidth = -1
  private _hover: string | null = null
  private _lastClick = { row: -1, at: 0 }
  private readonly _rgba = new Map<string | object, RGBA>()

  constructor(ctx: RenderContext, options: DagViewOptions<T>) {
    super(ctx, options)
    this._focusable = options.focusable ?? true
    // The measure function must exist before any setter marks the Yoga node dirty.
    this.getLayoutNode().setMeasureFunc((width, widthMode, height, heightMode) =>
      this.measure(width, widthMode, height, heightMode),
    )
    this.applyOptions(options)
  }

  // ---- data -------------------------------------------------------------------------------------------

  get nodes(): readonly DagNode<T>[] {
    return this._nodes
  }
  set nodes(value: readonly DagNode<T>[] | undefined) {
    const next = value ?? []
    if (next === this._nodes) return
    this._nodes = next
    this.invalidateLayout()
  }

  get unknownParent(): UnknownParentMode {
    return this._unknownParent
  }
  set unknownParent(value: UnknownParentMode | undefined) {
    const next = value ?? "error"
    if (next === this._unknownParent) return
    this._unknownParent = next
    this.invalidateLayout()
  }

  get direction() {
    return this._layoutOptions.direction
  }
  set direction(value: LayoutOptions["direction"]) {
    this.setLayoutOption("direction", value)
  }
  get forkStyle() {
    return this._layoutOptions.forkStyle
  }
  set forkStyle(value: LayoutOptions["forkStyle"]) {
    this.setLayoutOption("forkStyle", value)
  }
  get rowGap() {
    return this._layoutOptions.rowGap
  }
  set rowGap(value: LayoutOptions["rowGap"]) {
    this.setLayoutOption("rowGap", value)
  }
  get trunk() {
    return this._layoutOptions.trunk
  }
  set trunk(value: LayoutOptions["trunk"]) {
    this.setLayoutOption("trunk", value)
  }
  get staggerRoots() {
    return this._layoutOptions.staggerRoots
  }
  set staggerRoots(value: LayoutOptions["staggerRoots"]) {
    this.setLayoutOption("staggerRoots", value)
  }
  get laneAllocation() {
    return this._layoutOptions.laneAllocation
  }
  set laneAllocation(value: LayoutOptions["laneAllocation"]) {
    this.setLayoutOption("laneAllocation", value)
  }

  // ---- style -------------------------------------------------------------------------------------------

  get glyphs() {
    return this._style.glyphs
  }
  set glyphs(value: StyleOptions["glyphs"]) {
    this.setStyle("glyphs", value, false)
  }
  get palette() {
    return this._style.palette
  }
  set palette(value: StyleOptions["palette"]) {
    this.setStyle("palette", value, false)
  }
  get colorStrategy() {
    return this._style.colorStrategy
  }
  set colorStrategy(value: StyleOptions["colorStrategy"]) {
    this.setStyle("colorStrategy", value, false)
  }
  get groupColors() {
    return this._style.groupColors
  }
  set groupColors(value: StyleOptions["groupColors"]) {
    this.setStyle("groupColors", value, false)
  }
  get highlight() {
    return this._style.highlight
  }
  set highlight(value: StyleOptions["highlight"]) {
    if (value === this._style.highlight) return
    this._style = { ...this._style, highlight: value }
    this.invalidateSelection()
  }
  get dimStyle() {
    return this._style.dimStyle
  }
  set dimStyle(value: StyleOptions["dimStyle"]) {
    this.setStyle("dimStyle", value, false)
  }
  get selectedStyle() {
    return this._style.selectedStyle
  }
  set selectedStyle(value: StyleOptions["selectedStyle"]) {
    this.setStyle("selectedStyle", value, false)
  }
  get labelGap() {
    return this._style.labelGap
  }
  set labelGap(value: StyleOptions["labelGap"]) {
    this.setStyle("labelGap", value, true)
  }
  get labelAlign() {
    return this._style.labelAlign
  }
  set labelAlign(value: StyleOptions["labelAlign"]) {
    this.setStyle("labelAlign", value, true)
  }
  get labelColor() {
    return this._style.labelColor
  }
  set labelColor(value: StyleOptions["labelColor"]) {
    this.setStyle("labelColor", value, false)
  }
  get maxLabelWidth() {
    return this._style.maxLabelWidth
  }
  set maxLabelWidth(value: StyleOptions["maxLabelWidth"]) {
    this.setStyle("maxLabelWidth", value, true)
  }
  get autoMarkers() {
    return this._style.autoMarkers
  }
  set autoMarkers(value: StyleOptions["autoMarkers"]) {
    this.setStyle("autoMarkers", value, false)
  }
  get measureText() {
    return this._style.measureText
  }
  set measureText(value: StyleOptions["measureText"]) {
    this.setStyle("measureText", value, true)
  }
  get gutterOnly(): boolean {
    return this._gutterOnly
  }
  set gutterOnly(value: boolean | undefined) {
    const next = value ?? false
    if (next === this._gutterOnly) return
    this._gutterOnly = next
    this.invalidateSize()
  }
  get fg(): ColorLike | undefined {
    return this._fg
  }
  set fg(value: ColorLike | undefined) {
    if (value === this._fg) return
    this._fg = value
    this.requestRender()
  }

  // ---- interaction options ------------------------------------------------------------------------------

  get keys(): DagKeys | false {
    return this._keys
  }
  set keys(value: Partial<DagKeys> | false | undefined) {
    this._keys = value === false ? false : { ...defaultDagKeys, ...value }
  }
  get followSelection(): boolean {
    return this._followSelection
  }
  set followSelection(value: boolean | undefined) {
    this._followSelection = value ?? true
  }
  set onNodeSelect(value: DagNodeHandler<T> | undefined) {
    this._onSelect = value
  }
  set onNodeActivate(value: DagNodeHandler<T> | undefined) {
    this._onActivate = value
  }
  set onNodeHover(value: ((node: DagNode<T> | null) => void) | undefined) {
    this._onHover = value
  }
  set onLayout(value: ((layout: DagLayout<T> | undefined, issues: readonly ValidationIssue[]) => void) | undefined) {
    this._onLayout = value
  }

  // ---- selection ----------------------------------------------------------------------------------------

  get selectedId(): string | undefined {
    return this._selectedId
  }
  set selectedId(value: string | undefined) {
    this.select(value)
  }

  /** The node under the mouse, or `null`. */
  get hoveredId(): string | null {
    return this._hover
  }

  /** Current layout, or `undefined` while the nodes are invalid or empty. */
  get layout(): DagLayout<T> | undefined {
    this.ensureLayout()
    return this._layout
  }

  /** Validation issues of the current nodes (non-fatal ones are reported even when a layout exists). */
  get issues(): readonly ValidationIssue[] {
    this.ensureLayout()
    return this._issues
  }

  rowOf(id: string): number | undefined {
    const layout = this.layout
    return layout === undefined ? undefined : rowOf(layout, id)
  }

  nodeAt(row: number): DagNode<T> | undefined {
    const entry = this.layout?.rows[row]
    if (entry === undefined || entry.kind !== "node") return undefined
    return this.layout?.graph.byId.get(entry.nodeId)
  }

  /** Selects a node (or clears the selection). Emits `select` only when `emit` is set. */
  select(id: string | undefined, options: { emit?: boolean } = {}): void {
    if (id === this._selectedId) return
    this._selectedId = id
    this.invalidateSelection()
    if (!options.emit || id === undefined) return
    const node = this.layout?.graph.byId.get(id)
    if (node === undefined) return
    const info = this.infoOf(id)
    this.emit("select", node, info)
    this._onSelect?.(node, info)
  }

  /** Moves the selection by `delta` node rows, skipping connector rows; clamps at both ends. */
  moveSelection(delta: number): void {
    const layout = this.layout
    if (layout === undefined || delta === 0) return
    const nodeRows = layout.rows.filter((row) => row.kind === "node")
    if (nodeRows.length === 0) return
    const currentRow = this._selectedId === undefined ? undefined : rowOf(layout, this._selectedId)
    const currentIndex = currentRow === undefined ? -1 : nodeRows.findIndex((row) => row.index === currentRow)
    const from = currentIndex === -1 ? (delta > 0 ? -1 : nodeRows.length) : currentIndex
    const target = nodeRows[Math.max(0, Math.min(nodeRows.length - 1, from + delta))]
    if (target?.kind !== "node") return
    this.selectAndFollow(target.nodeId)
  }

  /** Selects the first parent of the selected node. */
  selectParent(): void {
    const parent = this.selectedNode()?.parents[0]
    if (parent !== undefined) this.selectAndFollow(parent)
  }

  /** Selects the child that continues the selected node's lane, or its first child. */
  selectChild(): void {
    const layout = this.layout
    const id = this._selectedId
    if (layout === undefined || id === undefined) return
    const child = layout.continuation.get(id) ?? layout.graph.children.get(id)?.[0]
    if (child !== undefined) this.selectAndFollow(child)
  }

  selectFirst(): void {
    const first = this.layout?.rows.find((row) => row.kind === "node")
    if (first?.kind === "node") this.selectAndFollow(first.nodeId)
  }

  selectLast(): void {
    const rows = this.layout?.rows ?? []
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i]
      if (row?.kind === "node") {
        this.selectAndFollow(row.nodeId)
        return
      }
    }
  }

  /** Emits `activate` for the selected node. */
  activate(): void {
    const node = this.selectedNode()
    if (node === undefined) return
    const info = this.infoOf(node.id)
    this.emit("activate", node, info)
    this._onActivate?.(node, info)
  }

  /** Scrolls the nearest ScrollBox ancestor so the row of `id` (default: the selection) is visible. */
  scrollIntoView(id: string | undefined = this._selectedId): void {
    if (id === undefined) return
    const row = this.rowOf(id)
    if (row === undefined) return
    let ancestor = this.parent
    while (ancestor !== null && !(ancestor instanceof ScrollBoxRenderable)) ancestor = ancestor.parent
    if (ancestor === null) return
    const rowY = this.screenY + row
    const top = ancestor.viewport.screenY
    const bottom = top + ancestor.viewport.height
    if (rowY < top) ancestor.scrollBy(rowY - top)
    else if (rowY >= bottom) ancestor.scrollBy(rowY - bottom + 1)
  }

  /**
   * Rows that need drawing: the intersection of this renderable's rows with the terminal and with every
   * ancestor that clips (`overflow` other than `"visible"`). Returned as `[first, end)`.
   */
  visibleRowRange(): [number, number] {
    const screenY = this.screenY
    let first = Math.max(0, -screenY)
    let end = Math.min(this.height, this._ctx.height - screenY)
    for (let ancestor = this.parent; ancestor !== null; ancestor = ancestor.parent) {
      if (!(ancestor instanceof Renderable)) break
      if (ancestor.overflow === "visible") continue
      first = Math.max(first, ancestor.screenY - screenY)
      end = Math.min(end, ancestor.screenY + ancestor.height - screenY)
    }
    return [first, Math.max(first, end)]
  }

  // ---- Renderable overrides -----------------------------------------------------------------------------

  override handleKeyPress(key: KeyEvent): boolean {
    if (this._keys === false) return false
    const keys = this._keys
    if (matchesKey(keys.down, key)) return this.handled(() => this.moveSelection(1))
    if (matchesKey(keys.up, key)) return this.handled(() => this.moveSelection(-1))
    if (matchesKey(keys.parent, key)) return this.handled(() => this.selectParent())
    if (matchesKey(keys.child, key)) return this.handled(() => this.selectChild())
    if (matchesKey(keys.first, key)) return this.handled(() => this.selectFirst())
    if (matchesKey(keys.last, key)) return this.handled(() => this.selectLast())
    if (matchesKey(keys.activate, key)) return this.handled(() => this.activate())
    return false
  }

  protected override onMouseEvent(event: MouseEvent): void {
    const row = event.y - this.screenY
    if (event.type === "down") {
      if (event.button !== LEFT_BUTTON) return
      const id = this.nodeAt(row)?.id
      if (id === undefined) return
      const now = Date.now()
      const double = this._lastClick.row === row && now - this._lastClick.at < 400
      this._lastClick = { row, at: now }
      this.select(id, { emit: true })
      if (double) this.activate()
      return
    }
    if (event.type === "move" || event.type === "over") {
      this.setHover(this.nodeAt(row)?.id ?? null)
      return
    }
    if (event.type === "out") this.setHover(null)
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    const raster = this.drawRaster()
    if (raster === undefined) return
    const ox = this.buffered ? 0 : this.screenX
    const oy = this.buffered ? 0 : this.screenY
    const [first, end] = this.visibleRowRange()
    for (let row = first; row < end; row++) this.drawRow(buffer, raster.row(row), ox, oy + row, this.width)
  }

  protected override destroySelf(): void {
    this._base = undefined
    this._fitted = undefined
    this._layout = undefined
    this._rgba.clear()
    this._onSelect = undefined
    this._onActivate = undefined
    this._onHover = undefined
    this._onLayout = undefined
    super.destroySelf()
  }

  // ---- internals -----------------------------------------------------------------------------------------

  private applyOptions(options: DagViewOptions<T>) {
    this.nodes = options.nodes
    this.unknownParent = options.unknownParent
    this._layoutOptions = {
      direction: options.direction,
      forkStyle: options.forkStyle,
      rowGap: options.rowGap,
      trunk: options.trunk,
      staggerRoots: options.staggerRoots,
      laneAllocation: options.laneAllocation,
    }
    this._style = {
      glyphs: options.glyphs,
      palette: options.palette,
      colorStrategy: options.colorStrategy,
      groupColors: options.groupColors,
      highlight: options.highlight,
      dimStyle: options.dimStyle,
      selectedStyle: options.selectedStyle,
      labelGap: options.labelGap,
      labelAlign: options.labelAlign,
      labelColor: options.labelColor,
      maxLabelWidth: options.maxLabelWidth,
      autoMarkers: options.autoMarkers,
      measureText: options.measureText,
    }
    this._selectedId = options.selectedId
    this._gutterOnly = options.gutterOnly ?? false
    this.keys = options.keys
    this._followSelection = options.followSelection ?? true
    this._fg = options.fg
    this._onSelect = options.onNodeSelect
    this._onActivate = options.onNodeActivate
    this._onHover = options.onNodeHover
    this._onLayout = options.onLayout
    this.invalidateLayout()
    if (options.focused) this.focus()
  }

  private setLayoutOption<K extends keyof LayoutOptions>(key: K, value: LayoutOptions[K]) {
    if (this._layoutOptions[key] === value) return
    this._layoutOptions = { ...this._layoutOptions, [key]: value }
    this.invalidateLayout()
  }

  private setStyle<K extends keyof StyleOptions>(key: K, value: StyleOptions[K], affectsSize: boolean) {
    if (this._style[key] === value) return
    this._style = { ...this._style, [key]: value }
    if (affectsSize) this.invalidateSize()
    else this.invalidateStyle()
  }

  private invalidateLayout() {
    this._layoutDirty = true
    this._base = undefined
    this._fitted = undefined
    this.getLayoutNode().markDirty()
    this.requestRender()
    if (this._layoutScheduled) return
    this._layoutScheduled = true
    // Coalesces a burst of setter calls (Solid applies all props in one effect) into one layout pass that
    // runs outside the render pass, so the `layout` event never fires from inside a draw.
    queueMicrotask(() => {
      this._layoutScheduled = false
      if (!this.isDestroyed) this.ensureLayout()
    })
  }

  private invalidateSize() {
    this._base = undefined
    this._fitted = undefined
    this.getLayoutNode().markDirty()
    this.requestRender()
  }

  private invalidateStyle() {
    this._base = undefined
    this._fitted = undefined
    this.requestRender()
  }

  private invalidateSelection() {
    this._fitted = undefined
    this.requestRender()
  }

  private ensureLayout() {
    if (!this._layoutDirty) return
    this._layoutDirty = false
    const result = validate(this._nodes, { unknownParent: this._unknownParent })
    this._issues = result.issues
    this._layout = result.ok ? layoutDag(result.graph, this._layoutOptions) : undefined
    this._base = undefined
    this._fitted = undefined
    this.emit("layout", this._layout, this._issues)
    this._onLayout?.(this._layout, this._issues)
  }

  private baseRaster(): Raster<T> | undefined {
    this.ensureLayout()
    if (this._layout === undefined) return undefined
    if (this._base === undefined) this._base = createRaster(this._layout, { ...this._style, labels: !this._gutterOnly })
    return this._base
  }

  /** The raster actually drawn: truncated to the computed width and carrying the selection. */
  private drawRaster(): Raster<T> | undefined {
    const base = this.baseRaster()
    if (base === undefined || this._layout === undefined) return undefined
    const width = this.width
    if (this._fitted !== undefined && this._fittedWidth === width) return this._fitted
    const selection = { selectedId: this._selectedId, highlight: this._style.highlight }
    this._fitted =
      width < base.width
        ? createRaster(this._layout, { ...this._style, ...selection, labels: !this._gutterOnly, maxWidth: width })
        : base.withSelection(selection)
    this._fittedWidth = width
    return this._fitted
  }

  /**
   * Width honours `AtMost` (labels get truncated to the space available). Height does not: a ScrollBox
   * measures its children with `AtMost` = viewport height, and reporting the full row count is what makes
   * the graph scrollable — the same behaviour as OpenTUI's text renderable.
   */
  private measure(width: number, widthMode: MeasureMode, height: number, heightMode: MeasureMode) {
    const base = this.baseRaster()
    const naturalWidth = Math.max(1, base?.width ?? 1)
    const naturalHeight = base?.height ?? 0
    const measuredWidth =
      widthMode === MeasureMode.Exactly
        ? width
        : widthMode === MeasureMode.AtMost
          ? Math.min(width, naturalWidth)
          : naturalWidth
    return { width: measuredWidth, height: heightMode === MeasureMode.Exactly ? height : naturalHeight }
  }

  private drawRow(buffer: OptimizedBuffer, cells: readonly Cell[], ox: number, y: number, maxWidth: number) {
    const limit = Math.min(cells.length, maxWidth)
    let x = 0
    while (x < limit) {
      const start = cells[x]
      if (start === undefined || isBlank(start)) {
        x++
        continue
      }
      const chars: string[] = []
      let end = x
      while (end < limit) {
        const cell = cells[end]
        if (cell === undefined || isBlank(cell) || !sameStyle(cell, start)) break
        chars.push(cell.char)
        end++
      }
      // A wide grapheme whose continuation cell falls outside the width must not spill over the edge.
      if (end === maxWidth && cells[end]?.char === "") chars.pop()
      const bg = start.bg === undefined ? undefined : this.toRGBA(start.bg)
      buffer.drawText(chars.join(""), ox + x, y, this.toRGBA(start.fg ?? this._fg), bg, start.attrs ?? 0)
      x = end
    }
  }

  private toRGBA(color: ColorLike | undefined): RGBA {
    if (color === undefined) return RGBA.defaultForeground()
    if (color instanceof RGBA) return color
    const cached = this._rgba.get(color)
    if (cached !== undefined) return cached
    const rgba =
      typeof color === "string" ? parseColor(color) : RGBA.fromInts(color.r, color.g, color.b, color.a ?? 255)
    this._rgba.set(color, rgba)
    return rgba
  }

  private selectedNode(): DagNode<T> | undefined {
    return this._selectedId === undefined ? undefined : this.layout?.graph.byId.get(this._selectedId)
  }

  private infoOf(id: string): DagNodeInfo {
    const layout = this.layout
    return {
      row: layout === undefined ? -1 : (rowOf(layout, id) ?? -1),
      lane: layout === undefined ? -1 : (laneOf(layout, id) ?? -1),
    }
  }

  private selectAndFollow(id: string) {
    this.select(id, { emit: true })
    if (this._followSelection) this.scrollIntoView(id)
  }

  private setHover(id: string | null) {
    if (id === this._hover) return
    this._hover = id
    const node = id === null ? null : (this.layout?.graph.byId.get(id) ?? null)
    this.emit("hover", node)
    this._onHover?.(node)
  }

  private handled(action: () => void): boolean {
    action()
    return true
  }
}

function isBlank(cell: Cell): boolean {
  return cell.char === " " && cell.bg === undefined && (cell.attrs ?? 0) === 0
}

function sameStyle(a: Cell, b: Cell): boolean {
  return a.fg === b.fg && a.bg === b.bg && (a.attrs ?? 0) === (b.attrs ?? 0)
}

/** Matches `"ctrl+shift+name"` specs against a key event; unlisted modifiers must be off. */
function matchesKey(specs: readonly string[], key: KeyEvent): boolean {
  const name = key.name.toLowerCase()
  return specs.some((spec) => {
    const parts = spec.toLowerCase().split("+")
    const wanted = parts.pop()
    const mods = new Set(parts)
    return (
      wanted === name &&
      key.ctrl === mods.has("ctrl") &&
      key.shift === mods.has("shift") &&
      key.meta === mods.has("meta") &&
      key.option === mods.has("alt")
    )
  })
}
