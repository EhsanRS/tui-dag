import { describe, expect, test } from "bun:test"
import { laneOf, layoutNodes, renderToString, type DagNode } from "../../src/index"
import { checkInvariants, checkRoutes } from "../fixtures/checks"

const n = (id: string, parents: string[], time: number): DagNode => ({ id, parents, label: id, time })

/** R forks X, Y, W; Y ends early so lane 1 frees up; then W (lane 2, the rightmost) spawns Z. */
const graph: DagNode[] = [
  n("R", [], 0),
  n("X", ["R"], 1),
  n("Y", ["R"], 2),
  n("W", ["R"], 3),
  n("X2", ["X"], 4),
  n("W2", ["W"], 5),
  n("Z", ["W2"], 6),
  n("W3", ["W2"], 7),
  n("Z2", ["Z"], 8),
  n("W4", ["W3", "Z2"], 9),
  n("X3", ["X2"], 10),
]

describe("laneAllocation", () => {
  test("leftmost reuses the freed lane to the left of the parent", () => {
    const layout = layoutNodes(graph)
    expect(laneOf(layout, "W")).toBe(2)
    expect(laneOf(layout, "Z")).toBe(1)
    checkRoutes(layout)
    checkInvariants(layout)
  })

  test("nearest opens a lane to the right of its parent instead", () => {
    const layout = layoutNodes(graph, { laneAllocation: "nearest", forkStyle: "inline", rowGap: "none" })
    expect(laneOf(layout, "W")).toBe(2)
    expect(laneOf(layout, "Z")).toBe(3)
    checkRoutes(layout)
    checkInvariants(layout)
    expect(renderToString(layout, { labels: false })).toMatchSnapshot()
  })

  test("nearest reuses a lane to the right once it is free", () => {
    // R → B is the trunk (B3 is the newest tip); A forks into lane 1 and ends at A2 before B2 forks C.
    const wide: DagNode[] = [
      n("R", [], 0),
      n("A", ["R"], 1),
      n("B", ["R"], 2),
      n("A2", ["A"], 3),
      n("B2", ["B"], 4),
      n("C", ["B2"], 5),
      n("B3", ["B2"], 6),
    ]
    const layout = layoutNodes(wide, { laneAllocation: "nearest" })
    expect(laneOf(layout, "A")).toBe(1)
    expect(laneOf(layout, "C")).toBe(1)
    checkRoutes(layout)
    checkInvariants(layout)
    expect(layout.laneCount).toBe(2)
  })
})
