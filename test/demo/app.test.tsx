/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { App } from "../../demo/app"

test("demo app renders, switches fixtures and styles, and exits through the renderer", async () => {
  const setup = await testRender(() => <App />, { width: 170, height: 32 })
  try {
    await setup.renderOnce()
    const first = setup.captureCharFrame()
    expect(first).toContain("opentui-dag")
    expect(first).toContain("initial prompt")
    expect(first).toContain("├─╮")

    setup.mockInput.pressKey("ARROW_DOWN")
    setup.mockInput.pressKey("ARROW_DOWN")
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("selected B")

    setup.mockInput.pressKey("g")
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("├─┐")

    setup.mockInput.pressKey("c")
    await setup.renderOnce()
    expect(setup.captureCharFrame()).not.toContain("├─┐")

    setup.mockInput.pressKey("2")
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("session with subagents")
    expect(setup.captureCharFrame()).toContain("explore")

    setup.mockInput.pressKey("3")
    await setup.renderOnce()
    const investigation = setup.captureCharFrame()
    expect(investigation).toContain("investigation: lead, teams, agents")
    expect(investigation).toContain("kickoff")
    expect(investigation).toContain("(nested)")
    setup.mockInput.pressKey("r")
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("seed 2")
    // The fixture already defaults to nested, so the first press is a no-op override; the second is nearest.
    setup.mockInput.pressKey("a")
    setup.mockInput.pressKey("a")
    setup.mockInput.pressKey("o")
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("(nearest)")

    setup.mockInput.pressKey("5")
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("3000 nodes")

    setup.mockInput.pressKey("d")
    setup.mockInput.pressKey("p")
    await setup.renderOnce()

    setup.mockInput.pressKey("q")
    expect(setup.renderer.isDestroyed).toBe(true)
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
  }
})
