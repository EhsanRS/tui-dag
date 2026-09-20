import { describe, expect, test } from "bun:test"
import {
  Attr,
  createRaster,
  defaultPalette,
  glyphSets,
  hashString,
  layoutNodes,
  parseColorLike,
  rasterize,
  renderDag,
  renderToAnsi,
  renderToString,
  validateGlyphSet,
  type DagNode,
} from "../../src/index"
import { all, crissCross, octopus, picture, threeWay, unknownParent } from "../fixtures/index"

const expectedPicture = [
  "●  initial prompt",
  "│",
  "●  refine plan",
  "├─╮",
  "│ ●  approach B",
  "● │  approach A",
  "│ ●  B: tests pass",
  "●─╯  merge B into A",
  "│",
  "●  final answer",
].join("\n")

describe("renderToString", () => {
  test("reproduces the picture from the spec", () => {
    expect(renderDag(picture)).toBe(expectedPicture)
  })

  test("inline forks without gaps: one row per node", () => {
    expect(renderDag(picture, { forkStyle: "inline", rowGap: "none" })).toBe(
      [
        "●  initial prompt",
        "●─╮  refine plan",
        "│ ●  approach B",
        "● │  approach A",
        "│ ●  B: tests pass",
        "●─╯  merge B into A",
        "●  final answer",
      ].join("\n"),
    )
  })

  test("direction up flips the picture", () => {
    expect(renderDag(picture, { direction: "up" })).toBe(
      [
        "●  final answer",
        "│",
        "●─╮  merge B into A",
        "│ ●  B: tests pass",
        "● │  approach A",
        "│ ●  approach B",
        "├─╯",
        "●  refine plan",
        "│",
        "●  initial prompt",
      ].join("\n"),
    )
  })

  test("ascii glyphs with column-aligned labels", () => {
    expect(renderDag(picture, { glyphs: "ascii", labelAlign: "column" })).toBe(
      [
        "*    initial prompt",
        "|",
        "*    refine plan",
        "|-\\",
        "| *  approach B",
        "* |  approach A",
        "| *  B: tests pass",
        "*-/  merge B into A",
        "|",
        "*    final answer",
      ].join("\n"),
    )
  })

  test("octopus merge and three-way fork", () => {
    expect(renderDag(octopus, { forkStyle: "inline", rowGap: "none" })).toBe(
      ["●─┬─╮  A", "● │ │  B", "│ ● │  C", "│ │ ●  D", "●─┴─╯  M", "●  N"].join("\n"),
    )
    expect(renderDag(threeWay)).toBe(
      ["●  A", "├─┬─╮", "│ ● │  B", "│ │ ●  C", "● │ │  D", "│ ● │  E", "│   ●  F", "●  G"].join("\n"),
    )
  })

  test("criss-cross merges draw crossings", () => {
    expect(renderDag(crissCross, { forkStyle: "inline", rowGap: "none" })).toBe(
      ["●─╮  A", "│ ●─╮  B", "●─┼─┼─╮  C", "│ ●─┼─╯  D", "●─┼─╯  E", "│ ●  F", "●  G"].join("\n"),
    )
  })

  test("stub parents draw a dangling line", () => {
    expect(renderDag(unknownParent, { unknownParent: "stub" })).toBe(["┆", "│", "●  X", "│", "●  Y"].join("\n"))
  })

  test("snapshots for every fixture and glyph set", () => {
    for (const [name, nodes] of Object.entries(all)) {
      for (const glyphs of ["rounded", "square", "heavy", "ascii"] as const) {
        expect(renderDag(nodes, { glyphs })).toMatchSnapshot(`${name}/${glyphs}`)
        expect(renderDag(nodes, { glyphs, forkStyle: "inline", rowGap: "none" })).toMatchSnapshot(
          `${name}/${glyphs}/inline`,
        )
      }
    }
  })
})

