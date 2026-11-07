/**
 * Tactical changes recorded automatically by the plugin (TacticChangeTracker): mentality, team
 * instruction quick changes, individual instruction steps, swaps and unidentified confirmations.
 * They arrive from `/api/match/tactics` (live) and from tactic change records in `.fmlens` archives.
 *
 * FM applies a change only at the next stoppage; the plugin stamps `appliedTick` with the first frame
 * after the change with the ball out of play or standing still. Before/after comparisons use that
 * minute, not the minute the change was made.
 */
import type { MatchSnapshot, TeamSide } from "@/types/match"
import {
  computeTeamMetrics,
  momentumBalance,
  opposite,
  ticksPerMinute,
  type AnalysisWindow,
  type TeamWindowMetrics,
} from "@/features/analysis/metrics"
import {
  instructionLabel,
  teamInstructionDefinitions,
  type TacticProfile,
  type TeamInstructionId,
} from "@/features/analysis/tacticProfile"

export {
  archivedTacticChanges,
  decodeTacticChangeRecord,
  fetchLiveTacticChanges,
  mergeTacticChanges,
  rememberTacticChanges,
  type LiveTacticChanges,
  type TacticChange,
  type TacticChangeKind,
} from "@/features/analysis/tacticChangeRecords"
import type { TacticChange } from "@/features/analysis/tacticChangeRecords"

/** Changes made up to the current replay/live position. */
export function changesUpTo(changes: readonly TacticChange[], match: MatchSnapshot) {
  const now = match.clock.minute * ticksPerMinute + match.clock.second * (ticksPerMinute / 60)
  return changes.filter((change) => change.initial || change.displayTick <= now + ticksPerMinute / 60)
}

// ── Names ────────────────────────────────────────────────────────────────

/** FM27 PT names (as in the match bar), index = mentality − 1. */
export const fmMentalityNames = [
  "Muito Defensiva",
  "Defender",
  "Cautelosa",
  "Equilibrada",
  "Positiva",
  "Atacar",
  "Muito Atacante",
] as const

const profileMentalities: TacticProfile["mentality"][] = [
  "veryDefensive",
  "defensive",
  "cautious",
  "balanced",
  "positive",
  "attacking",
  "veryAttacking",
]

export function mentalityName(value: number | null | undefined) {
  return value != null && value >= 1 && value <= 7 ? fmMentalityNames[value - 1] : "?"
}

/** FM `TacticTeamInstructions` id → instruction of the "Tática" tab (same option order as the game). */
export const teamInstructionById: Partial<Record<number, TeamInstructionId>> = {
  1: "passingDirectness",
  3: "attackingTransition",
  4: "attackingWidth",
  5: "creativeFreedom",
  6: "setPieces",
  7: "timeWasting",
  8: "lineOfEngagement",
  9: "defensiveLine",
  10: "triggerPress",
  11: "defensiveTransition",
  12: "tackling",
  15: "defensiveLineBehaviour",
  16: "gkDistribution",
  17: "gkDistributionSpeed",
  18: "patience",
  19: "dribbling",
  20: "passReception",
  21: "tempo",
  22: "crossEngagement",
  23: "shortGkDistribution",
  24: "buildUp",
  25: "pressingTrap",
  26: "crossingStyle",
  27: "shotsFromDistance",
  29: "goalKicks",
  30: "progressThrough",
}

const otherInstructionNames: Partial<Record<number, string>> = {
  0: "Formação",
  2: "Verticalidade do passe",
  13: "Estilo tático",
  14: "Mentalidade",
  28: "Corridas de apoio",
  31: "Corridas de apoio (2.º)",
  32: "GR sobe nas bolas paradas",
}

function instructionTitle(change: TacticChange) {
  const id = change.instruction ?? -1
  const mapped = teamInstructionById[id]
  if (mapped) return teamInstructionDefinitions.find((item) => item.id === mapped)?.label ?? mapped
  return otherInstructionNames[id] ?? change.instructionName ?? `Instrução ${id}`
}

/** Option value after moving `steps` levels from `value` (clamped to the option list). */
export function stepOption(id: TeamInstructionId, value: string, steps: number) {
  const options = teamInstructionDefinitions.find((item) => item.id === id)?.options ?? []
  const index = options.findIndex((option) => option.value === value)
  if (index < 0) return value
  return options[Math.min(options.length - 1, Math.max(0, index + steps))].value
}

