import type {
  MatchPlayer,
  MatchSnapshot,
  TacticalEventPoint,
  TeamSide,
  XgShotPoint,
} from "@/types/match"

/**
 * All spatial metrics are expressed from the analysed team's point of view:
 * `fx` 0 = own goal line, 100 = opponent goal line; `ly` 0 = own left touchline,
 * 100 = own right touchline. In archive and live snapshots the home team always
 * attacks towards x = 100 with its left flank at low y; the away team is mirrored.
 */
export type Lane = "left" | "centre" | "right"
export type Third = "defensive" | "middle" | "final"

export const ticksPerMinute = 240
export const ticksPerSecond = ticksPerMinute / 60

export function opposite(side: TeamSide): TeamSide {
  return side === "home" ? "away" : "home"
}

export function forwardX(side: TeamSide, x: number) {
  return side === "home" ? x : 100 - x
}

export function lateralY(side: TeamSide, y: number) {
  return side === "home" ? y : 100 - y
}

export function laneOf(ly: number): Lane {
  if (ly < 33.3) return "left"
  if (ly > 66.7) return "right"
  return "centre"
}

export function thirdOf(fx: number): Third {
  if (fx < 33.3) return "defensive"
  if (fx > 66.7) return "final"
  return "middle"
}

/** Penalty area: 16.5 m deep (~15.7% of 105 m) and 40.3 m wide (~59% of 68 m). */
export function inBox(fx: number, ly: number) {
  return fx >= 84 && ly >= 20 && ly <= 80
}

export type LaneShare = Record<Lane, number>

function emptyLanes(): LaneShare {
  return { left: 0, centre: 0, right: 0 }
}

function toShare(counts: LaneShare): LaneShare {
  const total = counts.left + counts.centre + counts.right
  if (total === 0) return emptyLanes()
  return {
    left: counts.left / total,
    centre: counts.centre / total,
    right: counts.right / total,
  }
}

export type TeamWindowMetrics = {
  side: TeamSide
  goals: number
  xg: number
  shots: number
  shotsOnTarget: number
  boxShots: number
  xgPerShot: number
  clearCutChances: number
  shotLaneShare: LaneShare
  /** Final-half attacking actions (passes, dribbles, crosses) by lane. */
  attackLaneShare: LaneShare
  attackActionCount: number
  passesCompleted: number
  passesAttempted: number
  passAccuracy: number
  finalThirdPassesCompleted: number
  crossesAttempted: number
  crossesCompleted: number
  dribblesCompleted: number
  offsides: number
  aerialsWon: number
  aerialsLost: number
  foulsCommitted: number
  possessionLost: number
  possessionLostByThird: Record<Third, number>
  possessionGained: number
  possessionGainedByThird: Record<Third, number>
  /** Regains with fx ≥ 60: the press won the ball high. */
  highRegains: number
  /** Mean fx of regains, tackles won and interceptions. */
  defensiveActionHeight?: number
  /** Regains within 8 s of losing the ball. */
  counterPressRecoveries: number
  /** Every loss of possession (each one is a counter-press opportunity). */
  counterPressOpportunities: number
  /** Shots taken within 15 s of winning the ball. */
  transitionShots: number
  transitionXg: number
  /** Possession proxy over the window: share of completed passes. */
  passShare: number
  possessionShare?: number
}

export type AnalysisWindow = {
  fromMinute: number
  toMinute: number
  label: string
}

const metricOf = (event: TacticalEventPoint, id: TacticalEventPoint["metricId"]) =>
  event.metricId === id || event.metricIds?.includes(id) === true

export function windowEvents(match: MatchSnapshot, window: AnalysisWindow) {
  const inWindow = (minute: number) =>
    minute >= window.fromMinute && minute <= window.toMinute
  return {
    events: match.tacticalEvents.filter((event) => inWindow(event.minute)),
    shots: match.xgShots.filter((shot) => inWindow(shot.minute)),
  }
}

