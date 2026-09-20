/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { getComponentCatalogue } from "@opentui/solid/components"
import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { layoutNodes, renderToString, type ColorLike, type DagNode } from "../../src/index"
import { createDagLayout, DagRenderable, DagView, registerDagView, rowOf } from "../../src/solid/index"
import { linear, picture } from "../fixtures/index"

const trimmed = (frame: string) => frame.split("\n").map((line) => line.replace(/\s+$/, ""))

describe("Solid bindings", () => {
  test("registration is idempotent", () => {
    registerDagView()
    registerDagView()
    expect(getComponentCatalogue().dag_view).toBe(DagRenderable)
  })

  test("<dag_view> works with only nodes set", async () => {
    const setup = await testRender(() => <dag_view nodes={picture} />, { width: 40, height: 12 })
    try {
      await setup.renderOnce()
      const expected = renderToString(layoutNodes(picture)).split("\n")
      expect(trimmed(setup.captureCharFrame()).slice(0, expected.length)).toEqual(expected)
    } finally {
      setup.renderer.destroy()
    }
  })

  test("DagView reacts to signals without remounting and forwards events", async () => {
    const [nodes, setNodes] = createSignal<readonly DagNode[]>(picture)
    const [selected, setSelected] = createSignal<string | undefined>()
    const [palette, setPalette] = createSignal<readonly ColorLike[]>(["#112233", "#445566"])
    const selections: string[] = []
    let ref: DagRenderable | undefined
    const setup = await testRender(
      () => (
        <scrollbox width={40} height={12} focusable={false} scrollbarOptions={{ visible: false }}>
          <DagView
            ref={(r) => (ref = r)}
            nodes={nodes()}
            selectedId={selected()}
            palette={palette()}
            focused
            onNodeSelect={(node) => {
              selections.push(node.id)
              setSelected(node.id)
            }}
          />
        </scrollbox>
      ),
      { width: 40, height: 12 },
    )
    try {
      await setup.renderOnce()
      const first = ref
      expect(first).toBeInstanceOf(DagRenderable)
      expect(trimmed(setup.captureCharFrame())[3]).toBe("├─╮")

      setNodes(linear)
      await setup.renderOnce()
      expect(ref).toBe(first)
      expect(trimmed(setup.captureCharFrame()).slice(0, 7)).toEqual(renderToString(layoutNodes(linear)).split("\n"))

      setSelected("B")
      await setup.renderOnce()
      const label = setup.captureSpans().lines[2]?.spans.find((s) => s.text.includes("B") && !s.text.includes("●"))
      expect((label?.attributes ?? 0) & TextAttributes.INVERSE).toBeTruthy()

      setPalette(["#ff0000"])
      await setup.renderOnce()
      const marker = setup.captureSpans().lines[0]?.spans.find((s) => s.text.includes("●"))
      expect(marker?.fg.toInts().slice(0, 3)).toEqual([255, 0, 0])

      expect(ref?.focused).toBe(true)
      // The selection is on B (linear: A, B, C, D), so down moves to C and a click on row 6 picks D.
      setup.mockInput.pressKey("ARROW_DOWN")
      expect(selections).toEqual(["C"])
      expect(selected()).toBe("C")
      await setup.mockMouse.click(4, 6)
      expect(selections).toEqual(["C", "D"])
    } finally {
      setup.renderer.destroy()
    }
    expect(ref?.isDestroyed).toBe(true)
  })

  test("gutterOnly with createDagLayout lets the consumer draw rows", async () => {
    const [nodes] = createSignal<readonly DagNode[]>(picture)
    const state = createDagLayout(nodes)
    const setup = await testRender(
      () => (
        <box flexDirection="row">
          <DagView nodes={nodes()} gutterOnly />
          <box flexDirection="column" marginLeft={1}>
            {state().layout?.rows.map((row) => (
              <text height={1}>{row.kind === "node" ? `<${row.nodeId}>` : ""}</text>
            ))}
          </box>
        </box>
      ),
      { width: 30, height: 12 },
    )
    try {
      await setup.renderOnce()
      const frame = trimmed(setup.captureCharFrame())
      expect(frame[0]).toBe("●   <A>")
      expect(frame[3]).toBe("├─╮")
      expect(frame[4]).toBe("│ ● <D>")
      expect(rowOf(state().layout!, "D")).toBe(4)
    } finally {
      setup.renderer.destroy()
    }
  })
})
