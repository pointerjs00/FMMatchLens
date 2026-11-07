import type { MatchPlayer, MatchSnapshot, TeamSide } from "@/types/match"
import { computeTeamMetrics, opposite } from "@/features/analysis/metrics"
import { playerLabel, rolePt, slotLabel } from "@/features/analysis/roles"
import { positionGroup, type PositionGroup } from "@/features/analysis/playerImpact"

/**
 * What the opponent (the AI) changed during the match:
 * - formation and roles, from the plugin's formation history (live matches: `snapshot.formationSnapshots`,
 *   one entry each time the game changes a player's position or role);
 * - substitutions, and whether they push the team forward or back;
 * - the height of its block in the last 15 minutes against the rest of the match. Between two such windows
 *   it moves 6 points in a typical match (median of the calibration matches) and 14 or more in only one case
 *   out of ten, so only a change of 14+ points is reported.
 */

export type OpponentChange = {
  minute: number
  kind: "formation" | "role" | "sub" | "block"
  title: string
  detail: string
}

const blockShift = 14
/** How far forward a position plays, to tell attacking from defensive substitutions. */
const depth: Record<PositionGroup, number> = { GK: 0, CB: 1, FB: 1.5, DM: 2, CM: 3, W: 4, AM: 4, ST: 5 }

type Phase = "inPossession" | "outOfPossession"

function line(slot: string) {
  const upper = slot.toUpperCase()
  if (upper === "GK") return undefined
  if (upper.startsWith("D") && !upper.startsWith("DM")) return 0
  if (upper.startsWith("WB")) return 0
  if (upper.startsWith("DM")) return 1
  if (upper === "ML" || upper === "MR" || upper.startsWith("MC")) return 2
  if (upper.startsWith("AM")) return 3
  if (upper.startsWith("ST")) return 4
  return undefined
}

/** "4-2-3-1" from the positions of the outfield players on the pitch in one phase. */
export function formationLabel(players: readonly MatchPlayer[], phase: Phase) {
  const counts = [0, 0, 0, 0, 0]
  for (const player of players) {
    const slot = player[phase]?.position
    const index = slot ? line(slot) : undefined
    if (index != null) counts[index] += 1
  }
  const total = counts.reduce((sum, value) => sum + value, 0)
  return total >= 7 ? counts.filter((value) => value > 0).join("-") : undefined
}

/** Outfield players with a known position in both phases. */
function placed(players: readonly MatchPlayer[]) {
  return players.filter((player) => {
    const inSlot = player.inPossession?.position
    const outSlot = player.outOfPossession?.position
    return inSlot != null && outSlot != null && line(inSlot) != null && line(outSlot) != null
  }).length
}

const phaseText: Record<Phase, string> = { inPossession: "com bola", outOfPossession: "sem bola" }

function formationChanges(match: MatchSnapshot, theirSide: TeamSide): OpponentChange[] {
  const history = [...(match.formationSnapshots ?? [])].sort((a, b) => a.tick - b.tick)
  const out: OpponentChange[] = []
  let previous: MatchPlayer[] | undefined
  for (const entry of history) {
    const current = entry.players.filter((player) => player.team === theirSide && player.isOnPitch)
    if (current.length < 7) continue
    // Mid-substitution entries have a player without a position for a moment: compare like with like.
    if (previous && placed(previous) !== placed(current)) {
      if (placed(current) > placed(previous)) previous = current
      continue
    }
    if (previous) {
      const reported = out.length
      for (const phase of ["outOfPossession", "inPossession"] as const) {
        const before = formationLabel(previous, phase)
        const after = formationLabel(current, phase)
        if (before && after && before !== after) {
          out.push({
            minute: entry.minute,
            kind: "formation",
            title: `Passou de ${before} para ${after} ${phaseText[phase]}`,
            detail: `Desde os ${entry.minute}', a formação ${phaseText[phase]} do adversário é ${after}.`,
          })
        }
      }
      // A new formation moves everyone; only report role changes made inside the same formation.
      const formationChanged = out.length > reported
      for (const player of formationChanged ? [] : current) {
        const old = previous.find((candidate) => candidate.id === player.id)
        if (!old) continue
        for (const phase of ["inPossession", "outOfPossession"] as const) {
          const was = old[phase]
          const now = player[phase]
          if (!was?.role || !now?.role || was.role === now.role) continue
          out.push({
            minute: entry.minute,
            kind: "role",
            title: `${playerLabel(player)} mudou de papel ${phaseText[phase]}`,
            detail: `${rolePt(was.role)} (${slotLabel(was.position)}) → ${rolePt(now.role)} (${slotLabel(now.position)}).`,
          })
        }
      }
    }
    previous = current
  }
  return out
}

