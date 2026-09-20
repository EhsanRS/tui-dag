import { expect } from "bun:test"
import { Arm, laneOf, rowOf, type DagLayout } from "../../src/index"

/** Checks that every edge route is a connected path of cells with the right arms and edge identity. */
export function checkRoutes(layout: DagLayout) {
  const rows = layout.rows
  const toward = (from: number, to: number) => (to < from ? Arm.LO : Arm.HI)
  for (const edge of layout.edges) {
    const parentRow = rowOf(layout, edge.parent) ?? -1
    const childRow = rowOf(layout, edge.child) ?? -1
    const parentLane = laneOf(layout, edge.parent) ?? -1
    const childLane = laneOf(layout, edge.child) ?? -1
    const lane = edge.lane
    const label = `${edge.parent}->${edge.child}`
    expect(parentRow, label).toBeLessThan(childRow)

    const start = edge.forkRow ?? parentRow
    if (edge.forkRow === null) {
      expect(lane, `${label} continues the parent's lane`).toBe(parentLane)
      const cell = rows[parentRow]?.cells[lane]
      expect(cell?.role, label).toBe("node")
      expect((cell?.arms ?? 0) & Arm.NEXT, `${label} parent has NEXT`).toBeTruthy()
    } else {
      expect(edge.forkRow, label).toBeGreaterThanOrEqual(parentRow)
      const row = rows[edge.forkRow]
      const target = row?.cells[lane]
      expect(target?.role, `${label} fork target`).toBe("fork-target")
      expect(target?.edge, label).toEqual({ parent: edge.parent, child: edge.child })
      expect((target?.arms ?? 0) & Arm.NEXT, label).toBeTruthy()
      expect((target?.arms ?? 0) & toward(lane, parentLane), `${label} target arm toward parent`).toBeTruthy()
      const source = row?.cells[parentLane]
      expect(source?.role, `${label} fork source`).toBe(row?.kind === "fork" ? "fork-source" : "node")
      expect((source?.arms ?? 0) & toward(parentLane, lane), `${label} source arm toward target`).toBeTruthy()
      for (let k = Math.min(lane, parentLane); k < Math.max(lane, parentLane); k++) {
        expect(row?.links[k], `${label} link ${k} on fork row`).not.toBeNull()
      }
    }

    const end = edge.mergeRow ?? childRow
    for (let r = start + 1; r < end; r++) {
      const cell = rows[r]?.cells[lane]
      expect(cell?.edge, `${label} passes row ${r}`).toEqual({ parent: edge.parent, child: edge.child })
      expect((cell?.arms ?? 0) & (Arm.PREV | Arm.NEXT), `${label} vertical at row ${r}`).toBe(Arm.PREV | Arm.NEXT)
    }

    if (edge.mergeRow === null) {
      expect(lane, `${label} ends in the child's lane`).toBe(childLane)
      const cell = rows[childRow]?.cells[lane]
      expect(cell?.role, label).toBe("node")
      expect((cell?.arms ?? 0) & Arm.PREV, `${label} child has PREV`).toBeTruthy()
    } else {
      expect(edge.mergeRow, label).toBe(childRow)
      const row = rows[childRow]
      const source = row?.cells[lane]
      expect(source?.role, `${label} merge source`).toBe("merge-source")
      expect(source?.edge, label).toEqual({ parent: edge.parent, child: edge.child })
      expect((source?.arms ?? 0) & Arm.PREV, label).toBeTruthy()
      expect((source?.arms ?? 0) & toward(lane, childLane), `${label} source arm toward child`).toBeTruthy()
      expect(
        (row?.cells[childLane]?.arms ?? 0) & toward(childLane, lane),
        `${label} child arm toward source`,
      ).toBeTruthy()
      for (let k = Math.min(lane, childLane); k < Math.max(lane, childLane); k++) {
        expect(row?.links[k], `${label} link ${k} on merge row`).not.toBeNull()
      }
    }
  }
}

export function checkInvariants(layout: DagLayout) {
  const graph = layout.graph
  expect(layout.edges.length).toBe(graph.nodes.reduce((sum, node) => sum + node.parents.length, 0))
  expect(layout.rows.filter((row) => row.kind === "node").length).toBe(graph.nodes.length)
  layout.rows.forEach((row, i) => {
    expect(row.index).toBe(i)
    expect(row.cells.length).toBeLessThanOrEqual(layout.laneCount)
    expect(row.links.length).toBe(Math.max(0, row.cells.length - 1))
    if (row.kind === "node") {
      expect(rowOf(layout, row.nodeId)).toBe(i)
      expect(row.cells[row.lane]?.role).toBe("node")
    }
  })
  for (const [parent, child] of layout.continuation) {
    expect(laneOf(layout, child), `${child} continues ${parent}`).toBe(laneOf(layout, parent) ?? -1)
  }
  for (const branch of layout.branches) {
    expect(branch.startRow).toBeLessThanOrEqual(branch.endRow)
    expect(branch.lane).toBeLessThan(layout.laneCount)
  }
}
