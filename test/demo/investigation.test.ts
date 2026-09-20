import { describe, expect, test } from "bun:test"
import { laneOf, layoutNodes, renderToString, validate } from "../../src/index"
import { investigation } from "../../demo/investigation"
import { checkInvariants, checkRoutes } from "../fixtures/checks"

describe("investigation generator", () => {
  test("produces valid DAGs for many seeds in both check-in modes", () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const checkIn of ["report", "rejoin"] as const) {
        const result = investigation({ seed, checkIn })
        expect(validate(result.nodes).ok, `seed ${seed} ${checkIn}`).toBe(true)
        expect(result.teams.length).toBeGreaterThanOrEqual(2)
        expect(result.teams.length).toBeLessThanOrEqual(6)
        const layout = layoutNodes(result.nodes, { trunk: result.trunk, laneAllocation: "nested" })
        checkRoutes(layout)
        checkInvariants(layout)
        for (const node of result.nodes) if (node.group === "lead") expect(laneOf(layout, node.id), node.id).toBe(0)
      }
    }
  })

  test("report edges keep the team's group so they draw in the team colour", () => {
    const result = investigation({ seed: 5, teams: 3 })
    const layout = layoutNodes(result.nodes, { trunk: result.trunk, laneAllocation: "nested" })
    const reports = layout.edges.filter((e) => e.parent.includes("-report-") && e.child.startsWith("lead-checkin"))
    expect(reports.length).toBeGreaterThan(0)
    for (const edge of reports) {
      const branch = layout.branches.find((b) => b.lane === edge.lane && b.startRow === edge.forkRow)
      expect(branch?.group, `${edge.parent} -> ${edge.child}`).toBe(edge.parent.split("-report-")[0])
    }
  })

  test("with report check-ins every team keeps one lane", () => {
    const result = investigation({ seed: 5, teams: 4 })
    const layout = layoutNodes(result.nodes, { trunk: result.trunk, laneAllocation: "nested" })
    for (const team of result.teams) {
      const lanes = new Set(
        result.nodes
          .filter((node) => node.group === team && !node.id.includes("-a"))
          .map((node) => laneOf(layout, node.id)),
      )
      expect(lanes.size, team).toBe(1)
    }
  })

  test("renders a stable picture for a fixed seed", () => {
    const result = investigation({ seed: 7, teams: 3 })
    const text = renderToString(layoutNodes(result.nodes, { trunk: result.trunk, laneAllocation: "nested" }))
    expect(text).toMatchSnapshot()
    expect(text).toContain("kickoff")
    expect(text).toContain("assigns genomics")
    expect(text).toContain("final report")
    expect(text).toContain("○")
  })
})
