import type { DagNode } from "../../src/index"

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface RandomDagOptions {
  /** Probability that a non-first node is a new root. */
  rootRate?: number
  /** Probability that a node has more than one parent. */
  mergeRate?: number
  maxParents?: number
  /** Parents are picked from this many preceding nodes. */
  window?: number
}

/** Random DAG whose input order is already topological (parents precede children). */
export function randomDag(seed: number, count: number, options: RandomDagOptions = {}): DagNode[] {
  const random = rng(seed)
  const rootRate = options.rootRate ?? 0.03
  const mergeRate = options.mergeRate ?? 0.2
  const maxParents = options.maxParents ?? 3
  const window = options.window ?? 25
  const nodes: DagNode[] = []
  for (let i = 0; i < count; i++) {
    const wantParents =
      i === 0 || random() < rootRate ? 0 : random() < mergeRate ? 2 + Math.floor(random() * (maxParents - 1)) : 1
    const parents = new Set<string>()
    const lo = Math.max(0, i - window)
    for (let tries = 0; parents.size < wantParents && tries < 20; tries++) {
      parents.add(`n${lo + Math.floor(random() * (i - lo))}`)
    }
    nodes.push({ id: `n${i}`, parents: [...parents], label: `node ${i}`, time: i, group: `g${i % 4}` })
  }
  return nodes
}