// ── Effective tactic ────────────────────────────────────────────────────

/**
 * The tactic in force after `changes` (only the ones already applied when `appliedOnly`): the starting
 * tactic from the "Tática" tab, the mentality detected by the plugin and the quick-change steps.
 */
export function applyTacticChanges(
  profile: TacticProfile,
  changes: readonly TacticChange[],
  appliedOnly = false
): TacticProfile {
  let result: TacticProfile = { ...profile, team: { ...profile.team } }
  for (const change of changes) {
    if (appliedOnly && change.appliedTick == null) continue
    if (change.kind === "mentality" && change.mentality != null && change.mentality >= 1 && change.mentality <= 7) {
      result = { ...result, mentality: profileMentalities[change.mentality - 1] }
    } else if (change.kind === "teamInstruction" && change.steps) {
      const id = teamInstructionById[change.instruction ?? -1]
      if (id) result.team[id] = stepOption(id, result.team[id], change.steps)
    }
  }
  return result
}

// ── Descriptions ────────────────────────────────────────────────────────

export function minuteOf(displayTick: number | null | undefined) {
  return displayTick == null ? undefined : Math.floor(displayTick / ticksPerMinute)
}

/**
 * One line per change, in the words of the game. `before` is the tactic just before the change, so team
 * instructions read "Ritmo: Mais rápido → Muito mais lento".
 */
export function describeTacticChange(change: TacticChange, before?: TacticProfile) {
  switch (change.kind) {
    case "mentality":
      if (change.initial) return `Mentalidade inicial: ${change.mentalityName ?? mentalityName(change.mentality)}`
      return `Mentalidade: ${mentalityName(change.previousMentality)} → ${change.mentalityName ?? mentalityName(change.mentality)}`
    case "teamInstruction": {
      const id = teamInstructionById[change.instruction ?? -1]
      const steps = change.steps ?? 0
      if (id && before) {
        const from = before.team[id]
        return `${instructionTitle(change)}: ${instructionLabel(id, from)} → ${instructionLabel(id, stepOption(id, from, steps))}`
      }
      return `${instructionTitle(change)}: ${steps > 0 ? "+" : ""}${steps} ${Math.abs(steps) === 1 ? "nível" : "níveis"}`
    }
    case "playerInstruction": {
      const count = change.stepCount ?? Math.abs(change.steps ?? 0)
      return `Instrução individual alterada (${count} ${count === 1 ? "passo" : "passos"}; jogador e instrução não identificados)`
    }
    case "swap":
      return "Substituição ou troca de posições"
    case "confirmed":
      return "Alteração confirmada no ecrã de táticas (conteúdo não identificado)"
  }
}

// ── Before / after ──────────────────────────────────────────────────────

export type TacticMoment = {
  /** Applied minute (or the minute it was made, while still pending). */
  minute: number
  madeMinute: number
  pending: boolean
  lines: string[]
  comparison?: TacticComparison
}

export type ComparisonRow = {
  label: string
  before: number
  after: number
  format: "dec" | "pct" | "int"
  /** +1 if higher is better for us, −1 if lower is better, 0 if neutral. */
  better: 1 | -1 | 0
}

export type TacticComparison = {
  before: AnalysisWindow
  after: AnalysisWindow
  rows: ComparisonRow[]
  /** Fewer than this many minutes on either side: numbers are indicative only. */
  shortWindow: boolean
}

const minimumComparisonMinutes = 8

/**
 * Groups the changes applied at the same stoppage and compares the team before (since the previous
 * applied change) and after (until the next one, or now). Initial values are not moments.
 */