describe("labels", () => {
  const layout = layoutNodes(picture)

  test("labels off gives a gutter-only grid", () => {
    const text = renderToString(layout, { labels: false })
    expect(text).toBe(["●", "│", "●", "├─╮", "│ ●", "● │", "│ ●", "●─╯", "│", "●"].join("\n"))
  })

  test("labelGap and column alignment", () => {
    const text = renderToString(layout, { labelGap: 1, labelAlign: "column" })
    expect(text.split("\n")[0]).toBe("●   initial prompt")
    expect(text.split("\n")[4]).toBe("│ ● approach B")
  })

  test("maxLabelWidth truncates by display width with an ellipsis", () => {
    const text = renderToString(layout, { maxLabelWidth: 8 })
    expect(text.split("\n")[0]).toBe("●  initial…")
    expect(text.split("\n")[7]).toBe("●─╯  merge B…")
  })

  test("maxWidth bounds the whole row", () => {
    const raster = createRaster(layout, { maxWidth: 10 })
    expect(raster.width).toBeLessThanOrEqual(10)
    for (let i = 0; i < raster.height; i++) expect(raster.row(i).length).toBeLessThanOrEqual(10)
  })

  test("wide graphemes take two cells", () => {
    const nodes: DagNode[] = [{ id: "a", parents: [], label: "日本語 ok" }]
    const raster = createRaster(layoutNodes(nodes))
    const cells = raster.row(0)
    expect(raster.width).toBe(3 + 6 + 3)
    expect(cells.length).toBe(raster.width)
    expect(cells[3]?.char).toBe("日")
    expect(cells[4]?.char).toBe("")
    expect(renderToString(layoutNodes(nodes), { maxLabelWidth: 4 })).toBe("●  日…")
  })

  test("spans carry their own style", () => {
    const nodes: DagNode[] = [
      {
        id: "a",
        parents: [],
        label: [
          { text: "bold", attrs: Attr.BOLD },
          { text: " red", fg: "#ff0000" },
        ],
      },
    ]
    const cells = createRaster(layoutNodes(nodes)).row(0)
    expect(cells[3]).toEqual({ char: "b", attrs: Attr.BOLD, nodeId: "a", fg: undefined, bg: undefined })
    expect(cells[8]?.fg).toBe("#ff0000")
    expect(cells[8]?.attrs).toBeUndefined()
  })

  test("labelColor branch colours the label like the marker", () => {
    const cells = createRaster(layout, { labelColor: "branch" }).row(4)
    expect(cells[2]?.fg).toBe(defaultPalette[1])
    expect(cells[5]?.fg).toBe(defaultPalette[1])
    expect(createRaster(layout).row(4)[5]?.fg).toBeUndefined()
  })
})

