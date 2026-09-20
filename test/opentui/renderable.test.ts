import { RGBA, ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { describe, expect, test } from "bun:test"
import { Attr, createRaster, defaultPalette, layoutNodes, renderToString, type DagNode } from "../../src/index"
import { DagRenderable, type DagViewOptions } from "../../src/opentui/index"
import { cycle, linear, picture } from "../fixtures/index"
import { randomDag } from "../fixtures/random"

const trimmed = (frame: string) => frame.split("\n").map((line) => line.replace(/\s+$/, ""))

async function mount(nodes: readonly DagNode[], options: Partial<DagViewOptions> = {}, width = 40, height = 12) {
  const setup = await createTestRenderer({ width, height })
  const view = new DagRenderable(setup.renderer, { nodes, ...options })
  setup.renderer.root.add(view)
  await setup.renderOnce()
  return { setup, view }
}

const hex = (rgba: RGBA) =>
  "#" +
  rgba
    .toInts()
    .slice(0, 3)
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")

describe("DagRenderable", () => {
  test("Attr bits match TextAttributes", () => {
    expect<number>(Attr.BOLD).toBe(TextAttributes.BOLD)
    expect<number>(Attr.DIM).toBe(TextAttributes.DIM)
    expect<number>(Attr.INVERSE).toBe(TextAttributes.INVERSE)
    expect<number>(Attr.STRIKETHROUGH).toBe(TextAttributes.STRIKETHROUGH)
  })

  test("constructs with only an id and draws nothing", async () => {
    const setup = await createTestRenderer({ width: 20, height: 5 })
    try {
      const view = new DagRenderable(setup.renderer, { id: "empty" })
      setup.renderer.root.add(view)
      await setup.renderOnce()
      expect(view.layout?.rows.length).toBe(0)
      expect(trimmed(setup.captureCharFrame()).join("")).toBe("")
    } finally {
      setup.renderer.destroy()
    }
  })

  test("frame equals renderToString and size comes from the measure function", async () => {
    // alignSelf keeps the flex column from stretching the view to the terminal width.
    const { setup, view } = await mount(picture, { alignSelf: "flex-start" })
    try {
      const layout = layoutNodes(picture)
      const expected = renderToString(layout).split("\n")
      expect(trimmed(setup.captureCharFrame()).slice(0, expected.length)).toEqual(expected)
      expect(view.width).toBe(createRaster(layout).width)
      expect(view.height).toBe(layout.rows.length)
    } finally {
      setup.renderer.destroy()
    }
  })

  test("connector colours follow the branch", async () => {
    const { setup } = await mount(picture)
    try {
      const line = setup.captureSpans().lines[3]
      const spans = line?.spans.filter((s) => s.text.trim() !== "") ?? []
      expect(spans.map((s) => s.text)).toEqual(["├", "─╮"])
      const palette = defaultPalette.map((c) => (typeof c === "string" ? c : ""))
      expect(hex(spans[0]!.fg)).toBe(palette[0] ?? "")
      expect(hex(spans[1]!.fg)).toBe(palette[1] ?? "")
    } finally {
      setup.renderer.destroy()
    }
  })

  test("setters update the drawing without recreating anything", async () => {
    const { setup, view } = await mount(picture)
    try {
      view.nodes = linear
      await setup.renderOnce()
      expect(trimmed(setup.captureCharFrame()).slice(0, 7)).toEqual(renderToString(layoutNodes(linear)).split("\n"))
      view.glyphs = "ascii"
      await setup.renderOnce()
      expect(trimmed(setup.captureCharFrame())[0]).toBe("*  A")
      view.selectedId = "B"
      await setup.renderOnce()
      const labelSpan = setup.captureSpans().lines[2]?.spans.find((s) => s.text.includes("B") && s.text !== "*")
      expect((labelSpan?.attributes ?? 0) & TextAttributes.INVERSE).toBeTruthy()
    } finally {
      setup.renderer.destroy()
    }
  })

  test("invalid nodes give no layout, report issues and draw nothing", async () => {
    const { setup, view } = await mount(cycle)
    try {
      expect(view.layout).toBeUndefined()
      expect(view.issues.map((i) => i.code)).toEqual(["cycle"])
      expect(trimmed(setup.captureCharFrame()).join("")).toBe("")
      view.nodes = picture
      await setup.renderOnce()
      expect(view.layout?.rows.length).toBe(10)
    } finally {
      setup.renderer.destroy()
    }
  })

  test("keyboard moves the selection along node rows and emits events", async () => {
    const selections: string[] = []
    const activated: string[] = []
    const { setup, view } = await mount(picture, {
      onNodeSelect: (node) => selections.push(node.id),
      onNodeActivate: (node) => activated.push(node.id),
    })
    try {
      const emitted: string[] = []
      view.on("select", (node: DagNode) => emitted.push(node.id))
      view.focus()
      expect(view.focused).toBe(true)
      setup.mockInput.pressKey("ARROW_DOWN")
      expect(view.selectedId).toBe("A")
      setup.mockInput.pressKey("ARROW_DOWN")
      expect(view.selectedId).toBe("B")
      setup.mockInput.pressKey("j")
      expect(view.selectedId).toBe("D")
      setup.mockInput.pressKey("k")
      expect(view.selectedId).toBe("B")
      setup.mockInput.pressKey("ARROW_RIGHT")
      expect(view.selectedId).toBe("C")
      setup.mockInput.pressKey("ARROW_LEFT")
      expect(view.selectedId).toBe("B")
      setup.mockInput.pressKey("END")
      expect(view.selectedId).toBe("G")
      setup.mockInput.pressKey("HOME")
      expect(view.selectedId).toBe("A")
      setup.mockInput.pressKey("RETURN")
      expect(activated).toEqual(["A"])
      expect(selections).toEqual(["A", "B", "D", "B", "C", "B", "G", "A"])
      expect(emitted).toEqual(selections)
    } finally {
      setup.renderer.destroy()
    }
  })

  test("keys: false leaves key handling to the host", async () => {
    const { setup, view } = await mount(picture, { keys: false })
    try {
      view.focus()
      setup.mockInput.pressKey("ARROW_DOWN")
      expect(view.selectedId).toBeUndefined()
      view.moveSelection(2)
      expect(view.selectedId).toBe("B")
    } finally {
      setup.renderer.destroy()
    }
  })

  test("custom keys", async () => {
    const { setup, view } = await mount(picture, { keys: { down: ["n"], up: ["p"] } })
    try {
      view.focus()
      setup.mockInput.pressKey("n")
      setup.mockInput.pressKey("n")
      expect(view.selectedId).toBe("B")
      setup.mockInput.pressKey("p")
      expect(view.selectedId).toBe("A")
    } finally {
      setup.renderer.destroy()
    }
  })

  test("mouse click selects the row's node, double click activates, hover reports", async () => {
    const hovered: (string | null)[] = []
    const activated: string[] = []
    const { setup, view } = await mount(picture, {
      onNodeHover: (node) => hovered.push(node?.id ?? null),
      onNodeActivate: (node) => activated.push(node.id),
    })
    try {
      await setup.mockMouse.click(2, 4)
      expect(view.selectedId).toBe("D")
      await setup.mockMouse.click(5, 3)
      expect(view.selectedId).toBe("D")
      await setup.mockMouse.click(0, 5)
      await setup.mockMouse.click(0, 5)
      expect(view.selectedId).toBe("C")
      expect(activated).toEqual(["C"])
      await setup.mockMouse.moveTo(3, 6)
      await setup.mockMouse.moveTo(3, 8)
      expect(hovered).toEqual(["E", null])
      expect(view.focused).toBe(true)
    } finally {
      setup.renderer.destroy()
    }
  })

  test("inside a ScrollBox only visible rows are drawn and the selection is followed", async () => {
    const setup = await createTestRenderer({ width: 30, height: 8 })
    try {
      const scroll = new ScrollBoxRenderable(setup.renderer, {
        width: 30,
        height: 8,
        scrollbarOptions: { visible: false },
        verticalScrollbarOptions: { visible: false },
      })
      setup.renderer.root.add(scroll)
      // The constructor options do not hide the bar in 0.4.5; the frame comparison needs the column clean.
      scroll.verticalScrollBar.visible = false
      const nodes = randomDag(3, 300, { mergeRate: 0.1 })
      const view = new DagRenderable(setup.renderer, { nodes, gutterOnly: true })
      scroll.add(view)
      await setup.renderOnce()
      const layout = view.layout!
      expect(view.height).toBe(layout.rows.length)
      const [first, end] = view.visibleRowRange()
      expect(first).toBe(0)
      expect(end - first).toBeLessThanOrEqual(8)

      scroll.scrollTo(100)
      await setup.renderOnce()
      const [f2, e2] = view.visibleRowRange()
      expect(f2).toBe(100)
      expect(e2 - f2).toBeLessThanOrEqual(8)
      const expected = renderToString(layout, { labels: false }).split("\n")
      const frame = trimmed(setup.captureCharFrame())
      // With a visible bar the ScrollBox would give the view one column less; drawing must stop at its width.
      for (let i = 0; i < e2 - f2; i++)
        expect(frame[i]?.replace(/\s+$/, "")).toBe(expected[f2 + i]?.slice(0, view.width).replace(/\s+$/, ""))

      view.select("n200")
      view.scrollIntoView()
      await setup.renderOnce()
      const row = view.rowOf("n200")!
      const [f3, e3] = view.visibleRowRange()
      expect(row).toBeGreaterThanOrEqual(f3)
      expect(row).toBeLessThan(e3)
    } finally {
      setup.renderer.destroy()
    }
  })

  test("labels are truncated to the available width", async () => {
    const setup = await createTestRenderer({ width: 12, height: 4 })
    try {
      const view = new DagRenderable(setup.renderer, { nodes: linear })
      setup.renderer.root.add(view)
      await setup.renderOnce()
      const nodes: DagNode[] = [{ id: "a", parents: [], label: "a very long label indeed" }]
      view.nodes = nodes
      await setup.renderOnce()
      expect(view.width).toBe(12)
      expect(trimmed(setup.captureCharFrame())[0]).toBe("●  a very l…")
    } finally {
      setup.renderer.destroy()
    }
  })

  test("destroy is clean", async () => {
    const { setup, view } = await mount(picture)
    try {
      view.destroy()
      expect(view.isDestroyed).toBe(true)
      await setup.renderOnce()
      expect(trimmed(setup.captureCharFrame()).join("")).toBe("")
    } finally {
      setup.renderer.destroy()
    }
  })
})