export function computeTeamMetrics(
  match: MatchSnapshot,
  side: TeamSide,
  window: AnalysisWindow
): TeamWindowMetrics {
  const { events, shots } = windowEvents(match, window)
  const allEvents = match.tacticalEvents
  const own = events.filter((event) => event.team === side)
  const ownShots = shots.filter((shot) => shot.team === side)
  const count = (id: TacticalEventPoint["metricId"]) =>
    own.filter((event) => metricOf(event, id)).length

  const shotLanes = emptyLanes()
  let boxShots = 0
  for (const shot of ownShots) {
    const fx = forwardX(side, shot.x)
    const ly = lateralY(side, shot.y)
    shotLanes[laneOf(ly)] += 1
    if (inBox(fx, ly)) boxShots += 1
  }

  const attackLanes = emptyLanes()
  let attackActionCount = 0
  let finalThirdPassesCompleted = 0
  for (const event of own) {
    const isAttackAction =
      metricOf(event, "passesCompleted") ||
      metricOf(event, "dribblesCompleted") ||
      metricOf(event, "crossesCompleted") ||
      metricOf(event, "crossesIncomplete")
    if (!isAttackAction) continue
    const fx = forwardX(side, event.x)
    if (metricOf(event, "passesCompleted") && event.endX != null) {
      if (forwardX(side, event.endX) > 66.7) finalThirdPassesCompleted += 1
    }
    if (fx < 50) continue
    attackActionCount += 1
    attackLanes[laneOf(lateralY(side, event.y))] += 1
  }

  const lostByThird: Record<Third, number> = { defensive: 0, middle: 0, final: 0 }
  const gainedByThird: Record<Third, number> = { defensive: 0, middle: 0, final: 0 }
  let highRegains = 0
  const defensiveHeights: number[] = []
  for (const event of own) {
    const fx = forwardX(side, event.x)
    if (metricOf(event, "possessionLost")) lostByThird[thirdOf(fx)] += 1
    if (metricOf(event, "possessionGained")) {
      gainedByThird[thirdOf(fx)] += 1
      if (fx >= 60) highRegains += 1
    }
    if (
      metricOf(event, "possessionGained") ||
      metricOf(event, "tacklesWon") ||
      metricOf(event, "interceptions")
    ) {
      defensiveHeights.push(fx)
    }
  }

  // Transition sequences are read over the full event stream so a loss at
  // 59:58 still pairs with a regain at 60:02 inside a "from 60'" window.
  const transitions = analyseTransitions(allEvents, match.xgShots, side, window)

  const passesCompleted = count("passesCompleted")
  const passesIncomplete = count("passesIncomplete")
  const opponentPasses = events.filter(
    (event) => event.team !== side && metricOf(event, "passesCompleted")
  ).length
  const teamStats = match[side].stats
  const opponentStats = match[opposite(side)].stats
  const possessionTotal = teamStats.possessionTime + opponentStats.possessionTime
  const fullMatchWindow = window.fromMinute <= 0

  const xg = ownShots.reduce((sum, shot) => sum + shot.xg, 0)
  return {
    side,
    goals: ownShots.filter((shot) => shot.metricId === "goals").length,
    xg,
    shots: ownShots.length,
    shotsOnTarget: ownShots.filter(
      (shot) => shot.metricId === "shotsOnTarget" || shot.metricId === "goals"
    ).length,
    boxShots,
    xgPerShot: ownShots.length > 0 ? xg / ownShots.length : 0,
    clearCutChances: own.filter((event) =>
      event.annotations?.includes("clearCutChance")
    ).length,
    shotLaneShare: toShare(shotLanes),
    attackLaneShare: toShare(attackLanes),
    attackActionCount,
    passesCompleted,
    passesAttempted: passesCompleted + passesIncomplete,
    passAccuracy:
      passesCompleted + passesIncomplete > 0
        ? passesCompleted / (passesCompleted + passesIncomplete)
        : 0,
    finalThirdPassesCompleted,
    crossesAttempted: count("crossesCompleted") + count("crossesIncomplete"),
    crossesCompleted: count("crossesCompleted"),
    dribblesCompleted: count("dribblesCompleted"),
    offsides: count("offsides"),
    aerialsWon: count("aerialsWon"),
    aerialsLost: count("aerialsLost"),
    foulsCommitted: count("foulsCommitted"),
    possessionLost: count("possessionLost"),
    possessionLostByThird: lostByThird,
    possessionGained: count("possessionGained"),
    possessionGainedByThird: gainedByThird,
    highRegains,
    defensiveActionHeight:
      defensiveHeights.length >= 5
        ? defensiveHeights.reduce((sum, value) => sum + value, 0) /
          defensiveHeights.length
        : undefined,
    ...transitions,
    passShare:
      passesCompleted + opponentPasses > 0
        ? passesCompleted / (passesCompleted + opponentPasses)
        : 0.5,
    possessionShare:
      fullMatchWindow && possessionTotal > 0
        ? teamStats.possessionTime / possessionTotal
        : undefined,
  }
}

