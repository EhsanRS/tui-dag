import { expect, test } from "bun:test"
import { createRaster, layoutNodes, renderToString } from "../../src/index"
import { randomDag } from "../fixtures/random"

test("10k-node layout and full render stay well under a second", () => {
  const nodes = randomDag(42, 10_000, { mergeRate: 0.2, rootRate: 0.02 })
  const t0 = performance.now()
  const layout = layoutNodes(nodes)
  const t1 = performance.now()
  const text = renderToString(layout)
  const t2 = performance.now()
  const raster = createRaster(layout, { selectedId: "n5000" })
  for (let i = 0; i < 50; i++) raster.row(5000 + i)
  const t3 = performance.now()
  console.log(
    `10k nodes: layout ${(t1 - t0).toFixed(1)} ms, full render ${(t2 - t1).toFixed(1)} ms, ` +
      `50 rows with selection ${(t3 - t2).toFixed(1)} ms, lanes ${layout.laneCount}, rows ${layout.rows.length}`,
  )
  expect(layout.rows.length).toBeGreaterThanOrEqual(10_000)
  expect(text.split("\n").length).toBe(layout.rows.length)
  expect(t1 - t0).toBeLessThan(1000)
  expect(t2 - t1).toBeLessThan(1000)
})
