import type { MatchPlayer, MatchSnapshot, PlayerStats, TeamSide } from "@/types/match"
import { minutesPlayed, hasPlayed } from "@/features/analysis/metrics"
import { playerLabel, rolePt, slotLabel } from "@/features/analysis/roles"

/**
 * Who is playing well or badly, and why. FM's own match rating ranks the players (it is the game's
 * verdict); the reasons are the player's numbers that stand out against what is normal for his position.
 *
 * "Normal" comes from the 9 calibration matches in `samples/` (281 performances of both teams, Nov–Dec
 * 2026): first and third quartile per 90 minutes of players with 45+ minutes, by position group.
 */

export type PositionGroup = "GK" | "CB" | "FB" | "DM" | "CM" | "W" | "AM" | "ST"

export function positionGroup(slot?: string): PositionGroup | undefined {
  const upper = slot?.toUpperCase()
  if (!upper) return undefined
  if (upper === "GK") return "GK"
  if (upper.startsWith("DC")) return "CB"
  if (["DL", "DR", "WBL", "WBR"].includes(upper)) return "FB"
  if (upper.startsWith("DM")) return "DM"
  if (upper.startsWith("MC")) return "CM"
  if (["ML", "MR", "AML", "AMR"].includes(upper)) return "W"
  if (upper.startsWith("AMC")) return "AM"
  if (upper.startsWith("ST")) return "ST"
  return undefined
}

type Quartiles = [p25: number, p75: number]
type GroupNorms = Record<
  | "xg" | "xa" | "keyPasses" | "progressivePasses" | "dribbles" | "possessionLost" | "possessionWon"
  | "tacklesWon" | "interceptions" | "pressesWon" | "aerialsWon" | "headersLost" | "crosses" | "shots" | "passAcc",
  Quartiles
> & { rating: number }

/** Per 90 minutes (passAcc: share of passes completed). */
export const positionNorms: Record<PositionGroup, GroupNorms> = {
  GK: { rating: 6.59, xg: [0, 0], xa: [0, 0], keyPasses: [0, 0], progressivePasses: [0, 0.95], dribbles: [0, 0], possessionLost: [0, 11.9], possessionWon: [4.86, 7.79], tacklesWon: [0, 0], interceptions: [0, 0.23], pressesWon: [0, 0], aerialsWon: [0, 0], headersLost: [0, 0], crosses: [0, 0], shots: [0, 0], passAcc: [0.568, 1] },
  FB: { rating: 6.71, xg: [0, 0.03], xa: [0, 0.13], keyPasses: [0, 1.67], progressivePasses: [3.79, 10], dribbles: [0, 2.87], possessionLost: [7.58, 13.26], possessionWon: [4.74, 10], tacklesWon: [0, 1.89], interceptions: [1.89, 5.11], pressesWon: [0.95, 2.05], aerialsWon: [0, 1.27], headersLost: [0, 1.2], crosses: [1.02, 5.74], shots: [0, 1.02], passAcc: [0.821, 0.896] },
  CB: { rating: 6.66, xg: [0, 0], xa: [0, 0], keyPasses: [0, 0], progressivePasses: [1.86, 4.46], dribbles: [0, 0], possessionLost: [2.84, 6.63], possessionWon: [3.79, 10.53], tacklesWon: [0, 0], interceptions: [0.95, 3.83], pressesWon: [0, 0.95], aerialsWon: [0.96, 3.72], headersLost: [0, 1.05], crosses: [0, 0], shots: [0, 0], passAcc: [0.894, 0.951] },
  DM: { rating: 6.62, xg: [0, 0.02], xa: [0, 0.04], keyPasses: [0, 0.94], progressivePasses: [0.95, 4.03], dribbles: [0, 0.74], possessionLost: [3.75, 5.68], possessionWon: [4.34, 8.44], tacklesWon: [0, 0.95], interceptions: [1.49, 3.83], pressesWon: [0, 1.89], aerialsWon: [0, 1.03], headersLost: [0, 2.17], crosses: [0, 0], shots: [0, 0.94], passAcc: [0.838, 0.927] },
  CM: { rating: 6.87, xg: [0.14, 0.38], xa: [0, 0.11], keyPasses: [0, 1.41], progressivePasses: [4.69, 7.03], dribbles: [0, 1.34], possessionLost: [6.28, 11.37], possessionWon: [1.91, 8.53], tacklesWon: [0, 0.96], interceptions: [0, 2.84], pressesWon: [0, 2.81], aerialsWon: [0, 0.96], headersLost: [0, 1.62], crosses: [0, 1.89], shots: [1.41, 3.24], passAcc: [0.85, 0.905] },
  W: { rating: 6.67, xg: [0, 0.24], xa: [0, 0.35], keyPasses: [0, 2.73], progressivePasses: [2.66, 5.1], dribbles: [2.12, 4.71], possessionLost: [8.25, 14.77], possessionWon: [3.44, 5.85], tacklesWon: [0, 1.4], interceptions: [0.98, 2.72], pressesWon: [0, 1.97], aerialsWon: [0, 0.94], headersLost: [0, 1.76], crosses: [2.26, 6.7], shots: [0.23, 2.62], passAcc: [0.779, 0.903] },
  AM: { rating: 6.59, xg: [0, 0.51], xa: [0, 0.24], keyPasses: [0, 2.98], progressivePasses: [1.62, 3.83], dribbles: [0, 1.74], possessionLost: [4.68, 10.79], possessionWon: [1.87, 7.92], tacklesWon: [0, 0.37], interceptions: [1.44, 3.86], pressesWon: [0, 1.66], aerialsWon: [0, 1.02], headersLost: [0.94, 3.41], crosses: [0, 2.97], shots: [0, 3.41], passAcc: [0.719, 0.875] },
  ST: { rating: 6.39, xg: [0, 0.52], xa: [0, 0.1], keyPasses: [0, 1.22], progressivePasses: [0, 2.14], dribbles: [0, 1.6], possessionLost: [4.34, 6.5], possessionWon: [1.39, 3.93], tacklesWon: [0, 0], interceptions: [0, 1.72], pressesWon: [0, 1.47], aerialsWon: [0, 3.02], headersLost: [1.02, 5.74], crosses: [0, 1.48], shots: [0, 2.85], passAcc: [0.786, 0.889] },
}

