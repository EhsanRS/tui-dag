import { describe, expect, test } from "bun:test"
import { laneOf, layoutDag, layoutNodes, renderToString, validate, type DagNode } from "../../src/index"
import { checkInvariants, checkRoutes } from "../fixtures/checks"
import { randomDag } from "../fixtures/random"

const n = (id: string, parents: string[], time: number, group?: string): DagNode => ({
  id,
  parents,
  label: id,
  time,
  group,
})

/**
 * Lead L assigns team A, A spawns agents a1/a2 (a2 merges back early), then L assigns team B while A's
 * agent a1 is still running; B spawns b1. Everything merges into the final F.
 */
const teams: DagNode[] = [
  n("L0", [], 0, "lead"),
  n("LA", ["L0"], 1, "lead"),
  n("A1", ["LA"], 2, "A"),
  n("a1", ["A1"], 3, "A"),
  n("a2", ["A1"], 3.5, "A"),
  n("A1b", ["A1", "a2"], 3.7, "A"),
  n("LB", ["LA"], 4, "lead"),
  n("B1", ["LB"], 5, "B"),
  n("a1b", ["a1"], 6, "A"),
  n("A2", ["A1b", "a1b"], 7, "A"),
  n("b1", ["B1"], 8, "B"),
  n("B2", ["B1", "b1"], 9, "B"),
  n("F", ["LB", "A2", "B2"], 10, "lead"),
]

describe("laneAllocation: nested", () => {
  test("a later team starts right of the earlier team's whole block", () => {
    const leftmost = layoutNodes(teams)
    expect(laneOf(leftmost, "A1")).toBe(1)
    expect(laneOf(leftmost, "B1")).toBe(3)

    const nested = layoutNodes(teams, { laneAllocation: "nested" })
    expect(laneOf(nested, "L0")).toBe(0)
    expect(laneOf(nested, "F")).toBe(0)
    expect(laneOf(nested, "A1")).toBe(1)
    expect(laneOf(nested, "a1")).toBe(2)
    expect(laneOf(nested, "a2")).toBe(3)
    expect(laneOf(nested, "B1")).toBe(4)
    expect(laneOf(nested, "b1")).toBe(5)
    checkRoutes(nested)
    checkInvariants(nested)
    expect(renderToString(nested)).toMatchSnapshot()
  })

  test("branches record their parent branch", () => {
    const nested = layoutNodes(teams, { laneAllocation: "nested" })
    const lead = nested.branches.find((b) => b.lane === 0)
    const teamA = nested.branches.find((b) => b.headId === "A1")
    const agent = nested.branches.find((b) => b.headId === "a1")
    expect(lead?.parentId).toBeUndefined()
    expect(teamA?.parentId).toBe(lead?.id)
    expect(agent?.parentId).toBe(teamA?.id)
  })

  test("is valid and deterministic on random graphs", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const nodes = randomDag(seed, 70, { mergeRate: 0.3, rootRate: 0.05 })
      const result = validate(nodes)
      if (!result.ok) throw new Error("fixture must validate")
      const layout = layoutDag(result.graph, { laneAllocation: "nested" })
      checkRoutes(layout)
      checkInvariants(layout)
      expect(layoutDag(result.graph, { laneAllocation: "nested" }).rows).toEqual(layout.rows)
    }
  })
})
