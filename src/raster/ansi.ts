import type { DagLayout } from "../layout/types"
import { Attr } from "../model/types"
import { parseColorLike } from "./color"
import { createRaster, type Cell, type RasterOptions } from "./raster"

const attrCodes: readonly [number, string][] = [
  [Attr.BOLD, "1"],
  [Attr.DIM, "2"],
  [Attr.ITALIC, "3"],
  [Attr.UNDERLINE, "4"],
  [Attr.BLINK, "5"],
  [Attr.INVERSE, "7"],
  [Attr.HIDDEN, "8"],
  [Attr.STRIKETHROUGH, "9"],
]

/** SGR parameters for a cell's style, or `""` for an unstyled cell. */
export function sgrOf(cell: Cell): string {
  const parts: string[] = []
  const attrs = cell.attrs ?? 0
  for (const [bit, code] of attrCodes) if (attrs & bit) parts.push(code)
  const fg = cell.fg === undefined ? undefined : parseColorLike(cell.fg)
  if (fg !== undefined) parts.push(`38;2;${fg.r};${fg.g};${fg.b}`)
  const bg = cell.bg === undefined ? undefined : parseColorLike(cell.bg)
  if (bg !== undefined) parts.push(`48;2;${bg.r};${bg.g};${bg.b}`)
  return parts.join(";")
}

/** 24-bit colour rendering with SGR escapes; styles are emitted only when they change. */
export function renderToAnsi<T>(layout: DagLayout<T>, options: RasterOptions = {}): string {
  const raster = createRaster(layout, options)
  return layout.rows
    .map((_, i) => {
      const cells = trimEnd(raster.row(i))
      let out = ""
      let current = ""
      for (const cell of cells) {
        const style = sgrOf(cell)
        if (style !== current) {
          out += "\u001b[0m"
          if (style !== "") out += `\u001b[${style}m`
          current = style
        }
        out += cell.char
      }
      return current === "" ? out : out + "\u001b[0m"
    })
    .join("\n")
}

function trimEnd(cells: readonly Cell[]): readonly Cell[] {
  let end = cells.length
  while (end > 0) {
    const cell = cells[end - 1]
    if (cell === undefined || !isBlank(cell)) break
    end--
  }
  return cells.slice(0, end)
}

function isBlank(cell: Cell): boolean {
  return cell.char === " " && cell.bg === undefined && (cell.attrs ?? 0) === 0
}