const groupNames: Record<PositionGroup, string> = {
  GK: "guarda-redes",
  CB: "central",
  FB: "lateral",
  DM: "médio defensivo",
  CM: "médio centro",
  W: "ala/extremo",
  AM: "médio ofensivo",
  ST: "avançado",
}

export type ImpactReason = { tone: "good" | "bad"; text: string; weight: number }

export type PlayerImpact = {
  id: number
  name: string
  team: TeamSide
  slot?: string
  slotLabel: string
  role?: string
  group?: PositionGroup
  minutes: number
  isOnPitch: boolean
  rating?: number
  /** Median FM rating of the position in the calibration matches. */
  normalRating?: number
  reasons: ImpactReason[]
  /** One sentence on what the player meant for the team (shares of the team's totals). */
  impact?: string
}

/** Below this the per-90 comparisons are too noisy; only absolute facts (goals, cards…) are used. */
const minMinutesForRates = 20

const n = (value: number | undefined) => value ?? 0
const fmt = (value: number, digits = 2) => value.toFixed(digits).replace(".", ",")
const pctText = (value: number) => `${Math.round(value * 100)}%`

function saves(stats: PlayerStats) {
  return n(stats.savesHeld) + n(stats.savesParried) + n(stats.savesTipped)
}

/** Goals the other team scored while the player was on the pitch. */
function goalsConceded(match: MatchSnapshot, player: MatchPlayer) {
  const from = player.isStarter ? 0 : (player.status?.subbedOnMinute ?? Number.POSITIVE_INFINITY)
  const to = player.status?.subbedOffMinute ?? Number.POSITIVE_INFINITY
  return match.events.filter(
    (event) => event.type === "goal" && event.team !== player.team && event.minute >= from && event.minute <= to
  ).length
}

