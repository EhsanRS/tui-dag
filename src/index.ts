/**
 * opentui-dag — lane-graph (branching timeline) rendering for terminals.
 *
 * This entry point is pure TypeScript with no OpenTUI dependency: the model (validation and ordering), the
 * layout (lane assignment) and the raster (cells, `renderToString`, `renderToAnsi`). The OpenTUI renderable
 * lives in `opentui-dag/opentui`, the Solid bindings in `opentui-dag/solid`.
 */
import type { LayoutOptions } from "./layout/types"
import { layoutDag } from "./layout/layout"
import { DagValidationError, validate, type ValidateOptions } from "./model/validate"
import type { DagNode } from "./model/types"
import { renderToString, type RasterOptions } from "./raster/raster"

export * from "./model"
export * from "./layout"
export * from "./raster"

/** Validate, lay out and render to a plain string in one call. Throws {@link DagValidationError} on invalid input. */
export function renderDag<T>(
  nodes: readonly DagNode<T>[],
  options: LayoutOptions & RasterOptions & ValidateOptions = {},
): string {
  const result = validate(nodes, options)
  if (!result.ok) throw new DagValidationError(result.issues)
  return renderToString(layoutDag(result.graph, options), options)
}
