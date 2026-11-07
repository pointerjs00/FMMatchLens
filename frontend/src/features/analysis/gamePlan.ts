import type { MatchPlayer, MatchSnapshot } from "@/types/match"
import { isAvailableSubstitute, opposite } from "@/features/analysis/metrics"
import { attribute, basePosition, playerLabel, roleFit, slotLabel } from "@/features/analysis/roles"
import { condition, dec, instructionSetting, type MatchAnalysis } from "@/features/analysis/engine"
import {
  mentalityLabels,
  playerInstructionLabels,
  type TacticProfile,
} from "@/features/analysis/tacticProfile"
import type { OpponentReport } from "@/features/analysis/opponent"
import type { TeamPerformance } from "@/features/analysis/playerImpact"

/**
 * "What do I change to turn this around?" — shown whenever the managed team is losing.
 *
 * It reads the whole match so far: whether the result reflects the play (xG), what blocks the attack,
 * what the opponent gives away (opponent.ts), who is under-performing and who on the bench fits the
 * same role. Every step quotes the numbers behind it.
 */

export type PlanStep = {
  id: "reading" | "risk" | "chances" | "opponent" | "players" | "keep"
  title: string
  detail?: string
  evidence: string[]
  actions: string[]
}

export type GamePlan = {
  title: string
  summary: string
  steps: PlanStep[]
}

const mentalityOrder: Array<TacticProfile["mentality"]> = [
  "veryDefensive",
  "defensive",
  "cautious",
  "balanced",
  "positive",
  "attacking",
  "veryAttacking",
]

function raiseMentality(current: TacticProfile["mentality"], levels: number) {
  const index = mentalityOrder.indexOf(current)
  return mentalityOrder[Math.min(mentalityOrder.length - 1, index + levels)]
}

/** Calibration matches: shots per completed pass into the final third, p25 0,067 / median 0,096. */
const lowShotRate = 0.067
const normalShotRate = 0.096