export function playerImpact(match: MatchSnapshot, player: MatchPlayer, teammates: MatchPlayer[]): PlayerImpact {
  const slot = player.inPossession?.position ?? player.position
  const group = positionGroup(slot)
  const norms = group ? positionNorms[group] : undefined
  const minutes = minutesPlayed(player, match.clock.minute)
  const stats = player.stats
  const reasons: ImpactReason[] = []
  const good = (text: string, weight: number) => reasons.push({ tone: "good", text, weight })
  const bad = (text: string, weight: number) => reasons.push({ tone: "bad", text, weight })
  const rated = minutes >= minMinutesForRates && norms != null
  const per90 = (value: number) => (value * 90) / Math.max(1, minutes)
  const normalFor = (key: keyof GroupNorms, side: 0 | 1) =>
    norms ? `${fmt((norms[key] as Quartiles)[side], 1)} por 90' é ${side === 1 ? "muito" : "pouco"} para um ${groupNames[group!]}` : ""
  /** Above the position's third quartile with at least `min` actions. */
  const high = (key: keyof GroupNorms, value: number, min: number) =>
    rated && value >= min && per90(value) > (norms![key] as Quartiles)[1]
  const above = (key: keyof GroupNorms, value: number) =>
    per90(value) / Math.max(0.5, (norms![key] as Quartiles)[1])

  // Goals and assists are facts, whatever the minutes.
  if (stats.goals > 0) good(stats.goals === 1 ? "Marcou um golo." : `Marcou ${stats.goals} golos.`, 10 * stats.goals)
  if (stats.assists > 0) good(`${stats.assists === 1 ? "Uma assistência" : `${stats.assists} assistências`}.`, 8 * stats.assists)
  if (n(stats.ownGoals) > 0) bad("Marcou na própria baliza.", 10)
  if (n(stats.redCards) > 0) bad("Foi expulso.", 12)

  const xg = n(stats.xg)
  const shots = n(stats.shots)
  if (high("xg", xg, 0.25) && xg >= 0.25) {
    good(`${fmt(xg)} xG em ${shots} remate(s): chega a boas zonas de finalização.`, above("xg", xg) * 2)
  }
  const xa = n(stats.xa)
  if (high("xa", xa, 0.15)) good(`Criou ${fmt(xa)} xG para os colegas (${n(stats.keyPasses)} passe(s) para remate).`, above("xa", xa) * 2)
  else if (high("keyPasses", n(stats.keyPasses), 2)) good(`${n(stats.keyPasses)} passes para remate.`, above("keyPasses", n(stats.keyPasses)))
  if (high("progressivePasses", n(stats.progressivePasses), 4))
    good(`${n(stats.progressivePasses)} passes progressivos: leva a bola para a frente.`, above("progressivePasses", n(stats.progressivePasses)))
  if (high("dribbles", n(stats.dribbles), 3)) good(`${n(stats.dribbles)} dribles bem-sucedidos.`, above("dribbles", n(stats.dribbles)))
  if (high("possessionWon", n(stats.possessionWon), 5)) good(`Recuperou ${n(stats.possessionWon)} bolas.`, above("possessionWon", n(stats.possessionWon)))
  if (high("interceptions", n(stats.interceptions), 3)) good(`${n(stats.interceptions)} interceções.`, above("interceptions", n(stats.interceptions)))
  if (high("tacklesWon", n(stats.tacklesWon), 3)) good(`${n(stats.tacklesWon)} desarmes ganhos.`, above("tacklesWon", n(stats.tacklesWon)))
  if (high("pressesWon", n(stats.pressesWon), 3)) good(`Ganhou ${n(stats.pressesWon)} de ${n(stats.pressesAttempted)} pressões.`, above("pressesWon", n(stats.pressesWon)))
  if (high("aerialsWon", n(stats.aerialsWon), 3)) good(`Ganhou ${n(stats.aerialsWon)} duelos aéreos.`, above("aerialsWon", n(stats.aerialsWon)))
  if (group === "GK" && saves(stats) >= 2) good(`${saves(stats)} defesas.`, saves(stats))

  const passes = n(stats.passes)
  const accuracy = passes > 0 ? n(stats.passesCompleted) / passes : 0
  if (rated && passes >= 20 && accuracy >= norms!.passAcc[1]) good(`${pctText(accuracy)} de passes certos em ${passes}.`, 0.8)

  // Problems.
  const lost = n(stats.possessionLost)
  if (high("possessionLost", lost, 6)) bad(`Perdeu ${lost} bolas (${normalFor("possessionLost", 1)}).`, above("possessionLost", lost) * 1.5)
  if (rated && passes >= 15 && accuracy < norms!.passAcc[0])
    bad(`Só ${pctText(accuracy)} de passes certos (${n(stats.passesCompleted)}/${passes}); o normal para a posição é acima de ${pctText(norms!.passAcc[0])}.`, 1.5)
  if (high("headersLost", n(stats.headersLost), 3)) bad(`Perdeu ${n(stats.headersLost)} duelos aéreos.`, above("headersLost", n(stats.headersLost)))
  const crosses = n(stats.crosses)
  if (crosses >= 4 && n(stats.crossesCompleted) === 0) bad(`${crosses} cruzamentos, nenhum certo.`, 1 + crosses / 4)
  if (shots >= 3 && xg / shots < 0.06) bad(`${shots} remates que valem só ${fmt(xg)} xG: remata de zonas pouco perigosas.`, 1.2)
  if (n(stats.offsides) >= 3) bad(`${n(stats.offsides)} foras de jogo.`, 1)
  if (n(stats.fouls) >= 3) bad(`${n(stats.fouls)} faltas cometidas.`, 0.8)
  if (n(stats.yellowCards) > 0 || match.events.some((event) => event.type === "yellow_card" && event.playerId === player.id)) {
    if (n(stats.redCards) === 0 && player.isOnPitch) bad("Amarelado: risco de expulsão.", 0.9)
  }
  const attacking = group === "W" || group === "AM" || group === "ST"
  if (attacking && minutes >= 30 && shots === 0 && n(stats.keyPasses) === 0 && stats.goals === 0 && stats.assists === 0) {
    bad(`Sem remates nem passes para remate em ${minutes} minutos.`, 1.6)
  }
  if (group === "GK") {
    const conceded = goalsConceded(match, player)
    if (conceded > 0 && saves(stats) === 0) bad(`Sofreu ${conceded} golo(s) sem fazer defesas.`, 1)
  }
  const condition = stats.overallPhysicalCondition
  if (player.isOnPitch && condition != null && condition > 0 && condition < 65) bad(`Condição física em ${Math.round(condition)}%.`, 1)

  reasons.sort((a, b) => b.weight - a.weight)
  return {
    id: player.id,
    name: playerLabel(player),
    team: player.team,
    slot,
    slotLabel: slotLabel(slot),
    role: player.inPossession?.role ? rolePt(player.inPossession.role) : undefined,
    group,
    minutes,
    isOnPitch: player.isOnPitch,
    rating: player.rating,
    normalRating: norms?.rating,
    reasons,
    impact: impactSentence(player, teammates),
  }
}

