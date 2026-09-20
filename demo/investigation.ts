import { Attr, type ColorLike, type DagNode, type LabelSpan } from "../src/index"

/**
 * Generates a "lead investigator with parallel teams" graph.
 *
 * The lead is the main line (lane 0): kickoff, one *assignment* node per team from which that team branches
 * off, periodic check-ins (some receive team reports) and a final report that merges every team. Each team
 * works through phases; a phase either runs solo or spawns parallel agents that branch off the team and merge
 * back. After a phase a team may send a report to the lead's next check-in while its own lane continues
 * (`"report"`, default) or merge into it and resume from the lead node (`"rejoin"`).
 *
 * Reading aids built into the data: team nodes are `●` in the team colour, agents are `○` in a faded shade
 * of it with dimmed labels, lead labels are bold. Lay it out with `laneAllocation: "nested"`, `trunk`,
 * `colorStrategy: "group"` and `groupColors: groupColors(palette)`.
 */
export interface InvestigationOptions {
  seed?: number
  /** 2–6; default: random in that range. */
  teams?: number
  /** Phases per team, inclusive range. Default `[2, 3]`. */
  phases?: readonly [number, number]
  /** Parallel agents per phase, inclusive range; 0 means the team works solo. Default `[0, 3]`. */
  agents?: readonly [number, number]
  checkIn?: "report" | "rejoin"
  /** Lead check-in interval in days. Default 10. */
  checkInEvery?: number
}

export interface Investigation {
  title: string
  nodes: DagNode[]
  /** Pass as `trunk` so the lead stays in lane 0. */
  trunk: string[]
  teams: string[]
  /** Colours for the lead, each team and each team's agents, from a palette. */
  groupColors: (palette: readonly ColorLike[]) => Record<string, ColorLike>
}

const teamNames = ["genomics", "imaging", "clinical", "literature", "modelling", "assays"]
const phaseNames = ["scoping", "data", "analysis", "validation", "write-up"]
const roleNames = ["explorer", "analyst", "coder", "reviewer", "writer", "curator"]

function rng(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Mixes a hex colour toward a dark background so agent lanes read as a faded version of the team colour. */
export function fade(color: ColorLike, amount = 0.55): ColorLike {
  if (typeof color !== "string") return color
  const hex = color.replace("#", "")
  if (hex.length !== 6) return color
  const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16)
  const target = [0x1a, 0x1b, 0x26]
  const mixed = [channel(0), channel(2), channel(4)].map((v, i) =>
    Math.round(v + ((target[i] ?? 0) - v) * amount)
      .toString(16)
      .padStart(2, "0"),
  )
  return `#${mixed.join("")}`
}

interface LeadEvent {
  id: string
  time: number
  label: LabelSpan[]
  merges: string[]
}

const bold = (text: string): LabelSpan[] => [{ text, attrs: Attr.BOLD }]
const plain = (text: string): LabelSpan[] => [{ text }]
const dim = (text: string): LabelSpan[] => [{ text, attrs: Attr.DIM }]