export function comebackPlan(
  match: MatchSnapshot,
  profile: TacticProfile,
  analysis: MatchAnalysis,
  opponent: OpponentReport,
  performance: TeamPerformance
): GamePlan | undefined {
  const { metrics, opponent: theirMetrics, side, goalsFor, goalsAgainst } = analysis
  const deficit = goalsAgainst - goalsFor
  const minute = match.clock.minute
  if (deficit <= 0 || minute < 10 || minute >= 90 + 10) return undefined
  const team = profile.team
  const steps: PlanStep[] = []
  const totalXg = metrics.xg + theirMetrics.xg
  const xgShare = totalXg > 0 ? metrics.xg / totalXg : 0.5
  const deserved = metrics.xg - theirMetrics.xg >= 0.3 && xgShare >= 0.65
  const outplayed = theirMetrics.xg - metrics.xg >= 0.3 && xgShare <= 0.35
  const halfTime = minute >= 44 && minute <= 47

  // ── Reading ─────────────────────────────────────────────────────────────
  const goalsAgainstShots = match.xgShots.filter((shot) => shot.team === opposite(side) && shot.metricId === "goals")
  const scorerName = (id?: number) => {
    const player = match.players.find((candidate) => candidate.id === id)
    return player ? playerLabel(player) : "?"
  }
  const reading: string[] = [`xG ${dec(metrics.xg)} – ${dec(theirMetrics.xg)}`, `Remates ${metrics.shots} – ${theirMetrics.shots}`]
  for (const shot of goalsAgainstShots) reading.push(`Golo sofrido aos ${shot.minute}' (${scorerName(shot.playerId)}): remate de ${dec(shot.xg)} xG`)
  steps.push({
    id: "reading",
    title: deserved ? "A exibição é melhor do que o resultado" : outplayed ? "O adversário merece estar à frente" : "Jogo equilibrado, resultado contra",
    detail: deserved
      ? `Tens ${Math.round(xgShare * 100)}% do xG do jogo. ${goalsAgainstShots.length && goalsAgainstShots.every((shot) => shot.xg < 0.15) ? "O golo sofrido veio de uma ocasião pouco provável. " : ""}Não desmontes o que funciona: o que falta é transformar o domínio em ocasiões claras.`
      : outplayed
        ? "Antes de arriscar mais, corrige o que está a dar ocasiões ao adversário (secção \"O que ajustar\"); atacar com a defesa a falhar costuma dar o segundo golo."
        : "Nenhuma equipa está claramente por cima. É preciso mais risco, mas com um plano.",
    evidence: reading,
    actions: [],
  })

  // ── Risk: mentality by time and deficit ────────────────────────────────
  const current = profile.mentality
  const riskActions: string[] = []
  let riskDetail: string
  if (minute < 60 && deserved) {
    const next = raiseMentality(current, 1)
    riskDetail = "Com o domínio que tens, ainda não é preciso arriscar mais. Subir a mentalidade agora também abre espaço ao adversário."
    riskActions.push(
      next !== current
        ? `Mantém ${mentalityLabels[current]} por agora. Se aos 60–65' continuar igual, sobe para ${mentalityLabels[next]}.`
        : `Já estás em ${mentalityLabels[current]}: o risco máximo está assumido.`
    )
  } else {
    const levels = minute >= 75 && deficit >= 2 ? 2 : 1
    const next = minute >= 80 ? raiseMentality(current, Math.max(levels, 2)) : raiseMentality(current, levels)
    riskDetail =
      minute >= 75
        ? "Reta final: o risco de sofrer outro golo pesa menos do que a falta de golos."
        : minute >= 60
          ? "A última meia hora é a altura de assumir mais risco."
          : "O jogo não está a correr a teu favor: um nível a mais de risco dá mais gente na área."
    riskActions.push(
      next !== current
        ? `Mentalidade: ${mentalityLabels[current]} → ${mentalityLabels[next]}.`
        : `Já estás em ${mentalityLabels[current]}: o risco máximo está assumido.`
    )
    if (minute >= 70 && team.shotsFromDistance === "less") riskActions.push(`Mudar ${instructionSetting("shotsFromDistance", "balanced")}.`)
    if (minute >= 80 && team.timeWasting !== "lessOften") riskActions.push(`Mudar ${instructionSetting("timeWasting", "lessOften")}.`)
  }
  steps.push({ id: "risk", title: "Risco e mentalidade", detail: riskDetail, evidence: [`Minuto ${minute}, a perder por ${deficit}`], actions: riskActions })

  // ── Chances: what blocks the attack ────────────────────────────────────
  const chanceEvidence: string[] = []
  const chanceActions: string[] = []
  const finalThird = metrics.finalThirdPassesCompleted
  const shotRate = finalThird > 0 ? metrics.shots / finalThird : undefined
  if (shotRate != null && finalThird >= 30 && shotRate < lowShotRate) {
    chanceEvidence.push(
      `${finalThird} passes certos para o último terço e só ${metrics.shots} remates (${dec(shotRate * 10, 1)} por cada 10 passes; normal ${dec(normalShotRate * 10, 1)})`
    )
    if (team.patience === "workIntoBox")
      chanceActions.push(`A equipa procura o passe perfeito e não remata: ${instructionSetting("patience", "balanced")}.`)
    const shooters = analysis.players
      .filter((player) => player.isOnPitch && player.instructions.includes("shootLess"))
      .map((report) => match.players.find((player) => player.id === report.id))
      .filter((player): player is MatchPlayer => player != null)
      .filter((player) => (attribute(player, "Long Shots") ?? 0) >= 14 || (attribute(player, "Finishing") ?? 0) >= 14)
    for (const player of shooters)
      chanceActions.push(
        `Tirar "${playerInstructionLabels.shootLess}" a ${playerLabel(player)} (Finalização ${attribute(player, "Finishing")}, Remates de longe ${attribute(player, "Long Shots")}).`
      )
  }
  if (metrics.crossesAttempted >= 8 && metrics.crossesCompleted / metrics.crossesAttempted < 0.1) {
    chanceEvidence.push(`${metrics.crossesCompleted} de ${metrics.crossesAttempted} cruzamentos certos (normal ~14%)`)
    const crossers = match.players
      .filter((player) => player.team === side && player.isOnPitch && (player.stats.crosses ?? 0) >= 3)
      .sort((x, y) => (y.stats.crosses ?? 0) - (x.stats.crosses ?? 0))
    if (crossers.length)
      chanceEvidence.push(`Quem mais cruza: ${crossers.map((player) => `${playerLabel(player)} ${player.stats.crossesCompleted ?? 0}/${player.stats.crosses}`).join(", ")}`)
    if (!opponent.exploits.some((exploit) => exploit.id.startsWith("aerial-against")) && team.crossingStyle !== "low")
      chanceActions.push(`Mudar ${instructionSetting("crossingStyle", "low")}.`)
  }
  if (metrics.shots >= 6 && metrics.xgPerShot < 0.08) {
    chanceEvidence.push(`${dec(metrics.xgPerShot)} xG por remate (normal 0,10); ${metrics.boxShots} de ${metrics.shots} dentro da área`)
  }
  // Engine rules about the attack already carry precise actions; reuse them.
  for (const insight of analysis.insights) {
    if (insight.area !== "attack" || (insight.tone !== "problem" && insight.tone !== "warning")) continue
    chanceActions.push(...insight.actions)
  }
  if (chanceEvidence.length || chanceActions.length) {
    steps.push({
      id: "chances",
      title: "Criar ocasiões melhores",
      detail: chanceEvidence.length ? "Onde o ataque está a encravar:" : undefined,
      evidence: chanceEvidence,
      actions: unique(chanceActions),
    })
  }

  // ── Opponent: what it gives away ───────────────────────────────────────
  // The strongest player match-ups plus the main team habit that asks for a change.
  const tendency = opponent.tendencies.find((item) => item.actions.some((action) => !action.endsWith("mantém.")))
  const exploits = [...opponent.exploits.slice(0, 3), ...(tendency ? [tendency] : [])]
  if (exploits.length) {
    steps.push({
      id: "opponent",
      title: "Explorar o adversário",
      detail: "Os pontos fracos mais claros (ver o separador \"Adversário\" para todos):",
      evidence: exploits.map((exploit) => `${exploit.title}. ${exploit.evidence.join("; ")}`),
      actions: oneValuePerInstruction(exploits.flatMap((exploit) => exploit.actions).filter((action) => !action.endsWith("mantém."))),
    })
  }

  // ── Players: substitutions and instructions ────────────────────────────
  const playerActions = substitutionActions(match, side, performance, minute, halfTime)
  for (const report of analysis.players) {
    if (!report.isOnPitch || !report.instructions.includes("lessRisk")) continue
    const player = match.players.find((candidate) => candidate.id === report.id)
    if (!player) continue
    const vision = attribute(player, "Vision")
    const passing = attribute(player, "Passing")
    if ((vision ?? 0) >= 15 && (passing ?? 0) >= 14)
      playerActions.push(`Tirar "${playerInstructionLabels.lessRisk}" a ${report.name} (Visão ${vision}, Passe ${passing}): a perder, a criatividade dele faz falta.`)
  }
  const used = match.players.filter((player) => player.team === side && player.status?.subbedOnMinute != null).length
  if (playerActions.length) {
    steps.push({
      id: "players",
      title: "Jogadores",
      detail: used ? `Já fizeste ${used} substituição(ões).` : undefined,
      evidence: [],
      actions: playerActions,
    })
  }

  // ── Keep: what is working ──────────────────────────────────────────────
  const working = analysis.insights.filter((insight) => insight.tone === "good" && insight.area !== "gameState")
  if (working.length && !outplayed) {
    steps.push({
      id: "keep",
      title: "Não mexer",
      detail: "Isto está a funcionar; as mudanças acima não devem estragá-lo:",
      evidence: working.map((insight) => insight.title),
      actions: [],
    })
  }

  const when = halfTime ? "ao intervalo" : `ao minuto ${minute}`
  return {
    title: `A perder ${goalsFor}-${goalsAgainst} ${when}: plano para dar a volta`,
    summary: minute >= 75
      ? "Reta final: é altura de arriscar."
      : deserved
      ? "Estás a jogar melhor; muda pouco e com precisão."
      : outplayed
        ? "Primeiro estancar, depois arriscar."
        : "Mais risco, com um plano.",
    steps,
  }
}