function substitutions(match: MatchSnapshot, theirSide: TeamSide): OpponentChange[] {
  const squad = match.players.filter((player) => player.team === theirSide)
  const out: OpponentChange[] = []
  for (const incoming of squad.filter((player) => player.status?.subbedOnMinute != null)) {
    const minute = incoming.status!.subbedOnMinute!
    const outgoing = squad.find((player) => player.status?.subbedOffMinute === minute && !out.some((item) => item.detail.includes(playerLabel(player))))
    const inSlot = incoming.inPossession?.position ?? incoming.position
    const inGroup = positionGroup(inSlot)
    const outSlot = outgoing?.inPossession?.position ?? outgoing?.position
    const outGroup = positionGroup(outSlot)
    const shift = inGroup && outGroup ? depth[inGroup] - depth[outGroup] : 0
    const nature = shift >= 1 ? "ofensiva" : shift <= -1 ? "defensiva" : "na mesma zona"
    out.push({
      minute,
      kind: "sub",
      title: `Substituição ${nature}`,
      detail: outgoing
        ? `Entrou ${playerLabel(incoming)} (${slotLabel(inSlot)}) para o lugar de ${playerLabel(outgoing)} (${slotLabel(outSlot)}).`
        : `Entrou ${playerLabel(incoming)} (${slotLabel(inSlot)}).`,
    })
  }
  return out
}

function blockChange(match: MatchSnapshot, theirSide: TeamSide): OpponentChange | undefined {
  const minute = match.clock.minute
  if (minute < 30) return undefined
  const recent = computeTeamMetrics(match, theirSide, { fromMinute: minute - 15, toMinute: minute, label: "" })
  const before = computeTeamMetrics(match, theirSide, { fromMinute: 0, toMinute: minute - 15, label: "" })
  if (recent.defensiveActionHeight == null || before.defensiveActionHeight == null) return undefined
  const diff = recent.defensiveActionHeight - before.defensiveActionHeight
  if (Math.abs(diff) < blockShift) return undefined
  const from = Math.round(before.defensiveActionHeight)
  const to = Math.round(recent.defensiveActionHeight)
  return {
    minute: minute - 15,
    kind: "block",
    title: diff < 0 ? "Baixou o bloco nos últimos 15'" : "Subiu o bloco nos últimos 15'",
    detail:
      diff < 0
        ? `A altura média das ações defensivas dele passou de ${from}% para ${to}%: está a defender mais perto da área e há menos espaço nas costas.`
        : `A altura média das ações defensivas dele passou de ${from}% para ${to}%: está a pressionar mais à frente e deixa mais espaço nas costas.`,
  }
}

/** Everything the opponent changed, in order. */
export function opponentChanges(match: MatchSnapshot, side: TeamSide): OpponentChange[] {
  const theirSide = opposite(side)
  const block = blockChange(match, theirSide)
  return [...formationChanges(match, theirSide), ...substitutions(match, theirSide), ...(block ? [block] : [])].sort(
    (a, b) => a.minute - b.minute
  )
}