export function investigation(options: InvestigationOptions = {}): Investigation {
  const seed = options.seed ?? 1
  const random = rng(seed)
  const between = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1))
  const pick = (list: readonly string[]) => list[Math.floor(random() * list.length)] ?? ""
  const teamCount = Math.max(2, Math.min(6, options.teams ?? between(2, 6)))
  const [minPhases, maxPhases] = options.phases ?? [2, 3]
  const [minAgents, maxAgents] = options.agents ?? [0, 3]
  const mode = options.checkIn ?? "report"
  const every = options.checkInEvery ?? 10

  const nodes: DagNode[] = []
  const add = (node: DagNode) => {
    nodes.push(node)
    return node.id
  }
  const checkInId = (k: number) => `lead-checkin-${k}`
  const events: LeadEvent[] = []
  const checkIns = new Map<number, LeadEvent>()
  const checkIn = (k: number): LeadEvent => {
    const existing = checkIns.get(k)
    if (existing !== undefined) return existing
    const event: LeadEvent = { id: checkInId(k), time: k * every, label: [], merges: [] }
    checkIns.set(k, event)
    events.push(event)
    return event
  }
  const finals: string[] = []
  let maxTime = 0

  const teams = teamNames.slice(0, teamCount)
  teams.forEach((team, index) => {
    const agents = `${team}/agents`
    // The lead assigns teams one after another on the main line; each team branches off its assignment.
    const assigned = 1 + index * 2
    const assignment: LeadEvent = {
      id: `lead-assign-${team}`,
      time: assigned,
      label: bold(`assigns ${team}`),
      merges: [],
    }
    events.push(assignment)
    let t = assigned + 0.5
    let last = add({ id: `${team}-plan`, parents: [assignment.id], time: t, label: bold(team), group: team })

    const phaseCount = between(minPhases, maxPhases)
    for (let p = 0; p < phaseCount; p++) {
      const phase = phaseNames[Math.min(p, phaseNames.length - 1)] ?? "work"
      const agentCount = between(minAgents, maxAgents)
      if (agentCount === 0) {
        t += between(2, 5)
        last = add({ id: `${team}-p${p}`, parents: [last], time: t, label: plain(phase), group: team })
      } else {
        // The team node at the split announces the phase and how many agents it spawns; the merge node
        // at the end only marks that their results came back.
        t += 0.5
        last = add({
          id: `${team}-p${p}-start`,
          parents: [last],
          time: t,
          label: [{ text: phase }, { text: ` · ${agentCount} agent${agentCount > 1 ? "s" : ""}`, attrs: Attr.DIM }],
          group: team,
        })
        const ends: string[] = []
        let end = t
        for (let a = 0; a < agentCount; a++) {
          const role = pick(roleNames)
          let previous = last
          let ta = t + 0.2 * (a + 1)
          const steps = between(1, 2)
          for (let s = 0; s < steps; s++) {
            ta += between(1, 3)
            previous = add({
              id: `${team}-p${p}-a${a}-s${s}`,
              parents: [previous],
              time: ta,
              label: dim(role),
              group: agents,
              marker: { glyph: "○" },
            })
          }
          ends.push(previous)
          end = Math.max(end, ta)
        }
        t = end + 1
        last = add({ id: `${team}-p${p}`, parents: [last, ...ends], time: t, label: dim("done"), group: team })
      }
      if (p === phaseCount - 1) {
        t += 1
        last = add({ id: `${team}-deliver`, parents: [last], time: t, label: plain("delivered"), group: team })
        finals.push(last)
        maxTime = Math.max(maxTime, t)
        break
      }
      if (random() < 0.6) {
        t += 0.5
        const reportId = add({ id: `${team}-report-${p}`, parents: [last], time: t, label: dim("report"), group: team })
        const k = Math.floor(t / every) + 1
        checkIn(k).merges.push(reportId)
        if (mode === "rejoin") {
          t = k * every + 0.5 + index * 0.1
          last = add({
            id: `${team}-resume-${k}`,
            parents: [checkInId(k)],
            time: t,
            label: plain("resumes"),
            group: team,
          })
        } else {
          last = reportId
          t += 1
        }
      }
    }
  })

  for (let k = 1; k <= Math.floor(maxTime / every); k++) checkIn(k)
  for (const event of checkIns.values()) {
    const count = event.merges.length
    event.label =
      count === 0 ? bold("check-in") : [...bold("check-in"), ...dim(` · ${count} report${count > 1 ? "s" : ""}`)]
  }

  let previous = add({ id: "lead-0", parents: [], time: 0, label: bold("kickoff"), group: "lead" })
  for (const event of events.sort((a, b) => a.time - b.time)) {
    add({ id: event.id, parents: [previous, ...event.merges], time: event.time, label: event.label, group: "lead" })
    previous = event.id
  }
  const lastEventTime = events.at(-1)?.time ?? 0
  add({
    id: "lead-final",
    parents: [previous, ...finals],
    time: Math.max(maxTime, lastEventTime) + 1,
    label: bold("final report"),
    group: "lead",
    marker: "current",
  })

  return {
    title: `${teamCount} teams · seed ${seed}`,
    nodes,
    trunk: ["lead-final"],
    teams,
    groupColors: (palette) => {
      const colors: Record<string, ColorLike> = { lead: palette[0] ?? "#ffffff" }
      teams.forEach((team, i) => {
        const color = palette[(i + 1) % palette.length] ?? "#ffffff"
        colors[team] = color
        colors[`${team}/agents`] = fade(color)
      })
      return colors
    },
  }
}
