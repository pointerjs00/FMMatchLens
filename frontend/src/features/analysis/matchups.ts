import type { MatchSnapshot, TacticalEventMetricId, TacticalEventPoint, TeamSide } from "@/types/match"
import { getHeatmap } from "@/api/heatmap"
import { opposite } from "@/features/analysis/metrics"

/**
 * Who actually faces whom, from where the players were on the pitch (the per-player heatmaps the
 * dashboard already builds from the frames, 4 per second).
 *
 * - Overlap: our player's positions while we have the ball against the opponent's positions in the same
 *   phase (they are defending), on 8×12 zones of the pitch (≈ 8,5 m × 8,8 m). Share of time in common, 0–1.
 * - Duels: each of our dribbles, ball losses and aerial duels is credited to the facing opponent who spends
 *   most time in the zone where it happened; their tackles and interceptions are credited the same way to
 *   the facing player of ours. The game does not name the opponent in a duel, so this is "in his zone".
 *
 * Event coordinates (home attacks x = 100, home left at y low) and heatmap coordinates (raw pitch,
 * second half flipped, lateral then longitudinal) do not share an orientation: it depends on the end the
 * home team started at. It is read from the home goalkeeper's average position. Verified on the 9
 * calibration matches, both halves: home keeper at heatmap y > 50 ⇒ (hx, hy) = (y, 100 − x), otherwise
 * (100 − y, x); mean distance between a player's events and his average position 8–18 points with the
 * right orientation, 30–48 with the others.
 */

export type PairDuels = {
  /** Our dribbles completed in his zone. */
  dribbles: number
  /** Balls our player lost in his zone. */
  lost: number
  /** His tackles won and interceptions in our player's zone. */
  defensive: number
  aerialsWon: number
  aerialsLost: number
}

export type FacingPair = {
  attackerId: number
  defenderId: number
  /** Share of time in the same zones, 0–1. */
  overlap: number
  duels: PairDuels
}

export type FieldMatchups = {
  pairs: FacingPair[]
  /** Our players facing a given opponent (strongest overlap first). */
  facing(defenderId: number): FacingPair[]
  pair(attackerId: number, defenderId: number): FacingPair | undefined
}

const zoneColumns = 8
const zoneRows = 12
const gridWidth = 40
const gridHeight = 60
/** Below this many position samples a player has not been on the pitch long enough (≈ 3 minutes). */
const minSamples = 300
/** A pair faces each other when the overlap is at least this and close to the attacker's best one. */
const minOverlap = 0.45
const closeToBest = 0.85

type Zones = { time: Float64Array; share: Float64Array; samples: number }

function zonesOf(match: MatchSnapshot, playerId: number, phase: "inPossession" | "outOfPossession"): Zones {
  const grid = getHeatmap(match.heatmaps, { scope: { type: "player", playerId }, phase, range: "full" })
  const time = new Float64Array(zoneColumns * zoneRows)
  let total = 0
  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const value = grid.density[y * gridWidth + x] ?? 0
      time[Math.floor((y * zoneRows) / gridHeight) * zoneColumns + Math.floor((x * zoneColumns) / gridWidth)] += value
      total += value
    }
  }
  const share = total > 0 ? time.map((value) => value / total) : time
  return { time, share, samples: grid.sampleCount }
}

type Orientation = (x: number, y: number) => [number, number]

function orientation(match: MatchSnapshot): Orientation | undefined {
  const keeper = match.players.find(
    (player) => player.team === "home" && (player.inPossession?.position ?? player.position) === "GK" && player.isStarter
  )
  if (!keeper) return undefined
  const grid = getHeatmap(match.heatmaps, { scope: { type: "player", playerId: keeper.id }, phase: "all", range: "full" })
  if (grid.sampleCount < minSamples) return undefined
  if (grid.averageY > 60) return (x, y) => [y, 100 - x]
  if (grid.averageY < 40) return (x, y) => [100 - y, x]
  return undefined
}

function zoneIndex(orient: Orientation, event: TacticalEventPoint) {
  const [hx, hy] = orient(event.x, event.y)
  const column = Math.min(zoneColumns - 1, Math.max(0, Math.floor((hx / 100) * zoneColumns)))
  const row = Math.min(zoneRows - 1, Math.max(0, Math.floor((hy / 100) * zoneRows)))
  return row * zoneColumns + column
}

const is = (event: TacticalEventPoint, id: TacticalEventMetricId) => event.metricId === id || event.metricIds?.includes(id)

/**
 * Of the candidates (the players facing the one who made the event), the one who spends most time in the
 * zone, provided the zone is a real part of his game (2% of his time or more).
 */
function presentIn(zone: number, candidates: number[], group: Map<number, Zones>) {
  let best: number | undefined
  let bestTime = 0
  for (const id of candidates) {
    const zones = group.get(id)
    if (!zones || zones.share[zone] < 0.02) continue
    if (zones.time[zone] > bestTime) {
      bestTime = zones.time[zone]
      best = id
    }
  }
  return best
}

