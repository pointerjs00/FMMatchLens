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
  kind: "formation" | "role" | "swap" | "sub" | "block"
  title: string
  detail: string
  /** Internal: groups repeated back-and-forth changes (same player and roles, same pair swapping). */
  key?: string
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
  // Live: the plugin's formation history; replays of archives: the metadata timeline (roleHistory.ts).
  const history = historyOf(match)
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
      if (!formationChanged) out.push(...playerMoves(previous, current, entry.minute))
    }
    previous = current
  }
  return collapseRepeats(out)
}

/** Two players who exchanged positions (wingers switching sides) and role changes, one item per player. */
function playerMoves(previous: MatchPlayer[], current: MatchPlayer[], minute: number): OpponentChange[] {
  const out: OpponentChange[] = []
  const handled = new Set<number>()
  const was = (player: MatchPlayer) => previous.find((candidate) => candidate.id === player.id)
  // The game sometimes records the swap one phase at a time: check both.
  const swapped = (a: MatchPlayer, oldA: MatchPlayer, b: MatchPlayer, oldB: MatchPlayer) =>
    (["inPossession", "outOfPossession"] as const).some(
      (phase) =>
        oldA[phase]?.position != null &&
        oldA[phase]?.position !== a[phase]?.position &&
        b[phase]?.position === oldA[phase]?.position &&
        a[phase]?.position === oldB[phase]?.position
    )
  for (const a of current) {
    const oldA = was(a)
    if (!oldA || handled.has(a.id)) continue
    const b = current.find((other) => {
      const oldB = other.id !== a.id ? was(other) : undefined
      return oldB != null && !handled.has(other.id) && swapped(a, oldA, other, oldB)
    })
    if (!b) continue
    handled.add(a.id)
    handled.add(b.id)
    const [first, second] = [a, b].sort((x, y) => x.id - y.id)
    out.push({
      minute,
      kind: "swap",
      title: `${playerLabel(first)} e ${playerLabel(second)} trocaram de posição`,
      detail: `${playerLabel(first)} passou para ${slotLabel(first.inPossession?.position)} e ${playerLabel(second)} para ${slotLabel(second.inPossession?.position)}.`,
      key: `swap:${first.id}:${second.id}`,
    })
  }
  for (const player of current) {
    const old = was(player)
    if (!old || handled.has(player.id)) continue
    const parts: string[] = []
    const roles: string[] = []
    for (const phase of ["inPossession", "outOfPossession"] as const) {
      const before = old[phase]
      const after = player[phase]
      if (!before?.role || !after?.role || before.role === after.role) continue
      parts.push(`${phaseText[phase]}: ${rolePt(before.role)} → ${rolePt(after.role)}`)
      roles.push(`${phase}:${[before.role, after.role].sort().join("|")}`)
    }
    if (!parts.length) continue
    out.push({
      minute,
      kind: "role",
      title: `${playerLabel(player)} mudou de papel`,
      detail: `${parts.join("; ")} (${slotLabel(player.inPossession?.position)}).`,
      key: `role:${player.id}:${roles.join(",")}`,
    })
  }
  return out
}

/** The AI often goes back and forth (a full-back switching between two roles, wingers swapping sides). */
function collapseRepeats(changes: OpponentChange[]): OpponentChange[] {
  const groups = new Map<string, OpponentChange[]>()
  for (const change of changes) if (change.key) groups.set(change.key, [...(groups.get(change.key) ?? []), change])
  const out: OpponentChange[] = []
  for (const change of changes) {
    const group = change.key ? groups.get(change.key)! : undefined
    if (!group || group.length < 3) {
      out.push(change)
      continue
    }
    if (group[0] !== change) continue
    const minutes = group.map((item) => item.minute)
    out.push({
      minute: minutes[0],
      kind: change.kind,
      title:
        change.kind === "swap"
          ? `${change.title.replace(" trocaram de posição", "")} trocaram de lado ${group.length} vezes`
          : `${change.title.replace(" mudou de papel", "")} alternou de papel ${group.length} vezes`,
      detail: `Entre os ${minutes[0]}' e os ${minutes.at(-1)}'. Última: ${group.at(-1)!.detail}`,
      key: change.key,
    })
  }
  return out
}