function analyseTransitions(
  events: readonly TacticalEventPoint[],
  shots: readonly XgShotPoint[],
  side: TeamSide,
  window: AnalysisWindow
) {
  const sorted = [...events].sort((a, b) => a.tick - b.tick)
  // A regain can be logged as a possession gain, a won tackle or an
  // interception; all three end the opponent's attack.
  const regainTicks = sorted
    .filter(
      (event) =>
        event.team === side &&
        (metricOf(event, "possessionGained") ||
          metricOf(event, "tacklesWon") ||
          metricOf(event, "interceptions"))
    )
    .map((event) => event.tick)
  const inWindow = (minute: number) =>
    minute >= window.fromMinute && minute <= window.toMinute
  // FM's event log only records a regain when possession is formally won, so
  // real-football "5 second" windows undercount: in sampled FM27 matches both
  // teams regain within 5 s only ~8% of the time and within 8 s ~15-20%.
  const counterPressWindow = 8 * ticksPerSecond
  const transitionWindow = 15 * ticksPerSecond

  let counterPressRecoveries = 0
  let counterPressOpportunities = 0
  for (const loss of sorted) {
    if (loss.team !== side || !metricOf(loss, "possessionLost")) continue
    if (!inWindow(loss.minute)) continue
    // Losses in the opponent's box after a shot or cross are not
    // counter-press situations FM treats differently; keep them anyway, the
    // ratio is what matters.
    counterPressOpportunities += 1
    if (
      regainTicks.some(
        (tick) => tick > loss.tick && tick - loss.tick <= counterPressWindow
      )
    ) {
      counterPressRecoveries += 1
    }
  }

  let transitionShots = 0
  let transitionXg = 0
  for (const shot of shots) {
    if (shot.team !== side || !inWindow(shot.minute)) continue
    const regain = lastBefore(regainTicks, shot.tick)
    if (regain != null && shot.tick - regain <= transitionWindow) {
      transitionShots += 1
      transitionXg += shot.xg
    }
  }
  return {
    counterPressRecoveries,
    counterPressOpportunities,
    transitionShots,
    transitionXg,
  }
}

function lastBefore(sortedTicks: readonly number[], tick: number) {
  let result: number | undefined
  for (const value of sortedTicks) {
    if (value > tick) break
    result = value
  }
  return result
}

/** Momentum share in [−1, 1] from the analysed team's perspective. */
export function momentumBalance(
  match: MatchSnapshot,
  side: TeamSide,
  window: AnalysisWindow
) {
  const points = match.rollingMomentum.length > 0 ? match.rollingMomentum : match.momentum
  const selected = points.filter(
    (point) => point.minute >= window.fromMinute && point.minute <= window.toMinute
  )
  if (selected.length === 0) return undefined
  const mean =
    selected.reduce((sum, point) => sum + point.value, 0) / selected.length
  return side === "home" ? mean : -mean
}

export function minutesPlayed(player: MatchPlayer, currentMinute: number) {
  const start = player.isStarter ? 0 : player.status?.subbedOnMinute
  if (start == null) return 0
  const end = player.status?.subbedOffMinute ?? currentMinute
  return Math.max(0, end - start)
}

export function hasPlayed(player: MatchPlayer) {
  return player.isStarter || player.status?.subbedOnMinute != null
}

export function isAvailableSubstitute(player: MatchPlayer) {
  return !player.isStarter && player.status?.subbedOnMinute == null && !player.isOnPitch
}
