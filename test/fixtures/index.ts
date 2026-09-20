import type { DagNode } from "../../src/index"

const n = (id: string, parents: string[], label = id, time?: number): DagNode => ({ id, parents, label, time })

/** The picture from the spec. Times put "approach B" above "approach A". */
export const picture: DagNode[] = [
  n("A", [], "initial prompt", 1),
  n("B", ["A"], "refine plan", 2),
  n("D", ["B"], "approach B", 3),
  n("C", ["B"], "approach A", 4),
  n("E", ["D"], "B: tests pass", 5),
  n("F", ["C", "E"], "merge B into A", 6),
  n("G", ["F"], "final answer", 7),
]

export const linear: DagNode[] = [n("A", []), n("B", ["A"]), n("C", ["B"]), n("D", ["C"])]

export const fork: DagNode[] = [n("A", []), n("B", ["A"]), n("C", ["A"]), n("D", ["B"])]

export const twoRoots: DagNode[] = [
  n("R", []),
  n("S", []),
  n("X", ["R"]),
  n("Y", ["S"]),
  n("M", ["X", "Y"]),
  n("Z", []),
  n("W", ["Z"]),
]

export const threeWay: DagNode[] = [
  n("A", []),
  n("B", ["A"]),
  n("C", ["A"]),
  n("D", ["A"]),
  n("E", ["B"]),
  n("F", ["C"]),
  n("G", ["D"]),
]

export const octopus: DagNode[] = [
  n("A", []),
  n("B", ["A"]),
  n("C", ["A"]),
  n("D", ["A"]),
  n("M", ["B", "C", "D"]),
  n("N", ["M"]),
]

export const crissCross: DagNode[] = [
  n("A", []),
  n("B", ["A"]),
  n("C", ["A"]),
  n("D", ["B", "C"]),
  n("E", ["C", "B"]),
  n("F", ["D"]),
  n("G", ["E"]),
]

/** `A → X` skips most rows in lane 1; the fork `B → D` and the merge `D → F` cross it. `G` stays the newest tip. */
export const longEdge: DagNode[] = [
  n("A", [], "A", 1),
  n("B", ["A"], "B", 2),
  n("C", ["B"], "C", 3),
  n("D", ["B"], "D", 4),
  n("E", ["C"], "E", 5),
  n("F", ["E", "D"], "F", 6),
  n("X", ["A"], "X", 7),
  n("G", ["F"], "G", 8),
]

/** Lane 1 is used by `Q`, freed at the merge into `X`, then reused by `Z`. */
export const laneReuse: DagNode[] = [
  n("P", []),
  n("Q", ["P"]),
  n("R", ["P"]),
  n("X", ["R", "Q"]),
  n("Y", ["X"]),
  n("Z", ["X"]),
  n("W", ["Y", "Z"]),
]

export const unknownParent: DagNode[] = [n("X", ["missing"]), n("Y", ["X"])]

export const cycle: DagNode[] = [n("A", ["C"]), n("B", ["A"]), n("C", ["B"])]

/** A side branch (`C1`) created after the trunk's next node (`P3`), with the newest tip on the side. */
export const sideBranchNewer: DagNode[] = [
  n("P1", [], "P1", 1),
  n("P2", ["P1"], "P2", 2),
  n("P3", ["P2"], "P3", 3),
  n("C1", ["P2"], "C1", 4),
  n("C2", ["C1"], "C2", 5),
]

export const all: Record<string, DagNode[]> = {
  picture,
  linear,
  fork,
  twoRoots,
  threeWay,
  octopus,
  crissCross,
  longEdge,
  laneReuse,
  sideBranchNewer,
}