export function tacticMoments(
  match: MatchSnapshot,
  side: TeamSide,
  profile: TacticProfile,
  changes: readonly TacticChange[]
): TacticMoment[] {
  const now = Math.max(1, match.clock.minute)
  const visible = changesUpTo(changes, match).filter((change) => !change.initial)
  const groups: TacticChange[][] = []
  for (const change of visible) {
    const key = change.appliedTick ?? `pending-${change.sequence}`
    const last = groups.at(-1)
    const lastKey = last && (last[0].appliedTick ?? `pending-${last[0].sequence}`)
    if (last && lastKey === key) last.push(change)
    else groups.push([change])
  }

  const appliedMinutes = groups
    .filter((group) => group[0].appliedTick != null)
    .map((group) => minuteOf(group[0].appliedDisplayTick) ?? 0)

  return groups.map((group) => {
    const first = group[0]
    const pending = first.appliedTick == null
    const madeMinute = minuteOf(first.displayTick) ?? 0
    const minute = pending ? madeMinute : minuteOf(first.appliedDisplayTick) ?? madeMinute
    const appliedBefore = changes.filter(
      (change) => change.initial || (change.appliedTick != null && change.sequence < first.sequence)
    )
    let running = applyTacticChanges(profile, appliedBefore, true)
    const lines: string[] = []
    for (const change of group) {
      lines.push(describeTacticChange(change, running))
      running = applyTacticChanges(running, [change])
    }

    let comparison: TacticComparison | undefined
    if (!pending) {
      const previous = appliedMinutes.filter((value) => value < minute).at(-1) ?? 0
      const next = appliedMinutes.find((value) => value > minute) ?? now + 1
      const before: AnalysisWindow = { fromMinute: previous, toMinute: minute - 1, label: `${previous}'–${minute - 1}'` }
      const after: AnalysisWindow = { fromMinute: minute, toMinute: Math.min(now, next - 1), label: `${minute}'–${Math.min(now, next - 1)}'` }
      const beforeMinutes = before.toMinute - before.fromMinute + 1
      const afterMinutes = after.toMinute - after.fromMinute + 1
      if (beforeMinutes >= 1 && afterMinutes >= 1) {
        comparison = {
          before,
          after,
          rows: compare(match, side, before, after),
          shortWindow: beforeMinutes < minimumComparisonMinutes || afterMinutes < minimumComparisonMinutes,
        }
      }
    }
    return { minute, madeMinute, pending, lines, comparison }
  })
}

function per90(value: number, window: AnalysisWindow) {
  return (value * 90) / Math.max(1, window.toMinute - window.fromMinute + 1)
}

function compare(match: MatchSnapshot, side: TeamSide, before: AnalysisWindow, after: AnalysisWindow): ComparisonRow[] {
  const ours = (window: AnalysisWindow) => computeTeamMetrics(match, side, window)
  const theirs = (window: AnalysisWindow) => computeTeamMetrics(match, opposite(side), window)
  const [a, b, oa, ob] = [ours(before), ours(after), theirs(before), theirs(after)]
  const rate = (metrics: TeamWindowMetrics, window: AnalysisWindow, pick: (m: TeamWindowMetrics) => number) =>
    per90(pick(metrics), window)
  const rows: ComparisonRow[] = [
    { label: "xG por 90'", before: rate(a, before, (m) => m.xg), after: rate(b, after, (m) => m.xg), format: "dec", better: 1 },
    { label: "xG sofrido por 90'", before: rate(oa, before, (m) => m.xg), after: rate(ob, after, (m) => m.xg), format: "dec", better: -1 },
    { label: "Remates por 90'", before: rate(a, before, (m) => m.shots), after: rate(b, after, (m) => m.shots), format: "int", better: 1 },
    { label: "Remates sofridos por 90'", before: rate(oa, before, (m) => m.shots), after: rate(ob, after, (m) => m.shots), format: "int", better: -1 },
    { label: "Posse (passes certos)", before: a.passShare, after: b.passShare, format: "pct", better: 0 },
    { label: "Passes certos", before: a.passAccuracy, after: b.passAccuracy, format: "pct", better: 1 },
    { label: "Perdas de bola por 90'", before: rate(a, before, (m) => m.possessionLost), after: rate(b, after, (m) => m.possessionLost), format: "int", better: -1 },
    { label: "Recuperações altas por 90'", before: rate(a, before, (m) => m.highRegains), after: rate(b, after, (m) => m.highRegains), format: "int", better: 1 },
  ]
  if (a.defensiveActionHeight != null && b.defensiveActionHeight != null) {
    rows.push({
      label: "Altura das ações defensivas",
      before: a.defensiveActionHeight / 100,
      after: b.defensiveActionHeight / 100,
      format: "pct",
      better: 0,
    })
  }
  const momentumBefore = momentumBalance(match, side, before)
  const momentumAfter = momentumBalance(match, side, after)
  if (momentumBefore != null && momentumAfter != null) {
    rows.push({ label: "Domínio (momentum)", before: momentumBefore, after: momentumAfter, format: "dec", better: 1 })
  }
  return rows
}