/** Shares of the team's totals: only the ones that make the player stand out (a quarter of the danger, a fifth of the regains…). */
function impactSentence(player: MatchPlayer, teammates: MatchPlayer[]) {
  const total = (pick: (stats: PlayerStats) => number) => teammates.reduce((sum, mate) => sum + pick(mate.stats), 0)
  const parts: string[] = []
  const danger = (stats: PlayerStats) => n(stats.xg) + n(stats.xa)
  const teamDanger = total(danger)
  const own = danger(player.stats)
  if (teamDanger >= 0.3 && own / teamDanger >= 0.25) parts.push(`${pctText(own / teamDanger)} do perigo criado pela equipa (xG + xG assistido)`)
  const teamWon = total((stats) => n(stats.possessionWon))
  const won = n(player.stats.possessionWon)
  if (teamWon >= 15 && won / teamWon >= 0.15) parts.push(`${pctText(won / teamWon)} das bolas recuperadas`)
  const teamProgressive = total((stats) => n(stats.progressivePasses))
  const progressive = n(player.stats.progressivePasses)
  if (teamProgressive >= 15 && progressive / teamProgressive >= 0.2) parts.push(`${pctText(progressive / teamProgressive)} dos passes progressivos`)
  const teamLost = total((stats) => n(stats.possessionLost))
  const lost = n(player.stats.possessionLost)
  if (teamLost >= 20 && lost / teamLost >= 0.18) parts.push(`${pctText(lost / teamLost)} das perdas de bola`)
  if (!parts.length) return undefined
  return `Responsável por ${joinPt(parts)}.`
}

export function joinPt(parts: string[]) {
  if (parts.length <= 1) return parts.join("")
  return `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}`
}

export type TeamPerformance = {
  side: TeamSide
  /** Every player who has played, best rating first. */
  players: PlayerImpact[]
  best: PlayerImpact[]
  worst: PlayerImpact[]
}

/** Players with fewer minutes have ratings that barely moved from the starting value. */
const minMinutesForRanking = 15

export function teamPerformance(match: MatchSnapshot, side: TeamSide, count = 3): TeamPerformance {
  const squad = match.players.filter((player) => player.team === side)
  const players = squad
    .filter(hasPlayed)
    .map((player) => playerImpact(match, player, squad))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
  const ranked = players.filter((player) => player.rating != null && player.minutes >= minMinutesForRanking)
  const best = ranked.slice(0, count)
  const worst = ranked
    .filter((player) => !best.includes(player))
    .slice(-count)
    .reverse()
  return { side, players, best, worst }
}
