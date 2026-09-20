import type { DagNode } from "../model/types"
import { DagValidationError, need, validate, type DagGraph, type ValidateOptions } from "../model/validate"
import {
  Arm,
  type Branch,
  type DagLayout,
  type DagRow,
  type EdgeRef,
  type EdgeRoute,
  type LaneCell,
  type LaneRole,
  type LayoutOptions,
  type Link,
  type ResolvedLayoutOptions,
} from "./types"

/**
 * Assigns lanes and builds rows for a validated graph.
 *
 * Three steps. A continuation pass walks first-parent chains back from the tips (`trunk` ids first, then
 * newest tip first, then every merged-in head) to decide which child continues each node's lane. A sweep in
 * topological order then turns the graph into *branches* (lane occupancy episodes with a start row, an end
 * row and the branch they forked from) and row specs, without choosing lane numbers. Finally a lane policy
 * assigns one lane per branch: `"leftmost"` and `"nearest"` place branches in start order into the first lane
 * that is free for the branch's whole lifetime; `"nested"` walks the branch tree depth first so a branch's
 * sub-branches sit right of it and before its later siblings. Merges are drawn on the child's row, forks on a
 * connector row after the parent, so no cell ever needs both a `╯` and a `╮`. Lane indices never change while
 * a branch lives. O((n + e) log n) ordering plus O(rows × lanes) for the sweep and row building.
 */
export function layoutDag<T>(graph: DagGraph<T>, options: LayoutOptions = {}): DagLayout<T> {
  const rowGap = options.rowGap ?? "auto"
  const resolved: ResolvedLayoutOptions = {
    direction: options.direction ?? "down",
    forkStyle: options.forkStyle ?? "row",
    rowGap,
    trunk: options.trunk ?? [],
    staggerRoots: options.staggerRoots ?? rowGap === "none",
    laneAllocation: options.laneAllocation ?? "leftmost",
  }
  const continuation = computeContinuation(graph, resolved.trunk)
  const sweep = new Sweep(graph, continuation, resolved)
  graph.order.forEach((id, i) => sweep.place(id, graph.order[i + 1]))
  const laneCount = assignLanes(sweep.branches, resolved)
  assignColorSlots(sweep.branches)
  const built = buildRows(sweep.specs, sweep.branches, sweep.routes)
  const oriented = resolved.direction === "up" ? flip(built) : built
  return {
    graph,
    options: resolved,
    rows: oriented.rows,
    laneCount,
    branches: oriented.branches,
    edges: oriented.edges,
    rowIndex: indexRows(oriented.rows),
    continuation,
  }
}

/** Validates then lays out. Throws {@link DagValidationError} when validation fails. */
export function layoutNodes<T>(
  nodes: readonly DagNode<T>[],
  options: LayoutOptions & ValidateOptions = {},
): DagLayout<T> {
  const result = validate(nodes, options)
  if (!result.ok) throw new DagValidationError(result.issues)
  return layoutDag(result.graph, options)
}

/**
 * Pass 1: `cont[p] = x` means child `x` continues `p`'s lane. Walking from a node claims its whole
 * first-parent chain until it meets a chain that was claimed earlier, so priority order decides which
 * lineage stays straight. The first-parent chain of the highest-priority tip owns its lanes end to end,
 * which is git's `--first-parent` column.
 */
function computeContinuation(graph: DagGraph, trunk: readonly string[]): Map<string, string> {
  const cont = new Map<string, string>()
  const walk = (start: string) => {
    let current = start
    for (;;) {
      const parent = graph.byId.get(current)?.parents[0]
      if (parent === undefined || cont.has(parent)) return
      cont.set(parent, current)
      current = parent
    }
  }
  for (const id of trunk) if (graph.byId.has(id)) walk(id)
  const tips = graph.order.filter((id) => (graph.children.get(id)?.length ?? 0) === 0)
  for (const tip of [...tips].reverse()) walk(tip)
  for (const id of [...graph.order].reverse()) {
    for (const parent of need(graph.byId, id).parents.slice(1)) walk(parent)
  }
  return cont
}

