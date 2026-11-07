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

export { teamInstructionById } from "@/features/analysis/tacticInstructionIds"
import { teamInstructionById } from "@/features/analysis/tacticInstructionIds"
import { applyUiValue } from "@/features/analysis/uiTactic"

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
    if (appliedOnly && change.appliedTick == null && !change.initial) continue
    if (change.source === "ui") {
      if (change.kind === "teamInstruction") result = applyUiValue(result, change)
    } else if (change.kind === "mentality" && change.mentality != null && change.mentality >= 1 && change.mentality <= 7) {
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
  if (change.source === "ui") {
    const title = change.uiTitle ?? "Instrução"
    if (change.kind === "playerInstruction") {
      const who = change.playerName ? `${change.playerName} · ` : ""
      const unknown = change.playerName ? "" : " (jogador não identificado)"
      return `Instrução individual · ${who}${title}: ${change.fromLabel ?? "?"} → ${change.toLabel}${unknown}`
    }
    if (change.initial) return `${title}: ${change.toLabel}`
    const since = minuteOf(change.uiSinceDisplayTick)
    const seen = minuteOf(change.displayTick) ?? 0
    const when = since != null && since < seen ? ` (feita entre ${since}' e ${seen}')` : ""
    return `${title}: ${change.fromLabel ?? "?"} → ${change.toLabel}${when}`
  }
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
    case "uiValues":
      return "Instruções mostradas pelo jogo"
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
  /** Minutes played since it was applied, when still too few to compare. */
  tooShortMinutes?: number
}

export type ComparisonRow = {
  label: string
  before: number
  after: number
  format: "dec" | "dec1" | "pct" | "int"
  /** +1 if higher is better for us, −1 if lower is better, 0 if neutral. */
  better: 1 | -1 | 0
}

/**
 * `beforeAfter`: our team before vs after. `vsOpponent`: no "before" yet (change in the first minutes), so
 * the opponent (`before` values) vs our team (`after` values) in the same window.
 */
export type TacticComparison = {
  mode: "beforeAfter" | "vsOpponent"
  before: AnalysisWindow
  after: AnalysisWindow
  beforeMinutes: number
  afterMinutes: number
  /** Rates per 90 minutes (both sides long enough) or totals in each window. */
  perNinety: boolean
  /** Both sides long enough to read the difference as an effect (colours are shown only then). */
  reliable: boolean
  rows: ComparisonRow[]
}

export type TacticChangesReport = {
  moments: TacticMoment[]
  /** From the first applied change until now, when there are at least two. */
  overall?: { fromMinute: number; comparison: TacticComparison }
}

/** Below this many minutes on either side differences are noise (one shot in 2 minutes = 45 per 90). */
export const reliableComparisonMinutes = 8
/** Below this many minutes after a change there is nothing to compare yet. */
const minimumComparisonMinutes = 3

const windowMinutes = (window: AnalysisWindow) => Math.max(0, window.toMinute - window.fromMinute + 1)

/**
 * Groups the changes applied at the same stoppage and compares the team before (since the previous
 * applied change) and after (until the next one, or now). Initial values are not moments.
 */
export function tacticChangesReport(
  match: MatchSnapshot,
  side: TeamSide,
  profile: TacticProfile,
  changes: readonly TacticChange[]
): TacticChangesReport {
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

  const moments = groups.map((group): TacticMoment => {
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
    if (pending) return { minute, madeMinute, pending, lines }

    const previous = appliedMinutes.filter((value) => value < minute).at(-1) ?? 0
    const next = appliedMinutes.find((value) => value > minute) ?? now + 1
    const after = minuteWindow(minute, Math.min(now, next - 1))
    const comparison = compareWindows(match, side, minuteWindow(previous, minute - 1), after)
    return comparison
      ? { minute, madeMinute, pending, lines, comparison }
      : { minute, madeMinute, pending, lines, tooShortMinutes: windowMinutes(after) }
  })

  let overall: TacticChangesReport["overall"]
  if (appliedMinutes.length >= 2) {
    const fromMinute = appliedMinutes[0]
    const comparison = compareWindows(match, side, minuteWindow(0, fromMinute - 1), minuteWindow(fromMinute, now))
    if (comparison) overall = { fromMinute, comparison }
  }
  return { moments, overall }
}