/**
 * Substitutions: players on the pitch who are below the usual rating for their position, tired or
 * booked, with a bench player who fits the same role at least as well (role key attributes) and is
 * familiar with the position (13+ of 20).
 */
function substitutionActions(
  match: MatchSnapshot,
  side: MatchAnalysis["side"],
  performance: TeamPerformance,
  minute: number,
  halfTime: boolean
) {
  const squad = match.players.filter((player) => player.team === side)
  const bench = squad.filter(isAvailableSubstitute)
  const taken = new Set<number>()
  const actions: string[] = []
  const candidates = performance.players
    .filter((report) => report.isOnPitch && report.group !== "GK" && report.minutes >= 25)
    .map((report) => {
      const player = squad.find((candidate) => candidate.id === report.id)!
      const cond = condition(player)
      const below = report.rating != null && report.normalRating != null ? report.normalRating - report.rating : 0
      const tired = cond != null && cond < 70 ? (70 - cond) / 10 : 0
      return { report, player, cond, need: below * 4 + tired }
    })
    .filter((item) => item.need >= 0.6)
    .sort((x, y) => y.need - x.need)

  for (const { report, player, cond } of candidates) {
    if (actions.length >= 2) break
    const base = basePosition(player.inPossession?.position ?? player.position)
    if (!base) continue
    const role = player.inPossession?.role
    const current = roleFit(player, role)?.score
    const option = bench
      .filter((candidate) => !taken.has(candidate.id) && (candidate.positionFamiliarities?.[base] ?? 0) >= 13)
      .map((candidate) => ({ candidate, fit: roleFit(candidate, role) }))
      .filter((item) => item.fit != null && (current == null || item.fit.score >= current - 0.5))
      .sort((x, y) => y.fit!.score - x.fit!.score)[0]
    if (!option) continue
    taken.add(option.candidate.id)
    const why = [
      report.rating != null ? `nota ${dec(report.rating, 1)} (normal ${dec(report.normalRating ?? 0, 1)})` : "",
      cond != null && cond < 70 ? `${cond}% de condição` : "",
      report.reasons.find((reason) => reason.tone === "bad")?.text.replace(/\.$/, "").toLowerCase() ?? "",
    ].filter(Boolean)
    const fitText = option.fit ? `${dec(option.fit.score, 1)} como ${option.fit.rolePt}${current != null ? ` (${report.name}: ${dec(current, 1)})` : ""}` : ""
    const timing = halfTime ? "Ao intervalo" : minute < 55 ? "Se não melhorar até aos 60'" : "Agora"
    actions.push(
      `${timing}: ${report.name} (${slotLabel(report.slot)}) → ${playerLabel(option.candidate)}. ${capitalise(why.join(", "))}. ${playerLabel(option.candidate)}: ${fitText}, condição ${condition(option.candidate) ?? "?"}%.`
    )
  }
  return actions
}

function capitalise(text: string) {
  return text ? text[0].toUpperCase() + text.slice(1) : text
}

/**
 * Two match-ups can ask for different values of the same team instruction ("Progredir por: Esquerda" and
 * "…: Direita"); the first one (the stronger exploit) wins.
 */
function oneValuePerInstruction(actions: string[]) {
  const seen = new Set<string>()
  return unique(actions).filter((action) => {
    const match = /^Mudar ([^:]+):/.exec(action)
    if (!match) return true
    if (seen.has(match[1])) return false
    seen.add(match[1])
    return true
  })
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}
