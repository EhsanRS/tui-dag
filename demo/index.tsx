/** @jsxImportSource @opentui/solid */
import { createCliRenderer } from "@opentui/core"
import { render } from "@opentui/solid"
import { App } from "./app"

// Exit is always through renderer.destroy() (the "q" key in App), never process.exit().
const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: true, targetFps: 30 })
await render(() => <App />, renderer)
