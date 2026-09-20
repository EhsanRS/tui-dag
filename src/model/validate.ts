import { MinHeap } from "./heap"
import type { DagNode } from "./types"

/** How {@link validate} treats a parent id that is not in the input. */
export type UnknownParentMode = "error" | "root" | "stub"

export interface ValidateOptions {
  /**
   * `"error"` (default) fails validation. `"root"` drops the missing parent, making the node a root when it
   * has no other parents. `"stub"` inserts a synthetic root with `marker: "stub"` so the edge is drawn as a
   * short dangling line.
   */
  unknownParent?: UnknownParentMode
}

/** One problem found by {@link validate}. Unknown parents are non-fatal in `"root"` and `"stub"` mode. */
export type ValidationIssue =
  | { code: "empty-id"; index: number }
  | { code: "duplicate-id"; id: string; index: number }
  | { code: "unknown-parent"; id: string; parent: string }
  | { code: "cycle"; path: readonly string[] }

/** A validated graph. Everything downstream (layout, raster) works on this, never on raw nodes. */
export interface DagGraph<T = unknown> {
  /** Effective nodes in input order (duplicates removed), followed by any synthetic stub roots. */
  readonly nodes: readonly DagNode<T>[]
  readonly byId: ReadonlyMap<string, DagNode<T>>
  /** Children of each node in topological order. Every id has an entry. */
  readonly children: ReadonlyMap<string, readonly string[]>
  /** Deterministic topological order, parents before children. */
  readonly order: readonly string[]
  /** Ids of synthetic roots created by `unknownParent: "stub"`. */
  readonly stubs: ReadonlySet<string>
}

export type ValidationResult<T = unknown> =
  | { ok: true; graph: DagGraph<T>; issues: readonly ValidationIssue[] }
  | { ok: false; issues: readonly ValidationIssue[] }

/** Thrown by the convenience wrappers (`layoutNodes`, `renderDag`) when validation fails. */
export class DagValidationError extends Error {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super(`invalid DAG: ${issues.map(formatIssue).join("; ")}`)
    this.name = "DagValidationError"
  }
}

/** Human-readable one-liner for an issue. */
export function formatIssue(issue: ValidationIssue): string {
  if (issue.code === "empty-id") return `node at index ${issue.index} has an empty id`
  if (issue.code === "duplicate-id") return `duplicate id "${issue.id}" at index ${issue.index}`
  if (issue.code === "unknown-parent") return `node "${issue.id}" references unknown parent "${issue.parent}"`
  return `cycle: ${issue.path.join(" -> ")}`
}

interface SortKey {
  time: number
  index: number
}

/**
 * Validates nodes and computes a deterministic topological order. Never throws.
 *
 * Ordering: Kahn's algorithm with a min-heap keyed by `(time, input index)`. Nodes without `time` sort after
 * timed nodes, by input order. Duplicate parent entries on one node are collapsed. Fatal issues (empty or
 * duplicate ids, cycles, unknown parents in `"error"` mode) give `ok: false`.
 */
export function validate<T>(input: readonly DagNode<T>[], options: ValidateOptions = {}): ValidationResult<T> {
  const mode = options.unknownParent ?? "error"
  const fatal: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  const byInput = new Map<string, { node: DagNode<T>; index: number }>()
  input.forEach((node, index) => {
    if (node.id === "") {
      fatal.push({ code: "empty-id", index })
      return
    }
    if (byInput.has(node.id)) {
      fatal.push({ code: "duplicate-id", id: node.id, index })
      return
    }
    byInput.set(node.id, { node, index })
  })

  const effective = new Map<string, DagNode<T>>()
  const keys = new Map<string, SortKey>()
  const stubs = new Set<string>()

  for (const entry of byInput.values()) {
    const node = entry.node
    keys.set(node.id, { time: timeOf(node), index: entry.index })
    const seen = new Set<string>()
    const parents: string[] = []
    for (const parent of node.parents) {
      if (seen.has(parent)) continue
      seen.add(parent)
      if (byInput.has(parent) || stubs.has(parent)) {
        parents.push(parent)
        continue
      }
      if (mode === "error") {
        fatal.push({ code: "unknown-parent", id: node.id, parent })
        continue
      }
      warnings.push({ code: "unknown-parent", id: node.id, parent })
      if (mode === "root") continue
      stubs.add(parent)
      effective.set(parent, { id: parent, parents: [], marker: "stub" })
      // Sort just before the first child that references the stub.
      keys.set(parent, { time: timeOf(node), index: entry.index - 0.5 })
      parents.push(parent)
    }
    const unchanged = parents.length === node.parents.length && parents.every((p, i) => p === node.parents[i])
    effective.set(node.id, unchanged ? node : { ...node, parents })
  }

  const ids = [...effective.keys()]
  const indegree = new Map(ids.map((id) => [id, need(effective, id).parents.length]))
  const dependants = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const node of effective.values()) {
    for (const parent of node.parents) need(dependants, parent).push(node.id)
  }

  const heap = new MinHeap<string>((a, b) => before(need(keys, a), need(keys, b)))
  for (const id of ids) if (indegree.get(id) === 0) heap.push(id)

  const order: string[] = []
  const children = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (let id = heap.pop(); id !== undefined; id = heap.pop()) {
    order.push(id)
    for (const parent of need(effective, id).parents) need(children, parent).push(id)
    for (const child of need(dependants, id)) {
      const left = need(indegree, child) - 1
      indegree.set(child, left)
      if (left === 0) heap.push(child)
    }
  }

  if (order.length < ids.length) {
    const remaining = new Set(ids.filter((id) => need(indegree, id) > 0))
    fatal.push({ code: "cycle", path: findCycle(remaining, effective) })
  }

  if (fatal.length > 0) return { ok: false, issues: [...fatal, ...warnings] }

  const nodes = [...byInput.values()].map((entry) => need(effective, entry.node.id))
  for (const id of stubs) nodes.push(need(effective, id))
  return {
    ok: true,
    graph: { nodes, byId: effective, children, order, stubs },
    issues: warnings,
  }
}

function timeOf(node: DagNode): number {
  return node.time !== undefined && Number.isFinite(node.time) ? node.time : Number.POSITIVE_INFINITY
}

function before(a: SortKey, b: SortKey): boolean {
  if (a.time !== b.time) return a.time < b.time
  return a.index < b.index
}

/** Follows parents inside the unsorted remainder until a node repeats; that repeat closes the cycle. */
function findCycle(remaining: ReadonlySet<string>, nodes: ReadonlyMap<string, DagNode>): string[] {
  const start = [...remaining][0]
  if (start === undefined) return []
  const position = new Map<string, number>()
  const path: string[] = []
  let current = start
  while (!position.has(current)) {
    position.set(current, path.length)
    path.push(current)
    const next = need(nodes, current).parents.find((p) => remaining.has(p))
    if (next === undefined) return path
    current = next
  }
  return [...path.slice(need(position, current)), current]
}

/** Map lookup for keys that are known to exist. Internal invariant, not input validation. */
export function need<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key)
  if (value === undefined) throw new Error(`internal: missing key ${String(key)}`)
  return value
}
