import type { MatchSnapshot, TacticalEventMetricId, TacticalEventPoint, TeamSide } from "@/types/match"
import { getHeatmap } from "@/api/heatmap"
import { opposite } from "@/features/analysis/metrics"

/**
 * Who actually faces whom, from where the players were on the pitch (the per-player heatmaps the
 * dashboard already builds from the frames, 4 per second).
 *
 * - Overlap: our player's positions while we have the ball against the opponent's positions in the same
 *   phase (they are defending), on 8×12 zones of the pitch (≈ 8,5 m × 8,8 m). Share of time in common, 0–1.
 * - Duels: the game does not name the opponent in a duel, so each event carries the opponent who was
 *   closest to the player at its tick (analysis/proximity.ts, from the frames). It counts as a duel with him
 *   only when he was close enough for that kind of action (limits below, from the distances measured on
 *   the calibration matches). A ball lost with nobody near is a misplaced pass, not a duel lost.
 *   Events without that information (older data) fall back to the facing opponent most present in the
 *   zone where they happened.
 *
 * Event coordinates (home attacks x = 100, home left at y low) and heatmap coordinates (raw pitch,
 * second half flipped, lateral then longitudinal) do not share an orientation: it depends on the end the
 * home team started at. It is read from the home goalkeeper's average position. Verified on the 9
 * calibration matches, both halves: home keeper at heatmap y > 50 ⇒ (hx, hy) = (y, 100 − x), otherwise
 * (100 − y, x); mean distance between a player's events and his average position 8–18 points with the
 * right orientation, 30–48 with the others.
 */

export type PairDuels = {
  /** Our dribbles completed with him the closest opponent. */
  dribbles: number
  /** Balls our player lost with him close. */
  lost: number
  /** His tackles won and interceptions against our player. */
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
  /** Players who face each other (zone overlap). */
  pairs: FacingPair[]
  /** Every pair with at least one duel, facing or not. */
  duelPairs: FacingPair[]
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

/**
 * Distance (m) to the closest opponent under which an event is a duel with him. Measured on the calibration
 * matches: aerial duels median 0,4 m (p90 1,4), tackles won 1,0 (p90 1,7), dribbles 2,5–3,1 (p90 ≈ 5),
 * interceptions 2,8 (p75 4,8), balls lost 3,5 (p75 7: many are passes with nobody near).
 */
const duelDistance = { dribbles: 5, lost: 3, aerialsWon: 2, aerialsLost: 2, defensive: 3 } as const

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

  const overlapOf = (attackerId: number, defenderId: number) => {
    const attacker = ours.get(attackerId)
    const defender = theirs.get(defenderId)
    if (!attacker || !defender) return 0
    let overlap = 0
    for (let zone = 0; zone < attacker.share.length; zone += 1) overlap += Math.min(attacker.share[zone], defender.share[zone])
    return overlap
  }
  const records = new Map<string, FacingPair>(pairs.map((pair) => [`${pair.attackerId}:${pair.defenderId}`, pair]))
  const duelsOf = (attackerId: number, defenderId: number) => {
    const key = `${attackerId}:${defenderId}`
    let record = records.get(key)
    if (!record) {
      record = { attackerId, defenderId, overlap: overlapOf(attackerId, defenderId), duels: emptyDuels() }
      records.set(key, record)
    }
    return record.duels
  }
  const facingAttacker = (attackerId: number) => pairs.filter((pair) => pair.attackerId === attackerId).map((pair) => pair.defenderId)
  const facingDefender = (defenderId: number) => pairs.filter((pair) => pair.defenderId === defenderId).map((pair) => pair.attackerId)
  const theirIds = new Set(match.players.filter((player) => player.team !== side).map((player) => player.id))
  const ourIds = new Set(match.players.filter((player) => player.team === side).map((player) => player.id))
  for (const event of match.tacticalEvents) {
    if (event.team === side && ourIds.has(event.playerId)) {
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
      if (event.nearestOpponentId != null && event.nearestOpponentDistance != null) {
        if (theirIds.has(event.nearestOpponentId) && event.nearestOpponentDistance <= duelDistance[kind])
          duelsOf(event.playerId, event.nearestOpponentId)[kind] += 1
        continue
      }
      if (!ours.has(event.playerId)) continue
      const defender = presentIn(zoneIndex(orient, event), facingAttacker(event.playerId), theirs)
      if (defender != null) duelsOf(event.playerId, defender)[kind] += 1
    } else if (event.team !== side && theirIds.has(event.playerId) && (is(event, "tacklesWon") || is(event, "interceptions"))) {
      if (event.nearestOpponentId != null && event.nearestOpponentDistance != null) {
        if (ourIds.has(event.nearestOpponentId) && event.nearestOpponentDistance <= duelDistance.defensive)
          duelsOf(event.nearestOpponentId, event.playerId).defensive += 1
        continue
      }
      if (!theirs.has(event.playerId)) continue
      const attacker = presentIn(zoneIndex(orient, event), facingDefender(event.playerId), ours)
      if (attacker != null) duelsOf(attacker, event.playerId).defensive += 1
    }
  }
  const all = [...records.values()]
  return {
    pairs,
    duelPairs: all.filter((record) => Object.values(record.duels).some((value) => value > 0)),
    facing: (defenderId) => pairs.filter((pair) => pair.defenderId === defenderId).sort((a, b) => b.overlap - a.overlap),
    pair: (attackerId, defenderId) => records.get(`${attackerId}:${defenderId}`),
  }
}

/** "4 dribles certos e 6 bolas perdidas frente a ele; 3 desarmes/interceções dele" — empty when nothing happened. */
export function duelSummary(duels: PairDuels) {
  const parts: string[] = []
  if (duels.dribbles) parts.push(`${duels.dribbles} drible(s) certo(s)`)
  if (duels.lost) parts.push(`${duels.lost} bola(s) perdida(s)`)
  if (duels.aerialsWon + duels.aerialsLost) parts.push(`${duels.aerialsWon} de ${duels.aerialsWon + duels.aerialsLost} duelos aéreos ganhos`)
  const ours = parts.length ? `${parts.join(", ")} frente a ele` : ""
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