/** A lane occupancy episode. `lane` and `colorSlot` are filled in after the sweep. */
interface BranchState {
  id: string
  ordinal: number
  headId: string
  group?: string
  startRow: number
  endRow: number
  /** The branch this one forked from; `null` for roots. */
  parent: BranchState | null
  children: BranchState[]
  /** Ended at a tip node (as opposed to merging into another branch). */
  endedAsTip: boolean
  lane: number
  colorSlot: number
}

/** An edge in flight, occupying its branch's lane until `child` is placed. */
interface Pending {
  parent: string
  child: string
  branch: BranchState
}

interface RouteState {
  parent: string
  child: string
  branch: BranchState
  forkRow: number | null
  mergeRow: number | null
}

interface LiveEdge {
  branch: BranchState
  edge: EdgeRef
}

type RowSpec =
  | {
      kind: "node"
      index: number
      nodeId: string
      branch: BranchState
      isRoot: boolean
      continues: boolean
      merges: BranchState[]
      forks: BranchState[]
      live: LiveEdge[]
    }
  | { kind: "fork"; index: number; sourceId: string; branch: BranchState; forks: BranchState[]; live: LiveEdge[] }
  | { kind: "gap"; index: number; live: LiveEdge[] }

interface Built {
  rows: DagRow[]
  branches: Branch[]
  edges: EdgeRoute[]
}

/** Step 2: branches, edge routes and row specs, all lane-independent. */
class Sweep {
  readonly branches: BranchState[] = []
  readonly routes = new Map<string, RouteState>()
  readonly specs: RowSpec[] = []
  private readonly pending = new Set<Pending>()

  constructor(
    private readonly graph: DagGraph,
    private readonly cont: ReadonlyMap<string, string>,
    private readonly options: ResolvedLayoutOptions,
  ) {}

  place(id: string, next: string | undefined) {
    const node = need(this.graph.byId, id)
    const firstParent = node.parents[0]
    const kids = this.graph.children.get(id) ?? []
    const row = this.specs.length

    let own: Pending | undefined
    const closing: Pending[] = []
    for (const p of this.pending) {
      if (p.child !== id) continue
      if (own === undefined && p.parent === firstParent) own = p
      else closing.push(p)
    }

    const isRoot = own === undefined
    const branch = own?.branch ?? this.openBranch(null, id, row, node.group)
    if (own !== undefined) this.pending.delete(own)

    for (const p of closing) {
      this.routeOf(p.parent, id).mergeRow = row
      p.branch.endRow = row
    }

    const straight = this.cont.get(id) ?? kids[0]
    const forks = kids.filter((child) => child !== straight)
    const continues = straight !== undefined
    if (continues) {
      this.pending.add({ parent: id, child: straight, branch })
      this.routes.set(edgeKey(id, straight), { parent: id, child: straight, branch, forkRow: null, mergeRow: null })
    } else {
      branch.endRow = row
      branch.endedAsTip = true
    }

    const inline = this.options.forkStyle === "inline"
    const inlineForks = inline ? forks.map((child) => this.openFork(branch, id, child, row)) : []
    this.specs.push({
      kind: "node",
      index: row,
      nodeId: id,
      branch,
      isRoot,
      continues,
      merges: closing.map((p) => p.branch),
      forks: inlineForks,
      live: this.live(),
    })
    for (const p of closing) this.pending.delete(p)

    if (!inline && forks.length > 0) {
      const forkRow = this.specs.length
      const opened = forks.map((child) => this.openFork(branch, id, child, forkRow))
      this.specs.push({ kind: "fork", index: forkRow, sourceId: id, branch, forks: opened, live: this.live() })
    }

    // "auto": only when the next row's node truly continues this lane (a merge edge is already visible as ╯).
    const lastKind = this.specs.at(-1)?.kind
    const gap =
      next !== undefined &&
      lastKind === "node" &&
      (this.options.rowGap === "always" || (this.options.rowGap === "auto" && this.cont.get(id) === next))
    if (gap) this.specs.push({ kind: "gap", index: this.specs.length, live: this.live() })
  }

