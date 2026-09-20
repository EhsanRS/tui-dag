/** @jsxImportSource @opentui/solid */
/**
 * Solid bindings of opentui-dag. Importing this module registers the `<dag_view>` intrinsic element
 * (idempotently) and augments `OpenTUIComponents` so it is fully typed.
 */
import type { JSX } from "@opentui/solid"
import { extend, getComponentCatalogue } from "@opentui/solid/components"
import { createMemo, type Accessor } from "solid-js"
import { layoutDag } from "../layout/layout"
import { type DagLayout, type LayoutOptions } from "../layout/types"
import type { DagNode } from "../model/types"
import { validate, type ValidateOptions, type ValidationIssue } from "../model/validate"
import { DagRenderable, type DagViewOptions } from "../opentui/renderable"

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    dag_view: typeof DagRenderable
  }
}

/** Registers `<dag_view>`. Safe to call more than once; also runs when this module is imported. */
export function registerDagView(): void {
  if (getComponentCatalogue().dag_view === undefined) extend({ dag_view: DagRenderable })
}
registerDagView()

export type DagViewProps<T = unknown> = DagViewOptions<T> & {
  ref?: (renderable: DagRenderable<T>) => void
}

/**
 * Typed wrapper around `<dag_view>`. Works with signals and stores; changing `nodes` updates the existing
 * renderable through its setter instead of recreating it.
 */
export function DagView<T = unknown>(props: DagViewProps<T>): JSX.Element {
  // The intrinsic element is typed for DagRenderable<unknown>; T only narrows the consumer's callbacks.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return <dag_view {...(props as unknown as DagViewProps)} />
}

export interface DagLayoutState<T> {
  layout: DagLayout<T> | undefined
  issues: readonly ValidationIssue[]
}

/**
 * Memoised layout for consumers that draw their own rows beside a `gutterOnly` view. Use `rowOf` to place
 * row content and `layout.rows[i].kind` to leave connector rows blank.
 */
export function createDagLayout<T>(
  nodes: Accessor<readonly DagNode<T>[]>,
  options?: Accessor<LayoutOptions & ValidateOptions>,
): Accessor<DagLayoutState<T>> {
  return createMemo(() => {
    const opts = options?.() ?? {}
    const result = validate(nodes(), opts)
    return { layout: result.ok ? layoutDag(result.graph, opts) : undefined, issues: result.issues }
  })
}

export { laneOf, nodeAt, rowOf } from "../layout/types"
export { DagRenderable, defaultDagKeys } from "../opentui/renderable"
export type { DagKeys, DagNodeHandler, DagNodeInfo, DagViewOptions } from "../opentui/renderable"
