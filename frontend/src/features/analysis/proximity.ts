import type { RealtimeFrame, RealtimeMomentumEvent } from "@/api/realtimeMatch"
import type { TacticalEventPoint } from "@/types/match"

/**
 * Fork: the opponent closest to the player who made each match event, at the tick of the event.
 *
 * The game's event log does not say who the opponent in a duel was. The frames hold every player's
 * position (metres from the centre spot, 4 per second), so the derivations keep the last two minutes of
 * positions and, when an event arrives, look up where everyone was at its tick. The result is stored on the
 * tactical event (`nearestOpponentId`, `nearestOpponentDistance`) and used by analysis/matchups.ts.
 */

type Position = { id: number; team: "home" | "away"; x: number; y: number }

export type ProximityState = { ticks: number[]; positions: Position[][] }

/** Events reach the frames a little after their tick; two minutes of positions covers the late ones. */
const keptTicks = 240 * 2
/** A frame within this many ticks (2 s) of the event stands for its moment. */
const maxTickGap = 8

export class ProximityTracker {
  private ticks: number[] = []
  private positions: Position[][] = []

  appendFrame(frame: RealtimeFrame) {
    const last = this.ticks.at(-1)
    if (last != null && frame.tick <= last) {
      if (frame.tick < last) this.reset() // seek backwards / new match
      else return
    }
    const players: Position[] = []
    for (const player of frame.players) {
      if (!player.isOnPitch || !Number.isFinite(player.x) || !Number.isFinite(player.y)) continue
      players.push({ id: player.playerId, team: player.team, x: player.x, y: player.y })
    }
    this.ticks.push(frame.tick)
    this.positions.push(players)
    let drop = 0
    while (drop < this.ticks.length && this.ticks[drop] < frame.tick - keptTicks) drop += 1
    if (drop > 0) {
      this.ticks.splice(0, drop)
      this.positions.splice(0, drop)
    }
  }

  /**
   * The event point with the closest opponent of its player at the event's tick, when that moment is still
   * kept; a revision of the event that arrives too late keeps the annotation of the earlier version.
   */
  annotate(
    point: TacticalEventPoint | undefined,
    event: RealtimeMomentumEvent,
    earlier?: TacticalEventPoint
  ): TacticalEventPoint | undefined {
    if (!point) return point
    const players = this.at(event.tick)
    const actor = players?.find((player) => player.id === event.playerId)
    if (!players || !actor) {
      return earlier?.nearestOpponentId != null && earlier.tick === point.tick
        ? { ...point, nearestOpponentId: earlier.nearestOpponentId, nearestOpponentDistance: earlier.nearestOpponentDistance }
        : point
    }
    let nearest: Position | undefined
    let best = Number.POSITIVE_INFINITY
    for (const player of players) {
      if (player.team === actor.team) continue
      const distance = Math.hypot(player.x - actor.x, player.y - actor.y)
      if (distance < best) {
        best = distance
        nearest = player
      }
    }
    return nearest ? { ...point, nearestOpponentId: nearest.id, nearestOpponentDistance: Math.round(best * 10) / 10 } : point
  }

  reset() {
    this.ticks = []
    this.positions = []
  }

  exportState(): ProximityState {
    return { ticks: this.ticks.slice(), positions: this.positions.slice() }
  }

  restoreState(state: ProximityState | undefined) {
    this.ticks = state?.ticks.slice() ?? []
    this.positions = state?.positions.slice() ?? []
  }

  private at(tick: number) {
    if (!this.ticks.length) return undefined
    // Binary search for the closest kept tick.
    let low = 0
    let high = this.ticks.length - 1
    while (low < high) {
      const middle = (low + high) >> 1
      if (this.ticks[middle] < tick) low = middle + 1
      else high = middle
    }
    const candidates = [low - 1, low].filter((index) => index >= 0 && index < this.ticks.length)
    const index = candidates.sort((a, b) => Math.abs(this.ticks[a] - tick) - Math.abs(this.ticks[b] - tick))[0]
    return Math.abs(this.ticks[index] - tick) <= maxTickGap ? this.positions[index] : undefined
  }
}