export function fieldMatchups(match: MatchSnapshot, side: TeamSide): FieldMatchups | undefined {
  if (!match.heatmaps?.grids?.size) return undefined
  const orient = orientation(match)
  if (!orient) return undefined
  const outfield = (team: TeamSide) =>
    match.players.filter((player) => player.team === team && (player.inPossession?.position ?? player.position) !== "GK")
  const ours = new Map<number, Zones>()
  for (const player of outfield(side)) {
    const zones = zonesOf(match, player.id, "inPossession")
    if (zones.samples >= minSamples) ours.set(player.id, zones)
  }
  const theirs = new Map<number, Zones>()
  for (const player of outfield(opposite(side))) {
    const zones = zonesOf(match, player.id, "outOfPossession")
    if (zones.samples >= minSamples) theirs.set(player.id, zones)
  }
  if (!ours.size || !theirs.size) return undefined

  const pairs: FacingPair[] = []
  const emptyDuels = (): PairDuels => ({ dribbles: 0, lost: 0, defensive: 0, aerialsWon: 0, aerialsLost: 0 })
  for (const [attackerId, attacker] of ours) {
    const overlaps = [...theirs].map(([defenderId, defender]) => {
      let overlap = 0
      for (let zone = 0; zone < attacker.share.length; zone += 1) overlap += Math.min(attacker.share[zone], defender.share[zone])
      return { defenderId, overlap }
    })
    const best = Math.max(...overlaps.map((item) => item.overlap))
    for (const { defenderId, overlap } of overlaps) {
      if (overlap >= minOverlap && overlap >= best * closeToBest) pairs.push({ attackerId, defenderId, overlap, duels: emptyDuels() })
    }
  }

  // Each duel goes to the pair it most likely involved: the facing opponent most present in that zone.
  const duelsOf = (attackerId: number, defenderId: number) =>
    pairs.find((pair) => pair.attackerId === attackerId && pair.defenderId === defenderId)!.duels
  const facingAttacker = (attackerId: number) => pairs.filter((pair) => pair.attackerId === attackerId).map((pair) => pair.defenderId)
  const facingDefender = (defenderId: number) => pairs.filter((pair) => pair.defenderId === defenderId).map((pair) => pair.attackerId)
  for (const event of match.tacticalEvents) {
    if (event.team === side && ours.has(event.playerId)) {
      const kind = is(event, "dribblesCompleted")
        ? "dribbles"
        : is(event, "possessionLost")
          ? "lost"
          : is(event, "aerialsWon")
            ? "aerialsWon"
            : is(event, "aerialsLost")
              ? "aerialsLost"
              : undefined
      if (!kind) continue
      const defender = presentIn(zoneIndex(orient, event), facingAttacker(event.playerId), theirs)
      if (defender != null) duelsOf(event.playerId, defender)[kind] += 1
    } else if (event.team !== side && theirs.has(event.playerId) && (is(event, "tacklesWon") || is(event, "interceptions"))) {
      const attacker = presentIn(zoneIndex(orient, event), facingDefender(event.playerId), ours)
      if (attacker != null) duelsOf(attacker, event.playerId).defensive += 1
    }
  }
  return {
    pairs,
    facing: (defenderId) => pairs.filter((pair) => pair.defenderId === defenderId).sort((a, b) => b.overlap - a.overlap),
    pair: (attackerId, defenderId) => pairs.find((item) => item.attackerId === attackerId && item.defenderId === defenderId),
  }
}

/** "4 dribles certos e 6 bolas perdidas na zona dele; 3 desarmes/interceções dele" — empty when nothing happened. */
export function duelSummary(duels: PairDuels) {
  const parts: string[] = []
  if (duels.dribbles) parts.push(`${duels.dribbles} drible(s) certo(s)`)
  if (duels.lost) parts.push(`${duels.lost} bola(s) perdida(s)`)
  if (duels.aerialsWon + duels.aerialsLost) parts.push(`${duels.aerialsWon} de ${duels.aerialsWon + duels.aerialsLost} duelos aéreos ganhos`)
  const ours = parts.length ? `${parts.join(", ")} na zona dele` : ""
  const theirs = duels.defensive ? `${duels.defensive} desarme(s)/interceção(ões) dele` : ""
  return [ours, theirs].filter(Boolean).join("; ")
}

/**
 * Our wins against our losses in that duel: dribbles and aerials won against balls lost and aerials lost.
 * His tackles are not added: most of them are the same moments as our balls lost.
 */
export function duelBalance(duels: PairDuels) {
  const wins = duels.dribbles + duels.aerialsWon
  const losses = duels.lost + duels.aerialsLost
  return { wins, losses, total: wins + losses }
}
