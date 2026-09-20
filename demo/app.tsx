/** @jsxImportSource @opentui/solid */
import { useKeyboard, useRenderer } from "@opentui/solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import type { ColorStrategy, DagNode, GlyphSetName, LayoutOptions } from "../src/index"
import { DagView, type DagRenderable } from "../src/solid/index"
import { fixtures, palettes } from "./fixtures"

const glyphNames: GlyphSetName[] = ["rounded", "square", "heavy", "ascii"]

function labelText(node: DagNode): string {
  if (node.label === undefined) return ""
  return typeof node.label === "string" ? node.label : node.label.map((span) => span.text).join("")
}

export function App() {
  const renderer = useRenderer()
  const [fixture, setFixture] = createSignal(0)
  const [seed, setSeed] = createSignal(1)
  const [glyphs, setGlyphs] = createSignal(0)
  const [palette, setPalette] = createSignal(0)
  const [compact, setCompact] = createSignal(false)
  const [direction, setDirection] = createSignal<"down" | "up">("down")
  const [strategy, setStrategy] = createSignal<ColorStrategy | undefined>()
  const [allocation, setAllocation] = createSignal<LayoutOptions["laneAllocation"]>()
  const [selected, setSelected] = createSignal<string | undefined>()
  const [hovered, setHovered] = createSignal<DagNode | null>(null)
  const [status, setStatus] = createSignal("↑↓ j k select · ← → parent/child · enter activate · click a row")
  let view: DagRenderable | undefined

  const current = createMemo(() => fixtures[fixture()] ?? fixtures[0]!)
  const data = createMemo(() => current().build(seed()))
  const colors = createMemo(() => palettes[palette()]?.colors ?? [])
  const groupColors = createMemo(
    () =>
      data().groupColors?.(colors()) ??
      Object.fromEntries((data().groups ?? []).map((group, i) => [group, colors()[i % colors().length] ?? "#ffffff"])),
  )
  const colorStrategy = createMemo(() => strategy() ?? data().colorStrategy ?? "branch")
  const laneAllocation = createMemo(() => allocation() ?? data().laneAllocation ?? "leftmost")
  const selectedNode = createMemo(() => {
    const id = selected()
    return id === undefined ? undefined : view?.layout?.graph.byId.get(id)
  })

  const pickFixture = (index: number) => {
    setFixture(index)
    setSelected(undefined)
  }

  useKeyboard((key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      renderer.destroy()
      return
    }
    if (key.name === "tab") pickFixture((fixture() + 1) % fixtures.length)
    if (/^[1-9]$/.test(key.name) && Number(key.name) <= fixtures.length) pickFixture(Number(key.name) - 1)
    if (key.name === "r") setSeed((s) => s + 1)
    if (key.name === "g") setGlyphs((i) => (i + 1) % glyphNames.length)
    if (key.name === "p") setPalette((i) => (i + 1) % palettes.length)
    if (key.name === "c") setCompact((c) => !c)
    if (key.name === "d") setDirection((d) => (d === "down" ? "up" : "down"))
    if (key.name === "o") setStrategy((s) => (s === undefined ? "group" : s === "group" ? "branch" : undefined))
    if (key.name === "a")
      setAllocation((a) =>
        a === undefined ? "nested" : a === "nested" ? "nearest" : a === "nearest" ? "leftmost" : undefined,
      )
  })

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box
        height={2}
        flexShrink={0}
        overflow="hidden"
        paddingLeft={1}
        paddingRight={1}
        backgroundColor="#1f2335"
        flexDirection="column"
      >
        <text fg="#c0caf5" height={1}>
          <b>opentui-dag</b> · {current().name}
          {data().subtitle ? ` · ${data().subtitle}` : ""}
        </text>
        <text fg="#9aa5ce" height={1}>
          tab/1-{fixtures.length} fixture · r reseed · g glyphs ({glyphNames[glyphs()]}) · p palette (
          {palettes[palette()]?.name}) · c compact · d direction · o colours ({colorStrategy()}) · a lanes (
          {laneAllocation()}) · q quit
        </text>
      </box>
      <box flexDirection="row" flexGrow={1}>
        <scrollbox flexGrow={1} focusable={false}>
          <DagView
            ref={(r) => (view = r)}
            nodes={data().nodes}
            trunk={data().trunk}
            laneAllocation={laneAllocation()}
            glyphs={glyphNames[glyphs()]}
            palette={colors()}
            colorStrategy={colorStrategy()}
            groupColors={groupColors()}
            forkStyle={compact() ? "inline" : "row"}
            rowGap={compact() ? "none" : "auto"}
            direction={direction()}
            selectedId={selected()}
            autoMarkers
            focused
            onNodeSelect={(node) => {
              setSelected(node.id)
              setStatus(`selected ${node.id}`)
            }}
            onNodeActivate={(node) => setStatus(`activated ${node.id} (${node.parents.length} parents)`)}
            onNodeHover={setHovered}
          />
        </scrollbox>
        <box width={36} flexDirection="column" paddingLeft={1} paddingRight={1} border={["left"]} borderColor="#3b4261">
          <text fg="#c0caf5">
            <b>selection</b>
          </text>
          <Show when={selectedNode()} fallback={<text fg="#565f89">none</text>}>
            {(node) => (
              <box flexDirection="column">
                <text fg="#7aa2f7">{node().id}</text>
                <text fg="#c0caf5">{labelText(node())}</text>
                <text fg="#9aa5ce">group: {node().group ?? "-"}</text>
                <text fg="#9aa5ce">parents: {node().parents.join(", ") || "none"}</text>
                <text fg="#9aa5ce">
                  row {view?.rowOf(node().id)} · children {view?.layout?.graph.children.get(node().id)?.length ?? 0}
                </text>
              </box>
            )}
          </Show>
          <text fg="#c0caf5">
            <b>hover</b>
          </text>
          <text fg="#9aa5ce">{hovered() ? labelText(hovered()!) : "-"}</text>
          <text fg="#c0caf5">
            <b>graph</b>
          </text>
          <text fg="#9aa5ce">
            {data().nodes.length} nodes · {view?.layout?.rows.length ?? 0} rows · {view?.layout?.laneCount ?? 0} lanes
          </text>
          <Show when={(view?.issues.length ?? 0) > 0}>
            <For each={view?.issues ?? []}>{(issue) => <text fg="#f7768e">{issue.code}</text>}</For>
          </Show>
        </box>
      </box>
      <box height={1} paddingLeft={1}>
        <text fg="#9aa5ce">{status()}</text>
      </box>
    </box>
  )
}