  private live(): LiveEdge[] {
    return [...this.pending].map((p) => ({ branch: p.branch, edge: { parent: p.parent, child: p.child } }))
  }

  private routeOf(parent: string, child: string): RouteState {
    return need(this.routes, edgeKey(parent, child))
  }

  private openBranch(
    parent: BranchState | null,
    headId: string,
    startRow: number,
    group: string | undefined,
  ): BranchState {
    const branch: BranchState = {
      id: `b${this.branches.length}`,
      ordinal: this.branches.length,
      headId,
      group,
      startRow,
      endRow: startRow,
      parent,
      children: [],
      endedAsTip: false,
      lane: -1,
      colorSlot: -1,
    }
    this.branches.push(branch)
    parent?.children.push(branch)
    return branch
  }

  private openFork(from: BranchState, parent: string, child: string, startRow: number): BranchState {
    // A branch the child will live in is the child's; one that only carries an edge into the child's own
    // lane (a report, a merge) is the parent's lineage and keeps the parent's group colour.
    const childNode = this.graph.byId.get(child)
    const group = childNode?.parents[0] === parent ? childNode.group : this.graph.byId.get(parent)?.group
    const branch = this.openBranch(from, child, startRow, group)
    this.pending.add({ parent, child, branch })
    this.routes.set(edgeKey(parent, child), { parent, child, branch, forkRow: startRow, mergeRow: null })
    return branch
  }
}

/** Sorted, non-overlapping row intervals per lane (or colour slot). */
class Occupancy {
  private readonly lanes: [number, number][][] = []

  isFree(lane: number, start: number, end: number): boolean {
    const intervals = this.lanes[lane]
    if (intervals === undefined) return true
    let lo = 0
    let hi = intervals.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((intervals[mid] as [number, number])[1] < start) lo = mid + 1
      else hi = mid
    }
    const candidate = intervals[lo]
    return candidate === undefined || candidate[0] > end
  }

  occupy(lane: number, start: number, end: number) {
    const intervals = this.lanes[lane] ?? []
    this.lanes[lane] = intervals
    let lo = 0
    let hi = intervals.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((intervals[mid] as [number, number])[0] < start) lo = mid + 1
      else hi = mid
    }
    intervals.splice(lo, 0, [start, end])
  }

  /** First lane at or after `from` that is free over the interval and not excluded. */
  firstFree(from: number, start: number, end: number, excluded?: ReadonlySet<number>): number {
    let lane = from
    while (!this.isFree(lane, start, end) || excluded?.has(lane)) lane++
    return lane
  }

  get size() {
    return this.lanes.length
  }
}

/** Step 3: one lane per branch. Returns the lane count. */
function assignLanes(branches: readonly BranchState[], options: ResolvedLayoutOptions): number {
  const occupancy = new Occupancy()
  const byStart = [...branches].sort((a, b) => a.startRow - b.startRow || a.ordinal - b.ordinal)
  const tipsEndingAt = new Map<number, BranchState[]>()
  const place = (branch: BranchState, from: number) => {
    // A root right below an unrelated tip avoids that tip's lane so the two never look connected.
    const excluded = new Set<number>()
    if (options.staggerRoots && branch.parent === null) {
      for (const tip of tipsEndingAt.get(branch.startRow - 1) ?? []) if (tip.lane >= 0) excluded.add(tip.lane)
    }
    branch.lane = occupancy.firstFree(from, branch.startRow, branch.endRow, excluded)
    occupancy.occupy(branch.lane, branch.startRow, branch.endRow)
    if (branch.endedAsTip) {
      const list = tipsEndingAt.get(branch.endRow) ?? []
      list.push(branch)
      tipsEndingAt.set(branch.endRow, list)
    }
  }

  if (options.laneAllocation === "nested") {
    placeNested(
      byStart.filter((b) => b.parent === null),
      -1,
      place,
    )
    return occupancy.size
  }
  for (const branch of byStart) {
    const parentLane = branch.parent?.lane ?? -1
    place(branch, options.laneAllocation === "nearest" && parentLane >= 0 ? parentLane + 1 : 0)
  }
  return occupancy.size
}