describe("colours and markers", () => {
  const layout = layoutNodes(picture)

  test("fork connector takes the child branch colour, merge connector the incoming branch colour", () => {
    const raster = createRaster(layout)
    const forkRow = raster.row(3)
    expect(forkRow.map((c) => c.char).join("")).toBe("├─╮")
    expect(forkRow[0]?.fg).toBe(defaultPalette[0])
    expect(forkRow[1]?.fg).toBe(defaultPalette[1])
    expect(forkRow[2]?.fg).toBe(defaultPalette[1])
    const mergeRow = raster.row(7)
    expect(mergeRow[0]?.fg).toBe(defaultPalette[0])
    expect(mergeRow[1]?.fg).toBe(defaultPalette[1])
    expect(mergeRow[2]?.fg).toBe(defaultPalette[1])
    expect(mergeRow[2]?.branchId).toBe("b1")
  })

  test("colorStrategy lane cycles by column", () => {
    const palette = ["#111111", "#222222"]
    const cells = createRaster(layout, { colorStrategy: "lane", palette }).row(4)
    expect(cells[0]?.fg).toBe("#111111")
    expect(cells[2]?.fg).toBe("#222222")
  })

  test("colorStrategy group is stable across data changes", () => {
    const nodes: DagNode[] = [
      { id: "a", parents: [], group: "alpha" },
      { id: "b", parents: ["a"], group: "beta" },
    ]
    const before = createRaster(layoutNodes(nodes), { colorStrategy: "group" }).row(0)[0]?.fg
    const more = [...nodes, { id: "c", parents: ["b"], group: "gamma" }, { id: "d", parents: ["a"], group: "delta" }]
    const after = createRaster(layoutNodes(more), { colorStrategy: "group" }).row(0)[0]?.fg
    expect(after).toBe(before)
    expect(before).toBe(defaultPalette[hashString("alpha") % defaultPalette.length])
  })

  test("per-node colour override wins", () => {
    const nodes: DagNode[] = [{ id: "a", parents: [], color: "#abcdef" }]
    expect(createRaster(layoutNodes(nodes), { colorStrategy: "lane" }).row(0)[0]?.fg).toBe("#abcdef")
  })

  test("autoMarkers derive root, merge and tip", () => {
    const text = renderToString(layout, { autoMarkers: true, labels: false })
    expect(text.split("\n")[0]).toBe("◎")
    expect(text.split("\n")[7]).toBe("◆─╯")
    expect(text.split("\n")[9]).toBe("○")
  })

  test("custom marker glyph must be one cell wide", () => {
    const nodes: DagNode[] = [
      { id: "a", parents: [], marker: { glyph: "★" } },
      { id: "b", parents: ["a"], marker: { glyph: "日" } },
    ]
    expect(renderToString(layoutNodes(nodes), { labels: false })).toBe("★\n│\n●")
  })

  test("validateGlyphSet reports wide glyphs", () => {
    expect(validateGlyphSet(glyphSets.rounded)).toEqual([])
    expect(validateGlyphSet(glyphSets.ascii)).toEqual([])
    expect(validateGlyphSet({ ...glyphSets.rounded, node: "日" })).toEqual([{ key: "node", glyph: "日", width: 2 }])
  })

  test("parseColorLike handles hex forms and objects", () => {
    expect(parseColorLike("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 255 })
    expect(parseColorLike("#ff000080")).toEqual({ r: 255, g: 0, b: 0, a: 128 })
    expect(parseColorLike({ r: 1, g: 2, b: 3 })).toEqual({ r: 1, g: 2, b: 3, a: 255 })
    expect(parseColorLike("red")).toBeUndefined()
  })
})

describe("selection and highlight", () => {
  const layout = layoutNodes(picture)

  test("selected label is inverse and its marker bold; ancestors stay bright, the rest dims", () => {
    const raster = createRaster(layout, { selectedId: "C" })
    const selected = raster.row(5)
    expect(selected[0]?.attrs).toBe(Attr.BOLD)
    expect(selected[5]?.attrs).toBe(Attr.INVERSE)
    expect(selected[0]?.nodeId).toBe("C")
    const ancestor = raster.row(2)
    expect(ancestor[0]?.attrs).toBeUndefined()
    const other = raster.row(4)
    expect(other[2]?.attrs).toBe(Attr.DIM)
    expect(other[5]?.attrs).toBe(Attr.DIM)
    expect(other[0]?.attrs).toBeUndefined()
    const descendant = raster.row(9)
    expect(descendant[0]?.attrs).toBe(Attr.DIM)
  })

  test("highlight both, descendants and none", () => {
    const both = createRaster(layout, { selectedId: "D", highlight: "both" })
    expect(both.row(0)[0]?.attrs).toBeUndefined()
    expect(both.row(9)[0]?.attrs).toBeUndefined()
    expect(both.row(5)[0]?.attrs).toBe(Attr.DIM)
    const desc = createRaster(layout, { selectedId: "D", highlight: "descendants" })
    expect(desc.row(0)[0]?.attrs).toBe(Attr.DIM)
    expect(desc.row(9)[0]?.attrs).toBeUndefined()
    const none = createRaster(layout, { selectedId: "D", highlight: "none" })
    expect(none.row(0)[0]?.attrs).toBeUndefined()
    expect(none.row(4)[2]?.attrs).toBe(Attr.BOLD)
  })

  test("dimStyle and selectedStyle are configurable", () => {
    const raster = createRaster(layout, {
      selectedId: "A",
      dimStyle: { fg: "#444444", attrs: 0 },
      selectedStyle: { bg: "#ffffff", attrs: Attr.UNDERLINE },
    })
    expect(raster.row(2)[0]?.fg).toBe("#444444")
    expect(raster.row(2)[0]?.attrs).toBeUndefined()
    expect(raster.row(0)[3]).toMatchObject({ bg: "#ffffff", attrs: Attr.UNDERLINE })
  })

  test("withSelection keeps metrics and changes dimming", () => {
    const base = createRaster(layout)
    const selected = base.withSelection({ selectedId: "E" })
    expect(selected.width).toBe(base.width)
    expect(selected.row(9)[0]?.attrs).toBe(Attr.DIM)
    expect(base.row(9)[0]?.attrs).toBeUndefined()
  })
})

describe("grids and ANSI", () => {
  const layout = layoutNodes(picture)

  test("rasterize is rectangular and rowNodeIds map rows to nodes", () => {
    const grid = rasterize(layout)
    const raster = createRaster(layout)
    expect(grid.length).toBe(raster.height)
    expect(grid.every((row) => row.length === raster.width)).toBe(true)
    expect(raster.rowNodeIds).toEqual(["A", undefined, "B", undefined, "D", "C", "E", "F", undefined, "G"])
  })

  test("renderToAnsi colours connectors and resets at line ends", () => {
    const ansi = renderToAnsi(layout)
    const lines = ansi.split("\n")
    const rgb = parseColorLike(defaultPalette[1] ?? "")
    expect(lines[3]).toContain(`\u001b[38;2;${rgb?.r};${rgb?.g};${rgb?.b}m─╮`)
    expect(lines[3]?.endsWith("\u001b[0m")).toBe(true)
    expect(lines[1]).toBe("\u001b[0m\u001b[38;2;122;162;247m│\u001b[0m")
    const plain = ansi.replace(/\u001b\[[0-9;]*m/g, "")
    expect(plain).toBe(expectedPicture)
  })

  test("renderToAnsi emits attribute codes", () => {
    const ansi = renderToAnsi(layout, { selectedId: "A" })
    expect(ansi).toContain("\u001b[7m")
    expect(ansi).toContain("\u001b[2;")
  })
})

describe("groupColors", () => {
  test("explicit group colours win over the hash and apply to lanes", () => {
    // b is the newer tip, so it continues the lead lane and c forks off into lane 1.
    const nodes: DagNode[] = [
      { id: "a", parents: [], group: "lead", time: 1 },
      { id: "c", parents: ["a"], group: "team", time: 2 },
      { id: "b", parents: ["a"], group: "lead", time: 3 },
    ]
    const layout = layoutNodes(nodes)
    const raster = createRaster(layout, { colorStrategy: "group", groupColors: { lead: "#111111", team: "#222222" } })
    expect(raster.row(0)[0]?.fg).toBe("#111111")
    const forkRow = raster.row(1)
    expect(forkRow.map((c) => c.char).join("")).toBe("├─╮")
    expect(forkRow[2]?.fg).toBe("#222222")
    expect(forkRow[0]?.fg).toBe("#111111")
  })
})
