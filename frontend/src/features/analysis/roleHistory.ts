import type { RealtimeFrame, RealtimeMatchMetadata } from "@/api/realtimeMatch"
import type { FormationSnapshot, MatchPlayer, MatchSnapshot } from "@/types/match"

/**
 * Fork: positions and roles of every player over the match, for replays of archives.
 *
 * Live matches get this from the plugin's formation history (`snapshot.formationSnapshots`). Archives keep
 * the same information in `metadataTimeline`: one metadata entry each time the game changed a player's
 * position or role, or a substitute came on (checked on the 9 calibration matches: role changes, wingers
 * swapping sides, substitutions). The metadata does not say who is on the pitch, so that comes from the
 * frame's substitution minutes. `formationSnapshots` itself is left alone in replays because the upstream
 * formation board reads it.
 */

type FramePlayer = RealtimeFrame["players"][number]

function onPitchAt(player: FramePlayer | undefined, minute: number) {
  if (!player) return false
  const on = !player.isSubstitute ? 0 : player.subbedOnMinute > 0 ? player.subbedOnMinute : Number.POSITIVE_INFINITY
  const off = player.subbedOffMinute > 0 ? player.subbedOffMinute : Number.POSITIVE_INFINITY
  return on <= minute && minute < off
}

/**
 * The metadata keeps the game tick of each entry; the clock shown is the frame's display tick, which runs a
 * little differently (stoppages). `displayTickAt` maps one to the other through the archive's frames.
 */
export function roleHistoryAt(
  timeline: readonly RealtimeMatchMetadata[],
  frame: RealtimeFrame,
  snapshot: MatchSnapshot,
  displayTickAt: (tick: number) => number = (tick) => tick
): FormationSnapshot[] {
  const byId = new Map(frame.players.map((player) => [player.playerId, player]))
  const names = new Map(snapshot.players.map((player) => [player.id, player.name]))
  const out: FormationSnapshot[] = []
  for (const entry of timeline) {
    if (entry.capturedTick < 0 || entry.capturedTick > frame.tick || entry.players.length === 0) continue
    const minute = Math.floor(Math.max(0, displayTickAt(entry.capturedTick)) / 240)
    out.push({
      tick: entry.capturedTick,
      minute,
      players: entry.players.map((player) => {
        const id = player.uid ?? player.playerId
        return {
          id,
          name: names.get(id) ?? player.displayName,
          team: player.team,
          isOnPitch: onPitchAt(byId.get(player.playerId), minute),
          inPossession: player.inPossession,
          outOfPossession: player.outOfPossession,
          stats: { goals: 0, assists: 0 },
        } as unknown as MatchPlayer
      }),
    })
  }
  return out
}
