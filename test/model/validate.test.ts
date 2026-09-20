import { describe, expect, test } from "bun:test"
import { formatIssue, validate, type DagNode } from "../../src/index"
import { cycle, linear, picture, unknownParent } from "../fixtures/index"

const n = (id: string, parents: string[], time?: number): DagNode => ({ id, parents, time })

describe("validate", () => {
  test("orders a linear chain and maps children", () => {
    const result = validate(linear)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.graph.order).toEqual(["A", "B", "C", "D"])
    expect(result.graph.children.get("A")).toEqual(["B"])
    expect(result.graph.children.get("D")).toEqual([])
    expect(result.issues).toEqual([])
  })

  test("breaks ties by time, then input order; untimed nodes come after timed ones", () => {
    const result = validate([n("root", []), n("late", ["root"], 50), n("early", ["root"], 10), n("untimed", ["root"])])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.graph.order).toEqual(["root", "early", "late", "untimed"])
    expect(result.graph.children.get("root")).toEqual(["early", "late", "untimed"])
  })

  test("keeps the picture's intended order", () => {
    const result = validate(picture)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.graph.order).toEqual(["A", "B", "D", "C", "E", "F", "G"])
  })

  test("is deterministic", () => {
    const a = validate(picture)
    const b = validate(picture.map((node) => ({ ...node })))
    expect(a).toEqual(b)
  })

  test("rejects empty and duplicate ids", () => {
    const result = validate([n("", []), n("a", []), n("a", [])])
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([
      { code: "empty-id", index: 0 },
      { code: "duplicate-id", id: "a", index: 2 },
    ])
  })

  test("unknown parent: error mode fails", () => {
    const result = validate(unknownParent)
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([{ code: "unknown-parent", id: "X", parent: "missing" }])
    const first = result.issues[0]
    expect(first && formatIssue(first)).toContain("missing")
  })

  test("unknown parent: root mode drops the parent and reports a warning", () => {
    const result = validate(unknownParent, { unknownParent: "root" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.graph.byId.get("X")?.parents).toEqual([])
    expect(result.issues).toEqual([{ code: "unknown-parent", id: "X", parent: "missing" }])
    expect(result.graph.stubs.size).toBe(0)
  })

  test("unknown parent: stub mode inserts a synthetic root right before its child", () => {
    const result = validate(unknownParent, { unknownParent: "stub" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.graph.order).toEqual(["missing", "X", "Y"])
    expect(result.graph.stubs.has("missing")).toBe(true)
    expect(result.graph.byId.get("missing")).toEqual({ id: "missing", parents: [], marker: "stub" })
    expect(result.graph.nodes.at(-1)?.id).toBe("missing")
  })

  test("stub shared by two children is created once", () => {
    const result = validate([n("a", ["m"]), n("b", ["m"])], { unknownParent: "stub" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.graph.children.get("m")).toEqual(["a", "b"])
  })

  test("reports a cycle with a closed path", () => {
    const result = validate(cycle)
    expect(result.ok).toBe(false)
    const issue = result.issues.find((i) => i.code === "cycle")
    expect(issue?.code).toBe("cycle")
    if (issue?.code !== "cycle") return
    expect(issue.path[0]).toBe(issue.path.at(-1))
    expect(new Set(issue.path)).toEqual(new Set(["A", "B", "C"]))
  })

  test("a self-parent is a cycle of length one", () => {
    const result = validate([n("a", ["a"])])
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([{ code: "cycle", path: ["a", "a"] }])
  })

  test("collapses duplicate parent entries", () => {
    const result = validate([n("a", []), n("b", ["a", "a"])])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.graph.byId.get("b")?.parents).toEqual(["a"])
  })

  test("never throws on garbage input", () => {
    expect(() => validate([n("x", ["y"]), n("y", ["x"]), n("", []), n("x", [])])).not.toThrow()
  })
})
