/**
 * A colour as plain data: a hex string (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`) or channel values in
 * the 0–255 range. Layers 1–3 never interpret colours beyond parsing; the OpenTUI layer converts them to
 * `RGBA` once and caches the result.
 */
export type ColorLike = string | { r: number; g: number; b: number; a?: number }

/**
 * What to draw in a node's cell. Named kinds map to glyphs of the active glyph set. `{ glyph }` draws a
 * custom glyph, which must be one terminal cell wide (wider glyphs fall back to the `node` glyph).
 */
export type MarkerKind = "node" | "root" | "merge" | "tip" | "current" | "stub" | { glyph: string }

/** One styled run of label text. */
export interface LabelSpan {
  text: string
  fg?: ColorLike
  bg?: ColorLike
  /** Bitmask of {@link Attr}. */
  attrs?: number
}

/** A node of the graph. Only `id` and `parents` are required. */
export interface DagNode<T = unknown> {
  id: string
  /**
   * Parent ids. `[]` means root. `parents[0]` is the first parent: the node continues that parent's lane
   * whenever the layout lets it, so first-parent chains draw as straight lines.
   */
  parents: readonly string[]
  /** Epoch milliseconds. Used only to order nodes that are otherwise unordered by the graph. */
  time?: number
  /** A single line of text, plain or as styled spans. */
  label?: string | readonly LabelSpan[]
  /** Branch or series key. With `colorStrategy: "group"` it is hashed to a stable palette entry. */
  group?: string
  /** Marker glyph kind. Defaults to `"node"`. */
  marker?: MarkerKind
  /** Colour override for this node's marker (and its label with `labelColor: "branch"`). */
  color?: ColorLike
  /** Opaque payload, handed back in events. */
  data?: T
}

/**
 * Text attribute bits. The values equal OpenTUI's `TextAttributes` (verified against 0.4.5) so the OpenTUI
 * layer passes them through unchanged; it asserts the equality when it loads.
 */
export const Attr = {
  NONE: 0,
  BOLD: 1,
  DIM: 2,
  ITALIC: 4,
  UNDERLINE: 8,
  BLINK: 16,
  INVERSE: 32,
  HIDDEN: 64,
  STRIKETHROUGH: 128,
} as const