/**
 * `"nested"`: depth first over the branch tree. A branch takes the first free lane right of its parent; its
 * sub-branches are placed before its later siblings, and a sibling whose subtree overlaps an earlier
 * sibling's subtree in time starts right of that whole block. Returns the highest lane used by the subtree.
 */
function placeNested(
  siblings: readonly BranchState[],
  parentLane: number,
  place: (branch: BranchState, from: number) => void,
): number {
  let blockMax = parentLane
  const placed: { branch: BranchState; end: number; maxLane: number }[] = []
  for (const branch of siblings) {
    const end = subtreeEnd(branch)
    let from = parentLane + 1
    for (const earlier of placed) {
      if (earlier.branch.startRow <= end && branch.startRow <= earlier.end) from = Math.max(from, earlier.maxLane + 1)
    }
    place(branch, from)
    const children = [...branch.children].sort((a, b) => a.startRow - b.startRow || a.ordinal - b.ordinal)
    const maxLane = Math.max(branch.lane, placeNested(children, branch.lane, place))
    placed.push({ branch, end, maxLane })
    blockMax = Math.max(blockMax, maxLane)
  }
  return blockMax
}

const subtreeEnds = new WeakMap<BranchState, number>()
function subtreeEnd(branch: BranchState): number {
  const cached = subtreeEnds.get(branch)
  if (cached !== undefined) return cached
  let end = branch.endRow
  for (const child of branch.children) end = Math.max(end, subtreeEnd(child))
  subtreeEnds.set(branch, end)
  return end
}

/** Lowest colour slot not used by another branch alive at the same time, in start order. */
function assignColorSlots(branches: readonly BranchState[]) {
  const occupancy = new Occupancy()
  for (const branch of [...branches].sort((a, b) => a.startRow - b.startRow || a.ordinal - b.ordinal)) {
    branch.colorSlot = occupancy.firstFree(0, branch.startRow, branch.endRow)
    occupancy.occupy(branch.colorSlot, branch.startRow, branch.endRow)
  }
}

/** Step 4: cells and links from the row specs and the assigned lanes. */
function buildRows(
  specs: readonly RowSpec[],
  branches: readonly BranchState[],
  routes: ReadonlyMap<string, RouteState>,
): Built {
  const rows = specs.map((spec): DagRow => {
    // A tip's own lane carries no live edge any more, so size the row from every lane it touches.
    const touched = [
      ...spec.live.map(({ branch }) => branch.lane),
      ...(spec.kind === "gap" ? [] : [spec.branch.lane, ...spec.forks.map((b) => b.lane)]),
      ...(spec.kind === "node" ? spec.merges.map((b) => b.lane) : []),
    ]
    const width = touched.reduce((max, lane) => Math.max(max, lane + 1), 0)
    const cells: (LaneCell | null)[] = Array.from({ length: width }, () => null)
    const links: (Link | null)[] = Array.from({ length: Math.max(0, width - 1) }, () => null)
    const edgeOf = new Map<BranchState, EdgeRef>()
    for (const { branch, edge } of spec.live) {
      edgeOf.set(branch, edge)
      cells[branch.lane] = { arms: Arm.PREV | Arm.NEXT, branchId: branch.id, role: "pass", edge }
    }
    if (spec.kind === "gap") return { kind: "gap", index: spec.index, cells, links }

    const own = spec.branch.lane
    const end = (branch: BranchState, vertical: number, role: LaneRole): LaneCell => ({
      arms: vertical | (branch.lane < own ? Arm.HI : Arm.LO),
      branchId: branch.id,
      role,
      edge: need(edgeOf, branch),
    })
    if (spec.kind === "fork") {
      const arms =
        Arm.PREV |
        Arm.NEXT |
        sideArms(
          own,
          spec.forks.map((b) => b.lane),
        )
      cells[own] = { arms, branchId: spec.branch.id, role: "fork-source", edge: need(edgeOf, spec.branch) }
      for (const branch of spec.forks) cells[branch.lane] = end(branch, Arm.NEXT, "fork-target")
      drawBuses(
        cells,
        links,
        own,
        spec.forks.map((b) => b.lane),
      )
      return { kind: "fork", index: spec.index, sourceId: spec.sourceId, cells, links }
    }
    const ends = [...spec.merges, ...spec.forks].map((b) => b.lane)
    const arms = (spec.isRoot ? 0 : Arm.PREV) | (spec.continues ? Arm.NEXT : 0) | sideArms(own, ends)
    cells[own] = { arms, branchId: spec.branch.id, role: "node" }
    for (const branch of spec.merges) cells[branch.lane] = end(branch, Arm.PREV, "merge-source")
    for (const branch of spec.forks) cells[branch.lane] = end(branch, Arm.NEXT, "fork-target")
    drawBuses(cells, links, own, ends)
    return { kind: "node", index: spec.index, nodeId: spec.nodeId, lane: own, branchId: spec.branch.id, cells, links }
  })
  return {
    rows,
    branches: branches.map((b) => ({
      id: b.id,
      ordinal: b.ordinal,
      lane: b.lane,
      startRow: b.startRow,
      endRow: b.endRow,
      headId: b.headId,
      colorSlot: b.colorSlot,
      group: b.group,
      parentId: b.parent?.id,
    })),
    edges: [...routes.values()].map((r) => ({
      parent: r.parent,
      child: r.child,
      lane: r.branch.lane,
      forkRow: r.forkRow,
      mergeRow: r.mergeRow,
    })),
  }
}

