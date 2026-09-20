/**
 * OpenTUI layer of opentui-dag: {@link DagRenderable}, a focusable `Renderable` that draws a lane graph and
 * routes keyboard and mouse input through OpenTUI's own systems. Requires `@opentui/core` as a peer.
 */
export { DagRenderable, defaultDagKeys } from "./renderable"
export type { DagKeys, DagNodeHandler, DagNodeInfo, DagViewOptions } from "./renderable"
