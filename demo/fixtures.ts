import {
  Attr,
  type ColorLike,
  type ColorStrategy,
  type DagNode,
  type LabelSpan,
  type LayoutOptions,
} from "../src/index"
import { investigation } from "./investigation"

let order = 0
const node = (id: string, parents: string[], label: string | LabelSpan[], extra: Partial<DagNode> = {}): DagNode => ({
  id,
  parents,
  label,
  time: order++,
  ...extra,
})

const agent = (name: string, text: string): LabelSpan[] => [{ text: name, attrs: Attr.BOLD }, { text: ` ${text}` }]

/** What a fixture produces for a given seed. Static fixtures ignore the seed. */
export interface FixtureData {
  nodes: DagNode[]
  subtitle?: string
  trunk?: string[]
  /** Group names in colour order; used to build `groupColors` from the active palette. */
  groups?: string[]
  /** Explicit group colours derived from the active palette; wins over `groups`. */
  groupColors?: (palette: readonly ColorLike[]) => Record<string, ColorLike>
  colorStrategy?: ColorStrategy
  laneAllocation?: LayoutOptions["laneAllocation"]
}

export interface Fixture {
  name: string
  build: (seed: number) => FixtureData
}

const picture: DagNode[] = [
  node("A", [], "initial prompt"),
  node("B", ["A"], "refine plan"),
  node("D", ["B"], "approach B"),
  node("C", ["B"], "approach A"),
  node("E", ["D"], "B: tests pass"),
  node("F", ["C", "E"], "merge B into A"),
  node("G", ["F"], "final answer"),
]

const session: DagNode[] = [
  node("s1", [], "user: add a DAG view to the sidebar", { group: "main" }),
  node("s2", ["s1"], "plan: recon, then implement", { group: "main" }),
  node("e1", ["s2"], agent("explore", "find the sidebar slot"), { group: "explore" }),
  node("r1", ["s2"], agent("research", "commit-graph algorithms"), { group: "research" }),
  node("s3", ["s2"], "assistant: scaffolding the package", { group: "main" }),
  node("e2", ["e1"], agent("explore", "read theme context"), { group: "explore" }),
  node("r2", ["r1"], agent("research", "git graph.c notes"), { group: "research" }),
  node("t1", ["s3"], agent("tests", "write fixtures"), { group: "tests" }),
  node("s4", ["s3", "e2"], "assistant: wire the slot", { group: "main" }),
  node("t2", ["t1"], agent("tests", "71 passing"), { group: "tests" }),
  node("s5", ["s4", "r2"], "assistant: choose the algorithm", { group: "main" }),
  node("s6", ["s5", "t2"], "assistant: all green", { group: "main" }),
  node("s7", ["s6"], "user: ship it", { group: "main", marker: "current" }),
]

const crissCross: DagNode[] = [
  node("A", [], "A"),
  node("B", ["A"], "B"),
  node("C", ["A"], "C"),
  node("D", ["B", "C"], "D merges C into B"),
  node("E", ["C", "B"], "E merges B into C"),
  node("F", ["D"], "F"),
  node("G", ["E"], "G"),
]

function bigRandom(count: number, seed: number): DagNode[] {
  let state = seed | 0
  const random = () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const nodes: DagNode[] = []
  for (let i = 0; i < count; i++) {
    const wanted = i === 0 || random() < 0.02 ? 0 : random() < 0.15 ? 2 : 1
    const parents = new Set<string>()
    const lo = Math.max(0, i - 12)
    for (let tries = 0; parents.size < wanted && tries < 20; tries++)
      parents.add(`n${lo + Math.floor(random() * (i - lo))}`)
    nodes.push({ id: `n${i}`, parents: [...parents], label: `node ${i}`, time: i, group: `g${i % 5}` })
  }
  return nodes
}

const investigate = (seed: number) => {
  const result = investigation({ seed })
  return {
    nodes: result.nodes,
    subtitle: result.title,
    trunk: result.trunk,
    groupColors: result.groupColors,
    colorStrategy: "group" as const,
    laneAllocation: "nested" as const,
  }
}

export const fixtures: Fixture[] = [
  { name: "spec picture", build: () => ({ nodes: picture }) },
  { name: "session with subagents", build: () => ({ nodes: session, trunk: ["s7"], colorStrategy: "group" }) },
  { name: "investigation: lead, teams, agents", build: investigate },
  { name: "criss-cross", build: () => ({ nodes: crissCross }) },
  { name: "random 3000", build: (seed) => ({ nodes: bigRandom(3000, seed) }) },
]

export const palettes: { name: string; colors: ColorLike[] }[] = [
  { name: "default", colors: ["#7aa2f7", "#f7768e", "#9ece6a", "#e0af68", "#bb9af7", "#7dcfff", "#ff9e64", "#73daca"] },
  { name: "warm", colors: ["#f38ba8", "#fab387", "#f9e2af", "#a6e3a1", "#94e2d5", "#89b4fa", "#cba6f7", "#f5c2e7"] },
  { name: "mono", colors: ["#c0caf5", "#7dcfff", "#3d59a1", "#9aa5ce", "#565f89"] },
]