function sideArms(own: number, ends: readonly number[]): number {
  let arms = 0
  for (const end of ends) arms |= end < own ? Arm.LO : Arm.HI
  return arms
}

/**
 * Adds the horizontal runs between the node lane and each end lane. Nearer ends are processed first so a
 * farther end overwrites shared links and its long line reads continuous; pass-through lanes become
 * crossings and keep their own branch.
 */
function drawBuses(cells: (LaneCell | null)[], links: (Link | null)[], own: number, ends: readonly number[]) {
  const sorted = [...ends].sort((a, b) => Math.abs(a - own) - Math.abs(b - own))
  for (const end of sorted) {
    const endCell = cells[end]
    if (endCell === null || endCell === undefined || endCell.edge === undefined) continue
    const lo = Math.min(own, end)
    const hi = Math.max(own, end)
    for (let lane = lo + 1; lane < hi; lane++) {
      const cell = cells[lane]
      if (cell === null || cell === undefined) {
        cells[lane] = { arms: Arm.LO | Arm.HI, branchId: endCell.branchId, role: "horizontal", edge: endCell.edge }
        continue
      }
      cells[lane] = { ...cell, arms: cell.arms | Arm.LO | Arm.HI, role: cell.role === "pass" ? "cross" : cell.role }
    }
    for (let lane = lo; lane < hi; lane++) links[lane] = { branchId: endCell.branchId, edge: endCell.edge }
  }
}

function edgeKey(parent: string, child: string): string {
  return `${parent}\u0000${child}`
}

function indexRows(rows: readonly DagRow[]): Map<string, number> {
  const index = new Map<string, number>()
  for (const row of rows) if (row.kind === "node") index.set(row.nodeId, row.index)
  return index
}

/** `direction: "up"`: reverse the rows and swap the time arms. Lanes and links are unaffected. */
function flip(built: Built): Built {
  const last = built.rows.length - 1
  const mirror = (row: number | null) => (row === null ? null : last - row)
  const rows = built.rows
    .slice()
    .reverse()
    .map((row, index) => ({
      ...row,
      index,
      cells: row.cells.map((cell) => (cell === null ? null : { ...cell, arms: swapTimeArms(cell.arms) })),
    }))
  return {
    rows,
    branches: built.branches.map((b) => ({ ...b, startRow: last - b.endRow, endRow: last - b.startRow })),
    edges: built.edges.map((e) => ({ ...e, forkRow: mirror(e.forkRow), mergeRow: mirror(e.mergeRow) })),
  }
}

function swapTimeArms(arms: number): number {
  return (arms & (Arm.LO | Arm.HI)) | (arms & Arm.PREV ? Arm.NEXT : 0) | (arms & Arm.NEXT ? Arm.PREV : 0)
}
