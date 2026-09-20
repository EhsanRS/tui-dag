import type { ColorLike } from "../model/types"

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** Parses a {@link ColorLike}; `undefined` for strings that are not hex colours. */
export function parseColorLike(color: ColorLike): Rgba | undefined {
  if (typeof color !== "string") {
    // An OpenTUI `RGBA` also matches the object shape but stores 0–1 floats; its `toInts()` gives 0–255.
    const toInts: unknown = Reflect.get(color, "toInts")
    if (typeof toInts === "function") {
      const ints: unknown = toInts.call(color)
      if (Array.isArray(ints)) {
        const [r, g, b, a] = ints
        if (typeof r === "number" && typeof g === "number" && typeof b === "number" && typeof a === "number") {
          return { r, g, b, a }
        }
      }
    }
    return { r: color.r, g: color.g, b: color.b, a: color.a ?? 255 }
  }
  const hex = color.startsWith("#") ? color.slice(1) : color
  if (!/^[0-9a-fA-F]+$/.test(hex)) return undefined
  if (hex.length === 3 || hex.length === 4) {
    const [r, g, b, a] = hex.split("").map((d) => parseInt(d + d, 16))
    return { r: r ?? 0, g: g ?? 0, b: b ?? 0, a: a ?? 255 }
  }
  if (hex.length !== 6 && hex.length !== 8) return undefined
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255,
  }
}

/** Stable string key for caches, e.g. `#rrggbbaa`. Non-hex strings are returned as-is. */
export function colorKey(color: ColorLike): string {
  const rgba = parseColorLike(color)
  if (rgba === undefined) return typeof color === "string" ? color : "invalid"
  return "#" + [rgba.r, rgba.g, rgba.b, rgba.a].map((v) => v.toString(16).padStart(2, "0")).join("")
}

/** FNV-1a over UTF-16 code units. Stable across runs, so group colours never shuffle. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/** Eight distinguishable colours that read well on dark and light backgrounds. */
export const defaultPalette: readonly ColorLike[] = [
  "#7aa2f7",
  "#f7768e",
  "#9ece6a",
  "#e0af68",
  "#bb9af7",
  "#7dcfff",
  "#ff9e64",
  "#73daca",
]
