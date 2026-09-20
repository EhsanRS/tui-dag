import type { DagNode } from "../model/types"
import type { DagGraph } from "../model/validate"

/**
 * Arms of a lane cell, in time/lane terms so the same rows can be drawn vertically or horizontally.
 * `PREV`/`NEXT` point toward the earlier/later step (up/down when time flows down); `LO`/`HI` point toward
 * the lower/higher lane index (left/right).
 */
export const Arm = { PREV: 1, NEXT: 2, LO: 4, HI: 8 } as const

/** What a lane cell is, beyond its arms. */
export type LaneRole = "node" | "pass" | "cross" | "horizontal" | "fork-source" | "fork-target" | "merge-source"

export interface EdgeRef {
  readonly parent: string
  readonly child: string
}

/** One lane of one row. `null` in a row's `cells` means the lane is empty on that row. */
export interface LaneCell {
  /** Bitmask of {@link Arm}. */
  readonly arms: number
  readonly branchId: string
  readonly role: LaneRole
  /** The edge this cell carries. Absent on node cells. */
  readonly edge?: EdgeRef
}

/** A horizontal segment between lane `i` and lane `i + 1`. */
export interface Link {
  readonly branchId: string
  readonly edge: EdgeRef
}

interface RowBase {
  readonly index: number
  /** One entry per lane that existed on this row; rows can have different lengths. */
  readonly cells: readonly (LaneCell | null)[]
  /** `links[i]` is the segment between lanes `i` and `i + 1`. */
  readonly links: readonly (Link | null)[]
}

export interface NodeRow extends RowBase {
  readonly kind: "node"
  readonly nodeId: string
  readonly lane: number
  readonly branchId: string
}

/** Connector row drawn after a node whose children start new lanes (`forkStyle: "row"`). */
export interface ForkRow extends RowBase {
  readonly kind: "fork"
  readonly sourceId: string
}

/** Spacer row of pass-through lanes (see `rowGap`). */
export interface GapRow extends RowBase {
  readonly kind: "gap"
}

export type DagRow = NodeRow | ForkRow | GapRow

/** A lane occupancy episode: one colour, one column, from `startRow` to `endRow` inclusive. */
export interface Branch {
  readonly id: string
  /** Creation order, 0-based. */
  readonly ordinal: number
  readonly lane: number
  readonly startRow: number
  readonly endRow: number
  /** The node this branch leads to: its first node, or the merge target when the branch carries only an edge. */
  readonly headId: string
  /** Lowest colour slot not used by another live branch when this one opened. */
  readonly colorSlot: number
  readonly group?: string
  /** The branch this one forked from; absent for roots. */
  readonly parentId?: string
}

/** How one parent → child edge is drawn. The test oracle for connectivity. */
export interface EdgeRoute extends EdgeRef {
  /** Lane of the vertical part. */
  readonly lane: number
  /** Row of the fork connector (`null` when the child continues the parent's lane or forks inline). */
  readonly forkRow: number | null
  /** Row where the edge merges into the child's lane (`null` when the child sits in `lane`). */
  readonly mergeRow: number | null
}

export interface LayoutOptions {
  /** `"down"` (default): oldest at the top. `"up"`: oldest at the bottom. */
  direction?: "down" | "up"
  /** `"row"` (default): `├─╮` on its own row after the parent. `"inline"`: drawn on the parent's row. */
  forkStyle?: "row" | "inline"
  /**
   * `"auto"` (default): a `│` row between two nodes when the second directly continues the first one's lane.
   * `"always"`: after every node row not followed by a fork row. `"none"`: never.
   */
  rowGap?: "auto" | "none" | "always"
  /** Ids whose first-parent chains claim their lanes first, e.g. the main session's tip. */
  trunk?: readonly string[]
  /**
   * Where a forked branch goes. `"leftmost"` (default) takes the leftmost lane that is free for the branch's
   * whole lifetime, which keeps the graph narrow. `"nearest"` takes the first such lane to the right of the
   * parent, opening a new lane when there is none. `"nested"` places the branch tree depth first: a branch's
   * sub-branches sit right of it and before its later siblings, so a team's agents form a block next to the
   * team and a later team starts right of that block while the two overlap in time.
   */
  laneAllocation?: "leftmost" | "nearest" | "nested"
  /**
   * Avoid placing a root directly under an unrelated tip in the same lane. Defaults to `true` only for
   * `rowGap: "none"`; with gap rows, vertically adjacent nodes are never connected, so no stagger is needed.
   */
  staggerRoots?: boolean
}

export interface ResolvedLayoutOptions {
  readonly direction: "down" | "up"
  readonly forkStyle: "row" | "inline"
  readonly rowGap: "auto" | "none" | "always"
  readonly trunk: readonly string[]
  readonly staggerRoots: boolean
  readonly laneAllocation: "leftmost" | "nearest" | "nested"
}

/** Plain-data result of {@link layoutDag}. Use {@link rowOf}, {@link nodeAt} and {@link laneOf} to query it. */
export interface DagLayout<T = unknown> {
  readonly graph: DagGraph<T>
  readonly options: ResolvedLayoutOptions
  /** Rows in display order for `options.direction`. */
  readonly rows: readonly DagRow[]
  /** Maximum number of lanes used by any row. */
  readonly laneCount: number
  readonly branches: readonly Branch[]
  readonly edges: readonly EdgeRoute[]
  /** Node id → row index. */
  readonly rowIndex: ReadonlyMap<string, number>
  /** Node id → the child that continues its lane (first-parent chains). */
  readonly continuation: ReadonlyMap<string, string>
}

/** Row index of a node, or `undefined` for unknown ids. */
export function rowOf(layout: DagLayout, id: string): number | undefined {
  return layout.rowIndex.get(id)
}

/** The node drawn on a row, or `undefined` for connector rows and out-of-range indices. */
export function nodeAt<T>(layout: DagLayout<T>, row: number): DagNode<T> | undefined {
  const entry = layout.rows[row]
  if (entry === undefined || entry.kind !== "node") return undefined
  return layout.graph.byId.get(entry.nodeId)
}

/** Lane of a node, or `undefined` for unknown ids. */
export function laneOf(layout: DagLayout, id: string): number | undefined {
  const row = layout.rowIndex.get(id)
  if (row === undefined) return undefined
  const entry = layout.rows[row]
  return entry?.kind === "node" ? entry.lane : undefined
}
