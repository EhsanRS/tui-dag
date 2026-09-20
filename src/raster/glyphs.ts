import { Arm } from "../layout/types"
import { defaultMeasureText, type MeasureText } from "./text"

export type GlyphSetName = "rounded" | "square" | "heavy" | "ascii"

/**
 * Glyphs for the gutter. Connector glyphs are named by their arms in the vertical orientation
 * (`dr` = down + right = `╭`, `ul` = up + left = `╯`, ...). Every glyph must be one terminal cell wide.
 */
export interface GlyphSet {
  /** `│` up + down */
  v: string
  /** `─` left + right */
  h: string
  /** `╭` down + right */
  dr: string
  /** `╮` down + left */
  dl: string
  /** `╰` up + right */
  ur: string
  /** `╯` up + left */
  ul: string
  /** `├` up + down + right */
  vr: string
  /** `┤` up + down + left */
  vl: string
  /** `┬` left + right + down */
  hd: string
  /** `┴` left + right + up */
  hu: string
  /** `┼` all four */
  cross: string
  node: string
  root: string
  merge: string
  tip: string
  current: string
  stub: string
  /** Appended to truncated labels. */
  ellipsis: string
}

const markers = { node: "●", root: "◎", merge: "◆", tip: "○", current: "◉", stub: "┆", ellipsis: "…" }

/**
 * Built-in glyph sets. Box-drawing characters and `●` are East Asian Ambiguous width; `ascii` is the safe
 * fallback for terminals that render them double width.
 */
export const glyphSets: Readonly<Record<GlyphSetName, GlyphSet>> = {
  rounded: {
    v: "│",
    h: "─",
    dr: "╭",
    dl: "╮",
    ur: "╰",
    ul: "╯",
    vr: "├",
    vl: "┤",
    hd: "┬",
    hu: "┴",
    cross: "┼",
    ...markers,
  },
  square: {
    v: "│",
    h: "─",
    dr: "┌",
    dl: "┐",
    ur: "└",
    ul: "┘",
    vr: "├",
    vl: "┤",
    hd: "┬",
    hu: "┴",
    cross: "┼",
    ...markers,
  },
  heavy: {
    v: "┃",
    h: "━",
    dr: "┏",
    dl: "┓",
    ur: "┗",
    ul: "┛",
    vr: "┣",
    vl: "┫",
    hd: "┳",
    hu: "┻",
    cross: "╋",
    ...markers,
  },
  ascii: {
    v: "|",
    h: "-",
    dr: "/",
    dl: "\\",
    ur: "\\",
    ul: "/",
    vr: "|",
    vl: "|",
    hd: "-",
    hu: "-",
    cross: "+",
    node: "*",
    root: "o",
    merge: "*",
    tip: "o",
    current: "@",
    stub: ":",
    ellipsis: "~",
  },
}

/** Resolves a name or custom set; defaults to `rounded`. */
export function resolveGlyphSet(glyphs: GlyphSetName | GlyphSet | undefined): GlyphSet {
  if (glyphs === undefined) return glyphSets.rounded
  return typeof glyphs === "string" ? glyphSets[glyphs] : glyphs
}

export interface GlyphIssue {
  key: keyof GlyphSet
  glyph: string
  width: number
}

const glyphKeys: readonly (keyof GlyphSet)[] = [
  "v",
  "h",
  "dr",
  "dl",
  "ur",
  "ul",
  "vr",
  "vl",
  "hd",
  "hu",
  "cross",
  "node",
  "root",
  "merge",
  "tip",
  "current",
  "stub",
  "ellipsis",
]

/** Reports glyphs that are not exactly one cell wide. Empty array means the set is usable. */
export function validateGlyphSet(set: GlyphSet, measure: MeasureText = defaultMeasureText): GlyphIssue[] {
  return glyphKeys
    .map((key) => ({ key, glyph: set[key], width: measure(set[key]) }))
    .filter((issue) => issue.width !== 1)
}

const U = Arm.PREV
const D = Arm.NEXT
const L = Arm.LO
const R = Arm.HI

/** Glyph for an arms bitmask in the vertical orientation (PREV = up, NEXT = down, LO = left, HI = right). */
export function armGlyph(set: GlyphSet, arms: number): string {
  switch (arms) {
    case U | D:
    case U:
    case D:
      return set.v
    case L | R:
    case L:
    case R:
      return set.h
    case D | R:
      return set.dr
    case D | L:
      return set.dl
    case U | R:
      return set.ur
    case U | L:
      return set.ul
    case U | D | R:
      return set.vr
    case U | D | L:
      return set.vl
    case L | R | D:
      return set.hd
    case L | R | U:
      return set.hu
    case U | D | L | R:
      return set.cross
    default:
      return " "
  }
}