/** Positions/roles history: the plugin's (live) or the archive's (replays). */
function historyOf(match: MatchSnapshot) {
  const source = match.formationSnapshots?.length ? match.formationSnapshots : (match.roleHistory ?? [])
  return [...source].sort((a, b) => a.tick - b.tick)
}

/** A player's position around a minute: the first entry from then on (coming on) or the last one before (going off). */
function slotAt(match: MatchSnapshot, playerId: number, minute: number, when: "from" | "before") {
  const history = historyOf(match)
  const entries = when === "from" ? history.filter((entry) => entry.minute >= minute) : history.filter((entry) => entry.minute < minute).reverse()
  for (const entry of entries) {
    const slot = entry.players.find((player) => player.id === playerId)?.inPossession?.position
    if (slot) return slot
  }
  return undefined
}

function substitutions(match: MatchSnapshot, theirSide: TeamSide): OpponentChange[] {
  const squad = match.players.filter((player) => player.team === theirSide)
  const out: OpponentChange[] = []
  const side = (slot?: string) => (slot && /L$/.test(slot) ? "L" : slot && /R$/.test(slot) ? "R" : "C")
  const minutes = [...new Set(squad.map((player) => player.status?.subbedOnMinute).filter((value): value is number => value != null))]
  for (const minute of minutes.sort((a, b) => a - b)) {
    const incoming = squad
      .filter((player) => player.status?.subbedOnMinute === minute)
      .map((player) => ({ player, slot: slotAt(match, player.id, minute, "from") ?? player.inPossession?.position ?? player.position }))
    const outgoing = squad
      .filter((player) => player.status?.subbedOffMinute === minute)
      .map((player) => ({ player, slot: slotAt(match, player.id, minute, "before") ?? player.inPossession?.position ?? player.position }))
    // Several changes in the same minute: pair the same position first, then the closest one.
    const cost = (a?: string, b?: string) => {
      if (a && a === b) return 0
      const ga = positionGroup(a)
      const gb = positionGroup(b)
      return (ga && gb ? Math.abs(depth[ga] - depth[gb]) : 3) + (side(a) === side(b) ? 0 : 0.5)
    }
    const pairs = incoming
      .flatMap((inItem) => outgoing.map((outItem) => ({ inItem, outItem, cost: cost(inItem.slot, outItem.slot) })))
      .sort((a, b) => a.cost - b.cost)
    const usedIn = new Set<number>()
    const usedOut = new Set<number>()
    const matched: Array<{ inItem: (typeof incoming)[number]; outItem?: (typeof outgoing)[number] }> = []
    for (const pair of pairs) {
      if (usedIn.has(pair.inItem.player.id) || usedOut.has(pair.outItem.player.id)) continue
      usedIn.add(pair.inItem.player.id)
      usedOut.add(pair.outItem.player.id)
      matched.push(pair)
    }
    for (const inItem of incoming) if (!usedIn.has(inItem.player.id)) matched.push({ inItem })
    for (const { inItem, outItem } of matched) {
      const inGroup = positionGroup(inItem.slot)
      const outGroup = positionGroup(outItem?.slot)
      const shift = inGroup && outGroup ? depth[inGroup] - depth[outGroup] : 0
      const nature = shift >= 1 ? "ofensiva" : shift <= -1 ? "defensiva" : "na mesma zona"
      out.push({
        minute,
        kind: "sub",
        title: `Substituição ${nature}`,
        detail: outItem
          ? `Entrou ${playerLabel(inItem.player)} (${slotLabel(inItem.slot)}) para o lugar de ${playerLabel(outItem.player)} (${slotLabel(outItem.slot)}).`
          : `Entrou ${playerLabel(inItem.player)} (${slotLabel(inItem.slot)}).`,
      })
    }
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
