/** Display width of a string in terminal cells. */
export type MeasureText = (text: string) => number

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/** Splits text into grapheme clusters. */
export function graphemes(text: string): string[] {
  return [...segmenter.segment(text)].map((s) => s.segment)
}

const bunWidth: MeasureText | undefined =
  typeof Bun !== "undefined" && typeof Bun.stringWidth === "function" ? (text) => Bun.stringWidth(text) : undefined

/**
 * `Bun.stringWidth` when running under Bun (box glyphs and `●` count as 1, CJK as 2), otherwise the number
 * of grapheme clusters.
 */
export const defaultMeasureText: MeasureText = bunWidth ?? ((text) => graphemes(text).length)
