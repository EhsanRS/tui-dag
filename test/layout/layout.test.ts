import { describe, expect, test } from "bun:test"
import {
  Arm,
  laneOf,
  layoutDag,
  layoutNodes,
  nodeAt,
  graphemes,
  renderToString,
  rowOf,
  validate,
  type DagNode,
  type LayoutOptions,
} from "../../src/index"
import { checkInvariants, checkRoutes } from "../fixtures/checks"
import { all, cycle, picture, sideBranchNewer, twoRoots } from "../fixtures/index"
import { randomDag } from "../fixtures/random"

function graphOf(nodes: DagNode[]) {
  const result = validate(nodes, { unknownParent: "stub" })
  if (!result.ok) throw new Error("fixture must validate")
  return result.graph
}

describe("layoutDag on the picture", () => {
  const layout = layoutNodes(picture)

  test("lanes: main line straight in lane 0, branch in lane 1", () => {
    for (const id of ["A", "B", "C", "F", "G"]) expect(laneOf(layout, id), id).toBe(0)
    for (const id of ["D", "E"]) expect(laneOf(layout, id), id).toBe(1)
    expect(layout.laneCount).toBe(2)
  })

  test("row kinds follow the picture", () => {
    expect(layout.rows.map((row) => (row.kind === "node" ? row.nodeId : row.kind))).toEqual([
      "A",
      "gap",
      "B",
      "fork",
      "D",
      "C",
      "E",
      "F",
      "gap",
      "G",
    ])
  })

  test("edge routes", () => {
    const route = (parent: string, child: string) => layout.edges.find((e) => e.parent === parent && e.child === child)
    expect(route("B", "D")).toEqual({ parent: "B", child: "D", lane: 1, forkRow: 3, mergeRow: null })
    expect(route("E", "F")).toEqual({ parent: "E", child: "F", lane: 1, forkRow: null, mergeRow: 7 })
    expect(route("C", "F")).toEqual({ parent: "C", child: "F", lane: 0, forkRow: null, mergeRow: null })
    checkRoutes(layout)
    checkInvariants(layout)
  })

  test("continuation follows first parents from the tip", () => {
    expect([...layout.continuation]).toEqual([
      ["F", "G"],
      ["C", "F"],
      ["B", "C"],
      ["A", "B"],
      ["D", "E"],
    ])
  })

  test("branches: two, with distinct colour slots", () => {
    expect(layout.branches.map((b) => [b.lane, b.colorSlot, b.headId])).toEqual([
      [0, 0, "A"],
      [1, 1, "D"],
    ])
  })

  test("helpers", () => {
    expect(rowOf(layout, "D")).toBe(4)
    expect(nodeAt(layout, 4)?.label).toBe("approach B")
    expect(nodeAt(layout, 3)).toBeUndefined()
    expect(rowOf(layout, "nope")).toBeUndefined()
    expect(laneOf(layout, "nope")).toBeUndefined()
  })
})