function minuteWindow(fromMinute: number, toMinute: number): AnalysisWindow {
  return { fromMinute, toMinute, label: fromMinute === toMinute ? `${fromMinute}'` : `${fromMinute}'–${toMinute}'` }
}

function compareWindows(
  match: MatchSnapshot,
  side: TeamSide,
  before: AnalysisWindow,
  after: AnalysisWindow
): TacticComparison | undefined {
  const afterMinutes = windowMinutes(after)
  if (afterMinutes < minimumComparisonMinutes) return undefined
  const beforeMinutes = windowMinutes(before)
  if (beforeMinutes < minimumComparisonMinutes) {
    // Nothing to compare with yet: the opponent against our team in the same minutes.
    const perNinety = afterMinutes >= reliableComparisonMinutes
    return {
      mode: "vsOpponent",
      before: after,
      after,
      beforeMinutes: afterMinutes,
      afterMinutes,
      perNinety,
      reliable: perNinety,
      rows: teamRows(
        computeTeamMetrics(match, opposite(side), after),
        computeTeamMetrics(match, side, after),
        after,
        after,
        perNinety
      ),
    }
  }

  const perNinety = beforeMinutes >= reliableComparisonMinutes && afterMinutes >= reliableComparisonMinutes
  const ours = [computeTeamMetrics(match, side, before), computeTeamMetrics(match, side, after)] as const
  const theirs = [computeTeamMetrics(match, opposite(side), before), computeTeamMetrics(match, opposite(side), after)] as const
  const rows = teamRows(ours[0], ours[1], before, after, perNinety)
  // What the opponent created against us, next to our own chances.
  rows.splice(1, 0, rateRow("xG sofrido", theirs[0].xg, theirs[1].xg, before, after, perNinety, "dec", -1))
  rows.splice(3, 0, rateRow("Remates sofridos", theirs[0].shots, theirs[1].shots, before, after, perNinety, "int", -1))
  const momentumBefore = momentumBalance(match, side, before)
  const momentumAfter = momentumBalance(match, side, after)
  if (momentumBefore != null && momentumAfter != null) {
    rows.push({ label: "Domínio (momentum)", before: momentumBefore, after: momentumAfter, format: "dec", better: 1 })
  }
  return { mode: "beforeAfter", before, after, beforeMinutes, afterMinutes, perNinety, reliable: perNinety, rows }
}

function rateRow(
  label: string,
  before: number,
  after: number,
  beforeWindow: AnalysisWindow,
  afterWindow: AnalysisWindow,
  perNinety: boolean,
  format: "dec" | "int",
  better: 1 | -1
): ComparisonRow {
  if (!perNinety) return { label, before, after, format, better }
  const rate = (value: number, window: AnalysisWindow) => (value * 90) / Math.max(1, windowMinutes(window))
  return {
    label: `${label} por 90'`,
    before: rate(before, beforeWindow),
    after: rate(after, afterWindow),
    format: format === "int" ? "dec1" : "dec",
    better,
  }
}

/** Rows for one team in two windows (or two teams in one window, for the "vs opponent" mode). */
function teamRows(
  a: TeamWindowMetrics,
  b: TeamWindowMetrics,
  aWindow: AnalysisWindow,
  bWindow: AnalysisWindow,
  perNinety: boolean
): ComparisonRow[] {
  const rows: ComparisonRow[] = [
    rateRow("xG", a.xg, b.xg, aWindow, bWindow, perNinety, "dec", 1),
    rateRow("Remates", a.shots, b.shots, aWindow, bWindow, perNinety, "int", 1),
    { label: "Posse (passes certos)", before: a.passShare, after: b.passShare, format: "pct", better: 0 },
    { label: "Passes certos", before: a.passAccuracy, after: b.passAccuracy, format: "pct", better: 1 },
    rateRow("Perdas de bola", a.possessionLost, b.possessionLost, aWindow, bWindow, perNinety, "int", -1),
    rateRow("Recuperações altas", a.highRegains, b.highRegains, aWindow, bWindow, perNinety, "int", 1),
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
  return rows
}