describe("layout options", () => {
  test("inline forks with no gaps give one row per node", () => {
    const layout = layoutNodes(picture, { forkStyle: "inline", rowGap: "none" })
    expect(layout.rows.length).toBe(picture.length)
    expect(layout.rows.every((row) => row.kind === "node")).toBe(true)
    checkRoutes(layout)
    checkInvariants(layout)
  })

  test("rowGap always adds a gap after every node row not followed by a fork row", () => {
    const layout = layoutNodes(picture, { rowGap: "always" })
    const kinds = layout.rows.map((row) => row.kind)
    expect(kinds).toEqual([
      "node",
      "gap",
      "node",
      "fork",
      "node",
      "gap",
      "node",
      "gap",
      "node",
      "gap",
      "node",
      "gap",
      "node",
    ])
  })

  test("direction up reverses rows and swaps the time arms", () => {
    const down = layoutNodes(picture)
    const up = layoutNodes(picture, { direction: "up" })
    expect(up.rows.length).toBe(down.rows.length)
    const last = down.rows.length - 1
    down.rows.forEach((row, i) => {
      const mirrored = up.rows[last - i]
      expect(mirrored?.kind).toBe(row.kind)
      expect(mirrored?.index).toBe(last - i)
      row.cells.forEach((cell, lane) => {
        const other = mirrored?.cells[lane]
        if (cell === null) {
          expect(other).toBeNull()
          return
        }
        const swapped =
          (cell.arms & (Arm.LO | Arm.HI)) |
          (cell.arms & Arm.PREV ? Arm.NEXT : 0) |
          (cell.arms & Arm.NEXT ? Arm.PREV : 0)
        expect(other?.arms).toBe(swapped)
        expect(other?.branchId).toBe(cell.branchId)
      })
    })
    expect(rowOf(up, "A")).toBe(last)
    const route = up.edges.find((e) => e.child === "D")
    expect(route?.forkRow).toBe(last - 3)
  })

  test("trunk pins the main line when a side branch is newer", () => {
    const byTip = layoutNodes(sideBranchNewer)
    expect(laneOf(byTip, "C1")).toBe(0)
    expect(laneOf(byTip, "P3")).toBe(1)
    const pinned = layoutNodes(sideBranchNewer, { trunk: ["P3"] })
    expect(laneOf(pinned, "P3")).toBe(0)
    expect(laneOf(pinned, "C1")).toBe(1)
    checkRoutes(pinned)
  })

  test("roots are staggered only without gap rows", () => {
    const compact = layoutNodes(twoRoots, { rowGap: "none" })
    expect(laneOf(compact, "Z")).toBe(1)
    const spaced = layoutNodes(twoRoots)
    expect(laneOf(spaced, "Z")).toBe(0)
    const forced = layoutNodes(twoRoots, { staggerRoots: true })
    expect(laneOf(forced, "Z")).toBe(1)
  })

  test("layoutNodes throws on invalid input, layoutDag never validates", () => {
    expect(() => layoutNodes(cycle)).toThrow(/cycle/)
  })

  test("stub roots occupy the child's lane", () => {
    const layout = layoutNodes([{ id: "x", parents: ["m"] }], { unknownParent: "stub" })
    expect(laneOf(layout, "m")).toBe(0)
    expect(layout.graph.stubs.has("m")).toBe(true)
    checkRoutes(layout)
  })
})

describe("fixtures", () => {
  for (const [name, nodes] of Object.entries(all)) {
    test(`${name}: routes connect and invariants hold in every style`, () => {
      const variants: LayoutOptions[] = [{}, { forkStyle: "inline", rowGap: "none" }, { rowGap: "always" }]
      for (const options of variants) {
        const layout = layoutDag(graphOf(nodes), options)
        checkRoutes(layout)
        checkInvariants(layout)
      }
    })
  }
})

describe("random graphs", () => {
  const seeds = Array.from({ length: 60 }, (_, i) => i + 1)

  test("deterministic", () => {
    for (const seed of seeds.slice(0, 20)) {
      const nodes = randomDag(seed, 80)
      const a = layoutDag(graphOf(nodes))
      const b = layoutDag(graphOf(nodes.map((node) => ({ ...node, parents: [...node.parents] }))))
      expect(a.rows).toEqual(b.rows)
      expect(renderToString(a)).toBe(renderToString(b))
    }
  })

  test("every edge is a connected path; lanes never shared; first-parent chains straight", () => {
    for (const seed of seeds) {
      const nodes = randomDag(seed, 60 + (seed % 7) * 10, { mergeRate: 0.3, rootRate: 0.05 })
      for (const options of [{}, { forkStyle: "inline" as const, rowGap: "none" as const }]) {
        const layout = layoutDag(graphOf(nodes), options)
        checkRoutes(layout)
        checkInvariants(layout)
      }
    }
  })

  test("up is the mirror of down", () => {
    for (const seed of seeds.slice(0, 15)) {
      const nodes = randomDag(seed, 50)
      const down = renderToString(layoutDag(graphOf(nodes)))
      const up = renderToString(layoutDag(graphOf(nodes), { direction: "up" }))
      const mirror: Record<string, string> = { "╭": "╰", "╰": "╭", "╮": "╯", "╯": "╮", "┬": "┴", "┴": "┬" }
      const flipped = up
        .split("\n")
        .reverse()
        .map((line) =>
          graphemes(line)
            .map((ch) => mirror[ch] ?? ch)
            .join(""),
        )
        .join("\n")
      expect(flipped).toBe(down)
    }
  })

  test("lane count stays near the number of concurrent edges", () => {
    const nodes = randomDag(7, 400, { mergeRate: 0.25 })
    const layout = layoutDag(graphOf(nodes))
    const maxLive = Math.max(...layout.rows.map((row) => row.cells.filter((c) => c !== null).length))
    expect(layout.laneCount).toBeLessThanOrEqual(maxLive + 1)
  })
})
