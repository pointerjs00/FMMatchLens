import type { MatchPlayer, MatchSnapshot, TeamSide } from "@/types/match"
import {
  computeTeamMetrics,
  hasPlayed,
  isAvailableSubstitute,
  minutesPlayed,
  momentumBalance,
  opposite,
  type AnalysisWindow,
  type Lane,
  type TeamWindowMetrics,
} from "@/features/analysis/metrics"
import {
  attribute,
  attributeLabels,
  basePosition,
  playerLabel,
  roleFit,
  rolePt,
  slotLabel,
  traitLabels,
  traitsOf,
  type RoleFit,
} from "@/features/analysis/roles"
import {
  instructionLabel,
  instructionsForSlot,
  playerInstructionLabels,
  type PlayerInstructionTag,
  type TacticProfile,
  type TeamInstructionId,
} from "@/features/analysis/tacticProfile"

export type InsightTone = "good" | "warning" | "problem" | "info"
export type InsightArea =
  | "attack"
  | "defence"
  | "transition"
  | "pressing"
  | "players"
  | "tactic"
  | "gameState"

export type Insight = {
  id: string
  tone: InsightTone
  area: InsightArea
  title: string
  detail: string
  evidence: string[]
  actions: string[]
  /** Higher is shown first within its tone. */
  priority: number
  playerIds?: number[]
}

export type PlayerNote = { tone: InsightTone; text: string }

export type PlayerReport = {
  id: number
  name: string
  slot?: string
  slotLabel: string
  roleIn?: string
  roleOut?: string
  minutes: number
  isOnPitch: boolean
  rating?: number
  condition?: number
  fitIn?: RoleFit
  fitOut?: RoleFit
  instructions: PlayerInstructionTag[]
  traits: string[]
  notes: PlayerNote[]
}

export type AnalysisScores = {
  attack: number
  defence: number
  pressing: number
  transition: number
}

export type MatchAnalysis = {
  side: TeamSide
  teamName: string
  opponentName: string
  minute: number
  window: AnalysisWindow
  goalsFor: number
  goalsAgainst: number
  metrics: TeamWindowMetrics
  opponent: TeamWindowMetrics
  momentum?: number
  scores: AnalysisScores
  headline: string
  insights: Insight[]
  players: PlayerReport[]
}

const laneNames: Record<Lane, string> = {
  left: "esquerda",
  centre: "centro",
  right: "direita",
}

export function pct(value: number) {
  return `${Math.round(value * 100)}%`
}

export function dec(value: number, digits = 2) {
  return value.toLocaleString("pt-PT", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function lerpScore(value: number, points: Array<[number, number]>) {
  if (value <= points[0][0]) return points[0][1]
  for (let index = 1; index < points.length; index += 1) {
    const [x1, y1] = points[index]
    const [x0, y0] = points[index - 1]
    if (value <= x1) return y0 + ((value - x0) / (x1 - x0)) * (y1 - y0)
  }
  return points.at(-1)![1]
}

const clamp = (value: number) => Math.round(Math.min(99, Math.max(1, value)))

/** The human-managed team, falling back to home. */
export function managedSide(match: MatchSnapshot): TeamSide {
  if (match.away.manager?.isHumanControlled && !match.home.manager?.isHumanControlled) {
    return "away"
  }
  return "home"
}

export function fullMatchWindow(match: MatchSnapshot): AnalysisWindow {
  return { fromMinute: 0, toMinute: Math.max(1, match.clock.minute), label: "Jogo todo" }
}

export function recentWindow(match: MatchSnapshot, minutes = 15): AnalysisWindow {
  const to = Math.max(1, match.clock.minute)
  return {
    fromMinute: Math.max(0, to - minutes),
    toMinute: to,
    label: `Últimos ${minutes}'`,
  }
}

export function analyseMatch(
  match: MatchSnapshot,
  profile: TacticProfile,
  options: { side?: TeamSide; window?: AnalysisWindow } = {}
): MatchAnalysis {
  const side = options.side ?? managedSide(match)
  const window = options.window ?? fullMatchWindow(match)
  const minutes = Math.max(1, window.toMinute - window.fromMinute)
  const per90 = (value: number) => (value * 90) / minutes
  const metrics = computeTeamMetrics(match, side, window)
  const opponent = computeTeamMetrics(match, opposite(side), window)
  const momentum = momentumBalance(match, side, window)
  const team = profile.team
  const ourPlayers = match.players.filter((player) => player.team === side)
  const goalsFor = match.score[side]
  const goalsAgainst = match.score[opposite(side)]
  const insights: Insight[] = []
  const add = (insight: Insight) => insights.push(insight)
  const isFull = window.fromMinute <= 0
  const enoughData = minutes >= 10
  const set = (id: TeamInstructionId, value: string) =>
    `${instructionLabelOf(id)}: ${instructionLabel(id, value)}`

  const xg90 = per90(metrics.xg)
  const oppXg90 = per90(opponent.xg)

  // ── Attack ────────────────────────────────────────────────────────────
  if (enoughData) {
    const wasted = metrics.xg - metrics.goals
    if (metrics.xg >= 1.2 && wasted >= 1) {
      const shooters = ourPlayers
        .filter((player) => (player.stats.xg ?? 0) >= 0.25)
        .sort((a, b) => (b.stats.xg ?? 0) - (a.stats.xg ?? 0))
        .slice(0, 3)
      const weakFinishers = shooters.filter(
        (player) => (attribute(player, "Finishing") ?? 20) <= 11
      )
      const finisherAction = (player: MatchPlayer) => {
        const slotInstructions = instructionsForSlot(profile, player.inPossession?.position)
        const finishing = attribute(player, "Finishing")
        if (slotInstructions.includes("shootLess")) {
          return `${playerLabel(player)} já tem "Rematar menos" e mesmo assim chega a ocasiões claras (${dec(player.stats.xg ?? 0)} xG) com Finalização ${finishing}: o papel leva-o à área. Um papel que fique mais atrás (ex.: Médio de construção) ou "Chegar tarde à área" deixa essas bolas para os avançados.`
        }
        return `${playerLabel(player)} está a ficar com as melhores ocasiões mas tem Finalização ${finishing}: considera "Rematar menos" para ele ou dar o papel de finalizador a outro jogador.`
      }
      add({
        id: "attack.finishing-variance",
        tone: "info",
        area: "attack",
        title: "Crias o suficiente, falta a finalização",
        detail:
          `${dec(metrics.xg)} xG para ${metrics.goals} golo(s). Com este volume de oportunidades os golos tendem a aparecer; ` +
          "não é sinal de que a tática esteja errada, por isso evita mudanças grandes só por causa do resultado.",
        evidence: [
          `xG ${dec(metrics.xg)} em ${metrics.shots} remates (${dec(metrics.xgPerShot)} por remate)`,
          ...shooters.map(
            (player) =>
              `${playerLabel(player)}: ${dec(player.stats.xg ?? 0)} xG, ${player.stats.goals} golo(s), Finalização ${attribute(player, "Finishing") ?? "?"}`
          ),
        ],
        actions: weakFinishers.length
          ? weakFinishers.map(finisherAction)
          : ["Mantém a abordagem; se quiseres mexer, mexe em quem finaliza (substituição) e não na estrutura."],
        priority: 60,
        playerIds: shooters.map((player) => player.id),
      })
    }

    // Calibrated on 9 FM27 matches (18 team performances): median xG/shot is
    // 0.10 and even box-heavy games sit at 0.07–0.09, so a low average alone
    // does not mean "shooting from distance". Require a real share of outside shots.
    const outside = metrics.shots - metrics.boxShots
    if (metrics.shots >= 8 && metrics.xgPerShot < 0.08 && outside / metrics.shots >= 0.35) {
      const actions: string[] = []
      if (team.shotsFromDistance !== "less") actions.push(`Mudar ${set("shotsFromDistance", "less")}.`)
      if (team.patience !== "workIntoBox") actions.push(`Mudar ${set("patience", "workIntoBox")}.`)
      actions.push("Verifica que jogadores rematam mais de fora e dá-lhes \"Rematar menos\".")
      add({
        id: "attack.low-quality-shots",
        tone: "problem",
        area: "attack",
        title: "Muitos remates de baixa qualidade",
        detail: `${outside} de ${metrics.shots} remates foram fora da área. Rematar muito com pouca probabilidade de golo também entrega a bola ao adversário.`,
        evidence: [
          `${dec(metrics.xgPerShot)} xG por remate (bom: acima de 0,10)`,
          `${metrics.boxShots} remates dentro da área`,
        ],
        actions,
        priority: 70,
      })
    } else if (metrics.shots >= 6 && metrics.xgPerShot >= 0.12) {
      add({
        id: "attack.good-shot-quality",
        tone: "good",
        area: "attack",
        title: "Boas ocasiões, não só volume",
        detail: `Cada remate vale em média ${dec(metrics.xgPerShot)} xG; a equipa está a chegar a zonas de finalização.`,
        evidence: [`${metrics.boxShots} de ${metrics.shots} remates dentro da área`],
        actions: [],
        priority: 40,
      })
    }

    const dominance = metrics.possessionShare ?? metrics.passShare
    if (dominance >= 0.56 && xg90 < 0.9) {
      const actions: string[] = []
      if (team.tempo === "lower" || team.tempo === "muchLower") actions.push(`Subir o ritmo: ${set("tempo", "balanced")}.`)
      if (team.passReception !== "space") actions.push(`Pedir mais desmarcações para o espaço: ${set("passReception", "space")}.`)
      if (team.attackingWidth === "muchNarrower" || team.attackingWidth === "narrower")
        actions.push(`Abrir o campo um nível: ${set("attackingWidth", team.attackingWidth === "muchNarrower" ? "narrower" : "balanced")}.`)
      add({
        id: "attack.sterile-possession",
        tone: "problem",
        area: "attack",
        title: "Muita bola, pouco perigo",
        detail: `Tens ${pct(dominance)} da posse mas só ${dec(metrics.xg)} xG. A circulação não está a desequilibrar o bloco adversário.`,
        evidence: [
          `${metrics.finalThirdPassesCompleted} passes completos para o último terço`,
          `${dec(xg90)} xG por 90 minutos`,
        ],
        actions,
        priority: 75,
      })
    } else if (dominance >= 0.55 && xg90 >= 1.4) {
      add({
        id: "attack.dominant",
        tone: "good",
        area: "attack",
        title: "Domínio com produção ofensiva",
        detail: `Controlas o jogo (${pct(dominance)} de posse) e isso traduz-se em ocasiões (${dec(metrics.xg)} xG).`,
        evidence: [
          `${metrics.passesCompleted} passes completos (${pct(metrics.passAccuracy)})`,
          `${metrics.finalThirdPassesCompleted} passes completos para o último terço`,
        ],
        actions: [],
        priority: 45,
      })
    }

    // Central congestion: narrow + through the middle, but the opponent blocks it.
    const narrow = team.attackingWidth === "muchNarrower" || team.attackingWidth === "narrower"
    const blocked = metrics.shots > 0 ? 1 - metrics.shotsOnTarget / metrics.shots : 0
    const blockedShots = ourPlayers.reduce((sum, player) => sum + (player.stats.blockedShots ?? 0), 0)
    // Lanes are equal thirds: the centre carries 26% of final-half actions in
    // the median sampled game and 33% at p90, so 33% is already unusual.
    if (narrow && metrics.attackLaneShare.centre >= 0.33 && blockedShots >= 5) {
      add({
        id: "attack.central-congestion",
        tone: "warning",
        area: "attack",
        title: "O jogo interior está congestionado",
        detail:
          `Com a largura em "${instructionLabel("attackingWidth", team.attackingWidth)}" ${pct(metrics.attackLaneShare.centre)} do teu jogo ofensivo passa pelo corredor central (o normal ronda 26%), ` +
          `e ${blockedShots} remates foram bloqueados. O adversário está a fechar o meio.`,
        evidence: [
          `Ações ofensivas: ${pct(metrics.attackLaneShare.left)} esq. · ${pct(metrics.attackLaneShare.centre)} centro · ${pct(metrics.attackLaneShare.right)} dir.`,
          `${pct(blocked)} dos remates não foram à baliza`,
        ],
        actions: [
          `Abrir um nível: ${set("attackingWidth", team.attackingWidth === "muchNarrower" ? "narrower" : "balanced")}.`,
          team.overlap === "both"
            ? "Já tens sobreposição dos dois lados; usa o lado com mais espaço."
            : `Pôr ${set("overlap", "both")} para arrastar os laterais adversários${team.underlap !== "none" ? ` (o jogo obriga a pôr ${set("underlap", "none")})` : ""}.`,
        ],
        priority: 65,
      })
    }

    // FM27's event log rates few crosses as completed: median 14% across the
    // sampled games (p25 10%), so 30% flagged every match. Only flag the worst.
    if (metrics.crossesAttempted >= 15) {
      const rate = metrics.crossesCompleted / metrics.crossesAttempted
      if (rate < 0.1) {
        const crossers = ourPlayers
          .filter((player) => (player.stats.crosses ?? 0) >= 3)
          .sort((a, b) => (b.stats.crosses ?? 0) - (a.stats.crosses ?? 0))
          .slice(0, 3)
        const strikers = ourPlayers.filter((player) => player.isOnPitch && player.inPossession?.position?.startsWith("ST"))
        const aerialStriker = strikers.find(
          (player) => ((attribute(player, "Heading") ?? 0) + (attribute(player, "Jumping Reach") ?? 0)) / 2 >= 14
        )
        const actions = crossers.map(
          (player) =>
            `${playerLabel(player)} (${player.stats.crossesCompleted ?? 0}/${player.stats.crosses ?? 0}, Cruzamentos ${attribute(player, "Crossing") ?? "?"}): instrução individual "Cruzar menos".`
        )
        if (team.patience === "workIntoBox")
          actions.push("A instrução \"Trabalhar a bola até à área\" pede o contrário: menos cruzamentos e mais combinações. Os papéis/instruções individuais dos alas estão a sobrepor-se a isso.")
        if (!aerialStriker && team.crossingStyle !== "low")
          actions.push(`Não tens um avançado forte no ar: ${set("crossingStyle", "low")}.`)
        add({
          id: "attack.crossing",
          tone: "problem",
          area: "attack",
          title: "Cruzamentos a desperdiçar posse",
          detail: `Só ${metrics.crossesCompleted} de ${metrics.crossesAttempted} cruzamentos encontraram um colega (${pct(rate)}). Cada cruzamento falhado é uma posse entregue.`,
          evidence: crossers.map((player) => `${playerLabel(player)}: ${player.stats.crosses ?? 0} cruzamentos`),
          actions,
          priority: 68,
          playerIds: crossers.map((player) => player.id),
        })
      }
    }

    if (per90(metrics.offsides) >= 5 && metrics.offsides >= 4) {
      const offenders = ourPlayers
        .filter((player) => (player.stats.offsides ?? 0) >= 2)
        .sort((a, b) => (b.stats.offsides ?? 0) - (a.stats.offsides ?? 0))
      add({
        id: "attack.offsides",
        tone: "warning",
        area: "attack",
        title: "Demasiados foras de jogo",
        detail: `${metrics.offsides} foras de jogo: as desmarcações estão a sair antes do tempo ou a linha adversária está a subir bem.`,
        evidence: offenders.map(
          (player) =>
            `${playerLabel(player)}: ${player.stats.offsides} (Sem bola ${attribute(player, "Off The Ball") ?? "?"}, Decisões ${attribute(player, "Decisions") ?? "?"})`
        ),
        actions: [
          ...offenders
            .filter((player) => traitsOf(player).includes("likesToTryToBreakOffsideTrap"))
            .map((player) => `${playerLabel(player)} tem a característica "Tenta furar a linha do fora de jogo"; não lhe dês também "Atacar a linha defensiva".`),
          team.passReception === "space"
            ? `Mudar ${set("passReception", "balanced")} para menos bolas nas costas.`
            : "Tira \"Atacar a linha defensiva\" / \"Fazer mais arrancadas\" a quem está mais vezes em fora de jogo.",
        ],
        priority: 50,
        playerIds: offenders.map((player) => player.id),
      })
    }

    const ownThirdLosses = metrics.possessionLostByThird.defensive
    if (team.buildUp === "playThroughPress" || team.goalKicks === "short") {
      const gk = ourPlayers.find((player) => player.isOnPitch && player.inPossession?.position === "GK")
      const centreBacks = ourPlayers.filter((player) => player.isOnPitch && player.inPossession?.position?.startsWith("DC"))
      // Short build-up loses the ball in its own third ~8 times per match in
      // the samples (opponents under our press: 27–51). Flag the clear outliers.
      if (per90(ownThirdLosses) >= 12 && ownThirdLosses >= 10) {
        const weak = [gk, ...centreBacks]
          .filter((player): player is MatchPlayer => Boolean(player))
          .filter((player) => (attribute(player, "Composure") ?? 20) < 12 || (attribute(player, "Passing") ?? 20) < 12)
        add({
          id: "build.own-third-losses",
          tone: "problem",
          area: "transition",
          title: "Perdas de bola na tua zona de construção",
          detail: `${ownThirdLosses} perdas no teu terço defensivo. Com "${instructionLabel("buildUp", team.buildUp)}" isto dá ocasiões fáceis ao adversário.`,
          evidence: weak.map(
            (player) => `${playerLabel(player)}: Passe ${attribute(player, "Passing")}, Compostura ${attribute(player, "Composure")}`
          ),
          actions: [
            `Mudar ${set("buildUp", "balanced")} ou ${instructionLabel("buildUp", "bypassPress").toLowerCase()} enquanto o adversário pressionar alto.`,
            team.goalKicks === "short" ? `Mudar ${set("goalKicks", "balanced")}.` : "",
          ].filter(Boolean),
          priority: 80,
        })
      } else if (metrics.passesAttempted >= 150 && per90(ownThirdLosses) <= 4) {
        add({
          id: "build.clean",
          tone: "good",
          area: "transition",
          title: "Saída de bola limpa",
          detail: `Só ${ownThirdLosses} perda(s) no teu terço defensivo: a construção curta está a funcionar.`,
          evidence: [`Precisão de passe ${pct(metrics.passAccuracy)}`],
          actions: [],
          priority: 30,
        })
      }
    }

    const aerials = metrics.aerialsWon + metrics.aerialsLost
    if (aerials >= 15 && metrics.aerialsWon / aerials < 0.4) {
      const losers = ourPlayers
        .filter((player) => (player.stats.aerials ?? 0) >= 4)
        .map((player) => ({ player, rate: (player.stats.aerialsWon ?? 0) / Math.max(1, player.stats.aerials ?? 0) }))
        .filter((item) => item.rate < 0.4)
        .sort((a, b) => a.rate - b.rate)
        .slice(0, 3)
      add({
        id: "duels.aerial",
        tone: "warning",
        area: "defence",
        title: "Perdes a maioria dos duelos aéreos",
        detail: `${metrics.aerialsWon} de ${aerials} duelos aéreos ganhos (${pct(metrics.aerialsWon / aerials)}). Bolas longas e cruzamentos favorecem o adversário.`,
        evidence: losers.map(
          ({ player }) =>
            `${playerLabel(player)}: ${player.stats.aerialsWon ?? 0}/${player.stats.aerials ?? 0} (Cabeceamento ${attribute(player, "Heading") ?? "?"}, Impulsão ${attribute(player, "Jumping Reach") ?? "?"})`
        ),
        actions: [
          team.crossingStyle !== "low" ? `Ofensivamente, ${set("crossingStyle", "low")}.` : "Evita bolas pelo ar para quem perde os duelos (avançado alvo/cruzamentos altos).",
          team.crossEngagement !== "stop" ? `Defensivamente, ${set("crossEngagement", "stop")} para reduzir cruzamentos do adversário.` : "",
        ].filter(Boolean),
        priority: 45,
        playerIds: losers.map(({ player }) => player.id),
      })
    }
  }

  // ── Defence ───────────────────────────────────────────────────────────
  if (enoughData) {
    if (oppXg90 <= 0.7 && per90(opponent.shots) <= 9) {
      add({
        id: "defence.solid",
        tone: "good",
        area: "defence",
        title: "Defesa a controlar o adversário",
        detail: `O adversário só chegou a ${dec(opponent.xg)} xG em ${opponent.shots} remates.`,
        evidence: [`${opponent.boxShots} remates do adversário dentro da área`],
        actions: [],
        priority: 50,
      })
    } else if (oppXg90 >= 1.5) {
      add({
        id: "defence.leaking",
        tone: "problem",
        area: "defence",
        title: "Estás a conceder demasiadas ocasiões",
        detail: `${dec(opponent.xg)} xG concedidos (${dec(oppXg90)} por 90'). A estrutura sem bola não está a proteger a baliza.`,
        evidence: [
          `${opponent.shots} remates do adversário, ${opponent.boxShots} dentro da área`,
          `${opponent.transitionShots} remates do adversário em transição`,
        ],
        actions: [
          team.defensiveLine === "higher" || team.defensiveLine === "muchHigher"
            ? `Baixar a linha um nível: ${set("defensiveLine", team.defensiveLine === "muchHigher" ? "higher" : "balanced")}.`
            : `Reduzir riscos: ${set("lineOfEngagement", "midBlock")}.`,
        ],
        priority: 85,
      })
    }

    // The opponent's left is our right and vice versa.
    const threat = strongestLane(opponent.attackLaneShare)
    if (opponent.attackActionCount >= 20 && threat.lane !== "centre" && threat.share >= 0.45) {
      const ourFlank = threat.lane === "left" ? "right" : "left"
      const flankPlayers = ourPlayers.filter(
        (player) =>
          player.isOnPitch &&
          isOnFlank(player.inPossession?.position ?? player.position, ourFlank)
      )
      add({
        id: `defence.flank-${ourFlank}`,
        tone: "warning",
        area: "defence",
        title: `O adversário ataca pelo teu lado ${laneNames[ourFlank]}`,
        detail: `${pct(threat.share)} das ações ofensivas do adversário no teu meio-campo são pelo teu corredor ${laneNames[ourFlank]}.`,
        evidence: flankPlayers.map(
          (player) =>
            `${playerLabel(player)} (${rolePt(player.inPossession?.role)} c/ bola, ${rolePt(player.outOfPossession?.role)} s/ bola) · Posicionamento ${attribute(player, "Positioning") ?? "?"}, Índice de trabalho ${attribute(player, "Work Rate") ?? "?"}`
        ),
        actions: [
          `Dá ao lateral desse lado uma função mais defensiva sem bola (ex.: Lateral defensivo) ou tira-lhe "Fazer mais arrancadas".`,
          `O médio/extremo desse lado deve ter "Marcar mais apertado" ou um papel sem bola de trabalho (Médio ala).`,
          team.pressingTrap === "balanced"
            ? `Se o perigo vier por fora, ${set("pressingTrap", "inside")} empurra o jogo deles para o meio, onde tens o médio defensivo.`
            : "",
        ].filter(Boolean),
        priority: 60,
        playerIds: flankPlayers.map((player) => player.id),
      })
    }
  }

  // ── Pressing & transitions ───────────────────────────────────────────
  if (enoughData) {
    const pressing =
      team.lineOfEngagement === "highPress" || team.triggerPress === "moreOften"
    if (pressing) {
      const highRegains90 = per90(metrics.highRegains)
      // Mean height of defensive actions never reached 40% in the samples:
      // our high press sits at 33–39%, the opponents at 21–30%.
      if (highRegains90 >= 9 && (metrics.defensiveActionHeight ?? 50) >= 34) {
        add({
          id: "pressing.working",
          tone: "good",
          area: "pressing",
          title: "A pressão alta está a recuperar bolas",
          detail: `${metrics.highRegains} recuperações no meio-campo adversário. A pressão está a dar-te posse perto da baliza deles.`,
          evidence: [
            metrics.defensiveActionHeight != null
              ? `Altura média das ações defensivas: ${Math.round(metrics.defensiveActionHeight)}% do campo`
              : "",
          ].filter(Boolean),
          actions: [],
          priority: 45,
        })
      } else if (
        metrics.defensiveActionHeight != null &&
        metrics.defensiveActionHeight < 36 &&
        highRegains90 < 7 &&
        metrics.possessionGained >= 10
      ) {
        const tired = ourPlayers.filter(
          (player) => player.isOnPitch && condition(player) != null && condition(player)! < 70
        )
        add({
          id: "pressing.not-high",
          tone: "warning",
          area: "pressing",
          title: "Pressionas alto mas recuperas baixo",
          detail:
            `A tática pede ${instructionLabel("lineOfEngagement", team.lineOfEngagement).toLowerCase()}, mas a altura média das recuperações é ${Math.round(metrics.defensiveActionHeight)}% do campo. ` +
            "O adversário está a sair da primeira pressão.",
          evidence: [
            `${metrics.highRegains} recuperações no meio-campo adversário`,
            ...tired.map((player) => `${playerLabel(player)} com ${condition(player)}% de condição física`),
          ],
          actions: [
            team.shortGkDistribution !== "yes" ? `Ativar ${set("shortGkDistribution", "yes")}.` : "",
            "Se o adversário joga longo por cima da pressão, troca para Bloco médio e mantém a linha.",
            tired.length ? "Jogadores cansados pressionam mal: considera substituições nas posições da frente." : "",
          ].filter(Boolean),
          priority: 55,
        })
      }
    }

    if (team.defensiveTransition === "counterPress" && metrics.counterPressOpportunities >= 12) {
      const rate = metrics.counterPressRecoveries / metrics.counterPressOpportunities
      if (rate >= 0.25) {
        add({
          id: "transition.counterpress-working",
          tone: "good",
          area: "transition",
          title: "A contra-pressão está a funcionar",
          detail: `Recuperaste a bola em menos de 8 segundos em ${pct(rate)} das perdas.`,
          evidence: [`${metrics.counterPressRecoveries} recuperações rápidas em ${metrics.counterPressOpportunities} perdas`],
          actions: [],
          priority: 40,
        })
      } else if (rate < 0.1 && metrics.counterPressOpportunities >= 15) {
        add({
          id: "transition.counterpress-failing",
          tone: "warning",
          area: "transition",
          title: "A contra-pressão não está a recuperar a bola",
          detail: `Só ${pct(rate)} das perdas foram recuperadas em 8 segundos. Sem esse efeito, a contra-pressão só gasta energia e abre espaços.`,
          evidence: [`${opponent.transitionShots} remates do adversário em transição (${dec(opponent.transitionXg)} xG)`],
          actions:
            opponent.transitionShots >= 2
              ? [`Mudar ${set("defensiveTransition", "regroup")} enquanto o adversário sair bem em transição.`]
              : ["Ainda não está a custar ocasiões; vigia os remates do adversário em transição."],
          priority: 50,
        })
      }
    }

    if (opponent.transitionShots >= 2 && (opponent.transitionXg >= 0.3 || opponent.transitionShots >= 3)) {
      const highLine = team.defensiveLine === "higher" || team.defensiveLine === "muchHigher"
      const attackingFullBacks = ourPlayers.filter(
        (player) =>
          player.isOnPitch &&
          (player.inPossession?.role?.includes("Wing-Back") ?? false) &&
          player.inPossession?.duty !== "Defend"
      )
      add({
        id: "transition.exposed",
        tone: "problem",
        area: "transition",
        title: "Exposto quando perdes a bola",
        detail: `${opponent.transitionShots} remates do adversário nasceram até 15 segundos depois de recuperar a bola (${dec(opponent.transitionXg)} xG).`,
        evidence: [
          highLine ? `Linha defensiva "${instructionLabel("defensiveLine", team.defensiveLine)}"` : "",
          attackingFullBacks.length >= 2 ? `Os dois laterais sobem como alas (${attackingFullBacks.map(playerLabel).join(", ")})` : "",
        ].filter(Boolean),
        actions: [
          attackingFullBacks.length >= 2 ? "Deixa um dos laterais com dever Defender ou papel de Lateral defensivo para haver três atrás na transição." : "",
          highLine ? `Baixar a linha um nível: ${set("defensiveLine", team.defensiveLine === "muchHigher" ? "higher" : "balanced")}.` : "",
          team.defensiveTransition === "counterPress" ? `Se continuar: ${set("defensiveTransition", "regroup")}.` : "",
        ].filter(Boolean),
        priority: 82,
      })
    }

    if (team.attackingTransition === "counter") {
      if (metrics.transitionShots >= 3) {
        add({
          id: "transition.counter-working",
          tone: "good",
          area: "transition",
          title: "Os contra-ataques estão a criar perigo",
          detail: `${metrics.transitionShots} remates nasceram até 15 segundos após recuperar a bola (${dec(metrics.transitionXg)} xG).`,
          evidence: [],
          actions: [],
          priority: 40,
        })
      } else if (metrics.possessionGained >= 25 && metrics.transitionShots === 0 && minutes >= 30) {
        add({
          id: "transition.counter-idle",
          tone: "info",
          area: "transition",
          title: "O contra-ataque não está a aparecer",
          detail: `Recuperaste ${metrics.possessionGained} bolas mas nenhum remate saiu de uma transição rápida. Com o ritmo "${instructionLabel("tempo", team.tempo)}" a equipa tende a reorganizar em vez de acelerar.`,
          evidence: [],
          actions: ["Se o adversário deixa espaço atrás, é aceitável; se não, não há problema em manter. Não precisas de mudar nada só por isto."],
          priority: 20,
        })
      }
    }

    const ourYellows = match.events.filter(
      (event) => event.type === "yellow_card" && event.team === side &&
        event.minute >= window.fromMinute && event.minute <= window.toMinute
    )
    // 3 yellows is the median for our side in the samples; 4+ is the top quarter.
    if (ourYellows.length >= 4) {
      const booked = ourYellows
        .map((event) => ourPlayers.find((player) => player.id === event.playerId))
        .filter((player): player is MatchPlayer => Boolean(player))
      add({
        id: "discipline.cards",
        tone: "warning",
        area: "defence",
        title: `${ourYellows.length} amarelos: risco de ficar com 10`,
        detail: "A agressividade sem bola está a sair cara. Jogadores amarelados ficam mais cautelosos e podem ser expulsos.",
        evidence: booked.map(
          (player) => `${playerLabel(player)}${player.isOnPitch ? " (em campo)" : ""}, Agressividade ${attribute(player, "Aggression") ?? "?"}`
        ),
        actions: [
          team.tackling !== "stayOnFeet" ? `Mudar ${set("tackling", "stayOnFeet")}.` : "",
          ...booked
            .filter((player) => player.isOnPitch && instructionsForSlot(profile, player.inPossession?.position).includes("tackleHarder"))
            .map((player) => `Tirar "Desarmar com mais força" a ${playerLabel(player)}.`),
        ].filter(Boolean),
        priority: 58,
        playerIds: booked.map((player) => player.id),
      })
    }
  }

  // ── Momentum / game state ────────────────────────────────────────────
  if (momentum != null && minutes >= 10) {
    if (momentum <= -0.25) {
      add({
        id: "state.momentum-against",
        tone: "warning",
        area: "gameState",
        title: isFull ? "O adversário tem mandado no jogo" : "O adversário está por cima neste período",
        detail: "O indicador de momentum do FM está claramente do lado do adversário.",
        evidence: [`Momentum médio: ${Math.round(momentum * 100)}`],
        actions:
          goalsFor > goalsAgainst
            ? [`A ganhar: proteger o resultado (${set("defensiveLine", "balanced")}, ${set("tempo", "lower")}) e trocar quem está cansado.`]
            : ["Muda algo para quebrar o padrão: uma substituição no meio-campo ou mudar a armadilha de pressão costuma ser suficiente."],
        priority: 62,
      })
    } else if (momentum >= 0.25) {
      add({
        id: "state.momentum-for",
        tone: "good",
        area: "gameState",
        title: isFull ? "Tens mandado no jogo" : "Estás por cima neste período",
        detail: "O momentum está do teu lado; não é altura de mexer na estrutura.",
        evidence: [`Momentum médio: +${Math.round(momentum * 100)}`],
        actions: [],
        priority: 35,
      })
    }
  }

  if (isFull && match.clock.minute >= 60 && match.clock.minute < 90) {
    if (goalsFor < goalsAgainst) {
      add({
        id: "state.chasing",
        tone: "info",
        area: "gameState",
        title: "A perder com a última meia hora pela frente",
        detail: "É altura de assumir mais risco.",
        evidence: [`${goalsFor}-${goalsAgainst} ao minuto ${match.clock.minute}`],
        actions: [
          "Subir a mentalidade um nível.",
          "Trocar um médio defensivo por um jogador ofensivo fresco.",
          team.shotsFromDistance === "less" ? `Mudar ${set("shotsFromDistance", "balanced")}.` : "",
        ].filter(Boolean),
        priority: 70,
      })
    } else if (goalsFor - goalsAgainst === 1 && match.clock.minute >= 75) {
      add({
        id: "state.protecting",
        tone: "info",
        area: "gameState",
        title: "A ganhar por um golo na reta final",
        detail: "Reduzir riscos sem recuar demasiado.",
        evidence: [`${goalsFor}-${goalsAgainst} ao minuto ${match.clock.minute}`],
        actions: [
          team.timeWasting !== "moreOften" ? `Mudar ${set("timeWasting", "moreOften")}.` : "",
          team.defensiveTransition === "counterPress" ? `Mudar ${set("defensiveTransition", "regroup")}.` : "",
          "Trocar jogadores cansados ou amarelados por frescos na mesma posição.",
        ].filter(Boolean),
        priority: 70,
      })
    }
  }

  // ── Tactic ↔ squad (independent of the window) ───────────────────────
  const onPitch = ourPlayers.filter((player) => player.isOnPitch)
  if (team.defensiveLine === "higher" || team.defensiveLine === "muchHigher") {
    const slowCentreBacks = onPitch.filter((player) => {
      if (!player.inPossession?.position?.startsWith("DC")) return false
      const pace = attribute(player, "Pace")
      const acceleration = attribute(player, "Acceleration")
      return pace != null && acceleration != null && (pace + acceleration) / 2 < 12
    })
    if (slowCentreBacks.length) {
      add({
        id: "tactic.high-line-slow-cbs",
        tone: "warning",
        area: "tactic",
        title: "Linha alta com centrais lentos",
        detail: "Uma linha defensiva alta deixa espaço nas costas; centrais sem velocidade sofrem com bolas em profundidade.",
        evidence: slowCentreBacks.map(
          (player) => `${playerLabel(player)}: Velocidade ${attribute(player, "Pace")}, Aceleração ${attribute(player, "Acceleration")}, Antecipação ${attribute(player, "Anticipation") ?? "?"}`
        ),
        actions: [
          `Contra adversários rápidos, ${set("defensiveLine", team.defensiveLine === "muchHigher" ? "higher" : "balanced")}.`,
          "Ou procura um central mais rápido para jogar ao lado deste.",
        ],
        priority: 48,
        playerIds: slowCentreBacks.map((player) => player.id),
      })
    }
  }
  if (team.buildUp === "playThroughPress") {
    const gk = onPitch.find((player) => player.inPossession?.position === "GK")
    if (gk) {
      const passing = attribute(gk, "Passing")
      const composure = attribute(gk, "Composure")
      if (passing != null && composure != null && (passing + composure) / 2 < 12) {
        add({
          id: "tactic.gk-build-up",
          tone: "warning",
          area: "tactic",
          title: "O guarda-redes não é o ideal para sair a jogar",
          detail: `"${instructionLabel("buildUp", team.buildUp)}" e saídas curtas dependem do GR com bola.`,
          evidence: [`${playerLabel(gk)}: Passe ${passing}, Compostura ${composure}, Primeiro toque ${attribute(gk, "First Touch") ?? "?"}`],
          actions: [`Considera ${set("gkDistribution", "fullBacks")} ou ${set("goalKicks", "balanced")}.`],
          priority: 40,
          playerIds: [gk.id],
        })
      }
    }
  }
  if (team.lineOfEngagement === "highPress" && team.triggerPress === "moreOften") {
    const outfield = onPitch.filter((player) => player.inPossession?.position !== "GK")
    const stamina = average(outfield.map((player) => attribute(player, "Stamina")))
    const lateGame = match.clock.minute >= 60
    const tired = outfield.filter((player) => (condition(player) ?? 100) < 65)
    if ((stamina != null && stamina < 13) || (lateGame && tired.length >= 3)) {
      add({
        id: "tactic.press-fatigue",
        tone: "warning",
        area: "tactic",
        title: "Pressão muito intensa para a condição física do onze",
        detail: "Pressão alta + pressionar mais vezes é das combinações mais exigentes do FM.",
        evidence: [
          stamina != null ? `Resistência média do onze: ${dec(stamina, 1)}` : "",
          ...tired.map((player) => `${playerLabel(player)}: ${condition(player)}% de condição`),
        ].filter(Boolean),
        actions: [
          lateGame ? `Na reta final, ${set("triggerPress", "balanced")}.` : "Planeia trocar os jogadores que mais pressionam por volta dos 60-65'.",
        ],
        priority: 52,
        playerIds: tired.map((player) => player.id),
      })
    }
  }

  // ── Players ──────────────────────────────────────────────────────────
  const players = ourPlayers
    .filter(hasPlayed)
    .map((player) => buildPlayerReport(player, match, profile, ourPlayers))
    .sort((a, b) => slotOrder(a.slot) - slotOrder(b.slot))

  for (const report of players) {
    const problems = report.notes.filter((note) => note.tone === "problem")
    if (problems.length && report.isOnPitch) {
      add({
        id: `player.${report.id}`,
        tone: "problem",
        area: "players",
        title: `${report.name}: ${problems[0].text.split(":")[0]}`,
        detail: problems.map((note) => note.text).join(" "),
        evidence: [],
        actions: report.notes.filter((note) => note.tone === "info" && note.text.startsWith("Alternativa")).map((note) => note.text),
        priority: 55,
        playerIds: [report.id],
      })
    }
  }

  const scores: AnalysisScores = {
    attack: clamp(lerpScore(xg90, [[0, 10], [0.6, 35], [1.2, 55], [1.8, 75], [2.6, 92]])),
    defence: clamp(lerpScore(oppXg90, [[0.2, 92], [0.6, 75], [1.1, 55], [1.7, 35], [2.6, 12]])),
    pressing: clamp(
      lerpScore(per90(metrics.highRegains), [[0, 15], [4, 40], [8, 62], [13, 85], [18, 95]]) * 0.6 +
        lerpScore(metrics.defensiveActionHeight ?? 30, [[22, 15], [27, 40], [33, 60], [39, 85]]) * 0.4
    ),
    transition: clamp(
      lerpScore(
        metrics.counterPressOpportunities > 0 ? metrics.counterPressRecoveries / metrics.counterPressOpportunities : 0.2,
        [[0.05, 25], [0.1, 42], [0.18, 60], [0.3, 85]]
      ) * 0.5 +
        lerpScore(per90(opponent.transitionXg), [[0, 90], [0.3, 65], [0.7, 40], [1.2, 15]]) * 0.5
    ),
  }

  return {
    side,
    teamName: match[side].name,
    opponentName: match[opposite(side)].name,
    minute: match.clock.minute,
    window,
    goalsFor,
    goalsAgainst,
    metrics,
    opponent,
    momentum,
    scores,
    headline: buildHeadline(match[side].name, metrics, opponent, goalsFor, goalsAgainst, isFull),
    insights: sortInsights(insights),
    players,
  }
}

const toneOrder: Record<InsightTone, number> = { problem: 0, warning: 1, info: 2, good: 3 }

function sortInsights(insights: Insight[]) {
  return insights.sort(
    (a, b) => toneOrder[a.tone] - toneOrder[b.tone] || b.priority - a.priority
  )
}

function buildHeadline(
  teamName: string,
  metrics: TeamWindowMetrics,
  opponent: TeamWindowMetrics,
  goalsFor: number,
  goalsAgainst: number,
  isFull: boolean
) {
  const xgDiff = metrics.xg - opponent.xg
  const xgShare = metrics.xg + opponent.xg > 0 ? metrics.xg / (metrics.xg + opponent.xg) : 0.5
  const xgText = `xG ${dec(metrics.xg)} – ${dec(opponent.xg)}`
  const period = isFull ? "" : " neste período"
  const clearlyBetter = xgDiff >= 0.8 || (xgDiff >= 0.4 && xgShare >= 0.68)
  const clearlyWorse = xgDiff <= -0.8 || (xgDiff <= -0.4 && xgShare <= 0.32)
  if (clearlyBetter) {
    if (isFull && goalsFor <= goalsAgainst)
      return `${teamName} foi melhor${period} (${xgText}), mas o resultado não reflete isso.`
    return `${teamName} está a dominar${period} (${xgText}).`
  }
  if (clearlyWorse) {
    if (isFull && goalsFor >= goalsAgainst)
      return `O resultado é melhor do que a exibição${period} (${xgText}).`
    return `O adversário está a ser superior${period} (${xgText}).`
  }
  return `Jogo equilibrado${period} (${xgText}).`
}

function strongestLane(share: Record<Lane, number>) {
  const entries = Object.entries(share) as Array<[Lane, number]>
  const [lane, value] = entries.sort((a, b) => b[1] - a[1])[0]
  return { lane, share: value }
}

function isOnFlank(slot: string | undefined, flank: "left" | "right") {
  if (!slot) return false
  const upper = slot.toUpperCase()
  const suffix = flank === "left" ? "L" : "R"
  return ["D", "WB", "M", "AM", "DM"].some((prefix) => upper === `${prefix}${suffix}`)
}

function average(values: Array<number | undefined>) {
  const present = values.filter((value): value is number => value != null)
  if (!present.length) return undefined
  return present.reduce((sum, value) => sum + value, 0) / present.length
}

export function condition(player: MatchPlayer) {
  const live = player.stats.overallPhysicalCondition
  if (live != null && live > 0) return Math.round(live)
  const pre = player.profile?.condition
  return pre != null && pre > 0 ? Math.round(pre / 100) : undefined
}

const slotSequence = ["GK", "DL", "WBL", "DCL", "DC", "DCR", "DR", "WBR", "DML", "DMC", "DMR", "DM", "ML", "MCL", "MC", "MCR", "MR", "AML", "AMCL", "AMC", "AMCR", "AMR", "STL", "ST", "STC", "STR"]
function slotOrder(slot?: string) {
  const index = slot ? slotSequence.indexOf(slot.toUpperCase()) : -1
  return index === -1 ? 99 : index
}

function instructionLabelOf(id: TeamInstructionId) {
  return teamInstructionShortLabels[id]
}

/** "Largura ofensiva: Equilibrada" — the instruction and the option as written in the suggestions. */
export function instructionSetting(id: TeamInstructionId, value: string) {
  return `${instructionLabelOf(id)}: ${instructionLabel(id, value)}`
}

const teamInstructionShortLabels: Record<TeamInstructionId, string> = {
  attackingTransition: "Transição ofensiva",
  attackingWidth: "Largura ofensiva",
  buildUp: "Estratégia de construção",
  creativeFreedom: "Liberdade criativa",
  crossingStyle: "Tipo de cruzamento",
  dribbling: "Drible",
  gkDistribution: "Distribuição do GR",
  gkDistributionSpeed: "Velocidade de distribuição do GR",
  goalKicks: "Pontapés de baliza",
  overlap: "Sobreposição",
  underlap: "Sobreposição interior",
  passReception: "Receção do passe",
  passingDirectness: "Tipo de passe",
  patience: "Paciência",
  setPieces: "Bolas paradas",
  progressThrough: "Avançar por",
  shotsFromDistance: "Remates de longe",
  tempo: "Ritmo",
  timeWasting: "Queimar tempo",
  crossEngagement: "Oposição aos cruzamentos",
  defensiveLine: "Linha defensiva",
  defensiveLineBehaviour: "Comportamento da linha",
  defensiveTransition: "Transição defensiva",
  lineOfEngagement: "Linha de pressão",
  pressingTrap: "Armadilha de pressão",
  shortGkDistribution: "Pressionar saída curta do GR",
  tackling: "Desarme",
  triggerPress: "Frequência de pressão",
}

// ── Player reports ─────────────────────────────────────────────────────

function buildPlayerReport(
  player: MatchPlayer,
  match: MatchSnapshot,
  profile: TacticProfile,
  squad: MatchPlayer[]
): PlayerReport {
  const slot = player.inPossession?.position ?? player.position
  const instructions = instructionsForSlot(profile, slot)
  const traits = traitsOf(player)
  const fitIn = roleFit(player, player.inPossession?.role)
  const fitOut = roleFit(player, player.outOfPossession?.role)
  const minutes = minutesPlayed(player, match.clock.minute)
  const notes: PlayerNote[] = []
  const a = (name: string) => attribute(player, name)
  const name = playerLabel(player)
  const stats = player.stats
  const cond = condition(player)
  const pressRole = /Pressing|Tracking/.test(player.outOfPossession?.role ?? "")

  for (const fit of [fitIn, fitOut]) {
    if (!fit) continue
    if (fit === fitOut && fitIn?.role === fitOut.role) continue
    const weakest = fit.weakest.map((item) => `${attributeLabels[item.attribute] ?? item.attribute} ${item.value}`).join(", ")
    if (fit.score < 11) {
      notes.push({ tone: "problem", text: `Encaixe fraco como ${fit.rolePt}: média ${dec(fit.score, 1)} nos atributos-chave (mais fracos: ${weakest}).` })
    } else if (fit.score < 12.5) {
      notes.push({ tone: "warning", text: `Encaixe razoável como ${fit.rolePt} (${dec(fit.score, 1)}); pontos fracos: ${weakest}.` })
    } else if (fit.score >= 15) {
      notes.push({ tone: "good", text: `Ótimo encaixe como ${fit.rolePt} (${dec(fit.score, 1)}).` })
    }
  }

  const has = (tag: PlayerInstructionTag) => instructions.includes(tag)
  const hasTrait = (trait: Parameters<typeof traits.includes>[0]) => traits.includes(trait)

  if ((has("pressMore") || pressRole) && ((a("Work Rate") ?? 20) < 12 || (a("Stamina") ?? 20) < 12)) {
    notes.push({ tone: "warning", text: `Pede-se muita pressão mas tem Índice de trabalho ${a("Work Rate")} e Resistência ${a("Stamina")}: vai cansar cedo.` })
  }
  const isForward = /^(ST|AM)/.test((slot ?? "").toUpperCase())
  if ((has("pressMore") || pressRole) && !isForward && (a("Tackling") ?? 20) <= 8) {
    const won = stats.pressesWon ?? 0
    const attempted = stats.pressesAttempted ?? 0
    notes.push({
      tone: "warning",
      text: `Pressiona com Desarme ${a("Tackling")}${attempted ? ` (${won}/${attempted} pressões ganhas)` : ""}: incomoda, mas raramente fica com a bola. Para pressionar no meio-campo é preciso Desarme e Agressividade.`,
    })
  }
  if (has("dribbleMore") && (a("Dribbling") ?? 20) < 13) {
    notes.push({ tone: "warning", text: `"Fintar mais" com Drible ${a("Dribbling")}: o mais provável é perder a bola.` })
  }
  if (has("dribbleLess") && (hasTrait("runsWithBallOften") || hasTrait("likesToBeatManRepeatedly"))) {
    notes.push({ tone: "warning", text: `"Fintar menos" choca com a característica "${traitLabels[hasTrait("runsWithBallOften") ? "runsWithBallOften" : "likesToBeatManRepeatedly"]}".` })
  }
  if (has("moreRisk") && ((a("Passing") ?? 20) < 13 || (a("Vision") ?? 20) < 12 || (a("Decisions") ?? 20) < 12)) {
    notes.push({ tone: "warning", text: `"Correr mais riscos no passe" com Passe ${a("Passing")}, Visão ${a("Vision")}, Decisões ${a("Decisions")}: muitos passes vão sair cortados.` })
  }
  if (has("lessRisk") && (a("Vision") ?? 0) >= 15 && (a("Passing") ?? 0) >= 15) {
    notes.push({ tone: "info", text: `"Correr menos riscos" num jogador com Visão ${a("Vision")} e Passe ${a("Passing")} desperdiça criatividade.` })
  }
  if (has("lessRisk") && hasTrait("triesKillerBallsOften")) {
    notes.push({ tone: "warning", text: `"Correr menos riscos" choca com a característica "Tenta passes de rotura".` })
  }
  if (has("moreRisk") && hasTrait("playsShortSimplePasses")) {
    notes.push({ tone: "warning", text: `"Correr mais riscos" choca com a característica "Faz passes curtos e simples".` })
  }
  if (has("fewerForwardRuns") && (hasTrait("getsForwardWheneverPossible") || hasTrait("getsIntoOppositionArea"))) {
    notes.push({
      tone: "warning",
      text: `"Fazer menos corridas" choca com a característica "${traitLabels[hasTrait("getsForwardWheneverPossible") ? "getsForwardWheneverPossible" : "getsIntoOppositionArea"]}": o jogador vai ignorar parte da instrução.`,
    })
  }
  if (has("moreForwardRuns") && hasTrait("staysBackAtAllTimes")) {
    notes.push({ tone: "problem", text: `Instrução contraditória: "Fazer mais arrancadas" num jogador com a característica "Fica sempre atrás". Ele vai subir menos do que a tática espera, e o corredor fica sem profundidade.` })
  }
  if (profile.team.passingDirectness.toLowerCase().includes("shorter") && hasTrait("triesLongRangePasses")) {
    notes.push({ tone: "info", text: `Tem a característica "Tenta passes longos" numa tática de passe curto: vai arriscar bolas longas mais vezes do que os colegas.` })
  }
  if (has("moreForwardRuns") && (a("Stamina") ?? 20) < 12) {
    notes.push({ tone: "warning", text: `"Fazer mais arrancadas" com Resistência ${a("Stamina")}: vai quebrar fisicamente.` })
  }
  if ((has("stayNarrower") || has("cutInside")) && hasTrait("hugsLine")) {
    notes.push({ tone: "warning", text: `Pede-se que jogue por dentro, mas tem a característica "Cola-se à linha".` })
  }
  if (has("shootLess") && (hasTrait("shootsFromDistance") || (a("Long Shots") ?? 0) >= 15)) {
    notes.push({ tone: "info", text: `"Rematar menos" num jogador ${hasTrait("shootsFromDistance") ? "com a característica \"Remata de longe\"" : `com Remates de longe ${a("Long Shots")}`}.` })
  }
  if (has("holdUpBall") && (a("Strength") ?? 20) < 12 && (a("First Touch") ?? 20) < 13) {
    notes.push({ tone: "warning", text: `"Segurar a bola" com Força ${a("Strength")} e Primeiro toque ${a("First Touch")}: vai perder muitas bolas de costas.` })
  }
  if (has("tackleHarder") && (a("Tackling") ?? 20) < 12) {
    notes.push({ tone: "warning", text: `"Desarmar com mais força" com Desarme ${a("Tackling")}: mais faltas do que bolas ganhas.` })
  }
  if (has("markTighter") && ((a("Pace") ?? 20) + (a("Acceleration") ?? 20)) / 2 < 11) {
    notes.push({ tone: "warning", text: `"Marcar mais apertado" com Velocidade ${a("Pace")}: é fácil de arrastar para fora de posição.` })
  }
  if (has("crossToTargetForward")) {
    const striker = squad.find((candidate) => candidate.isOnPitch && candidate.inPossession?.position?.startsWith("ST"))
    if (striker && ((attribute(striker, "Heading") ?? 0) + (attribute(striker, "Jumping Reach") ?? 0)) / 2 < 12) {
      notes.push({ tone: "warning", text: `Cruza para o avançado alvo, mas ${playerLabel(striker)} tem Cabeceamento ${attribute(striker, "Heading")} e Impulsão ${attribute(striker, "Jumping Reach")}.` })
    }
  }

  // Match performance
  if (minutes >= 25 && player.rating != null) {
    if (player.rating <= 6.3) notes.push({ tone: "problem", text: `Rendimento baixo: nota ${dec(player.rating, 1)} em ${minutes} minutos.` })
    else if (player.rating >= 7.3) notes.push({ tone: "good", text: `Está a ser dos melhores (nota ${dec(player.rating, 1)}).` })
  }
  if ((stats.possessionLost ?? 0) >= 12) {
    notes.push({
      tone: "warning",
      text: `${stats.possessionLost} perdas de bola${has("dribbleMore") ? ", em parte pelo \"Fintar mais\"" : ""}${has("moreRisk") ? ", em parte pelo \"Correr mais riscos\"" : ""}.`,
    })
  }
  if ((stats.passes ?? 0) >= 20 && (stats.passesCompleted ?? 0) / (stats.passes ?? 1) < 0.72) {
    notes.push({ tone: "warning", text: `Só ${pct((stats.passesCompleted ?? 0) / (stats.passes ?? 1))} de passes certos (${stats.passesCompleted}/${stats.passes}).` })
  }
  if ((stats.pressesAttempted ?? 0) >= 8 && (stats.pressesWon ?? 0) / (stats.pressesAttempted ?? 1) < 0.2) {
    notes.push({ tone: "info", text: `Pressionou ${stats.pressesAttempted} vezes mas só ganhou ${stats.pressesWon}.` })
  }
  if ((stats.offsides ?? 0) >= 3) {
    notes.push({ tone: "warning", text: `${stats.offsides} foras de jogo.` })
  }
  const yellow = match.events.some((event) => event.type === "yellow_card" && event.playerId === player.id)
  if (yellow && player.isOnPitch) {
    const risky = has("tackleHarder") || (a("Aggression") ?? 0) >= 15 || pressRole
    notes.push({
      tone: risky ? "warning" : "info",
      text: risky
        ? `Amarelado e com perfil agressivo (Agressividade ${a("Aggression")}${has("tackleHarder") ? ", \"Desarmar com mais força\"" : ""}): risco de expulsão.`
        : "Amarelado.",
    })
  }
  if (player.isOnPitch && cond != null && cond < 65 && match.clock.minute >= 45) {
    notes.push({ tone: "warning", text: `Condição física em ${cond}%: rende menos e lesiona-se mais.` })
  }

  // Bench alternative for weak fits or tired/booked players still on the pitch.
  const needsAlternative =
    player.isOnPitch &&
    (notes.some((note) => note.tone === "problem") ||
      (cond != null && cond < 65 && match.clock.minute >= 55))
  if (needsAlternative) {
    const alternative = bestAlternative(player, squad)
    if (alternative) {
      notes.push({
        tone: "info",
        text: `Alternativa no banco: ${playerLabel(alternative.player)} (${alternative.fit ? `${dec(alternative.fit.score, 1)} como ${alternative.fit.rolePt}` : "mesma posição"}, condição ${condition(alternative.player) ?? "?"}%).`,
      })
    }
  }

  return {
    id: player.id,
    name,
    slot,
    slotLabel: slotLabel(slot),
    roleIn: player.inPossession?.role,
    roleOut: player.outOfPossession?.role,
    minutes,
    isOnPitch: player.isOnPitch,
    rating: player.rating,
    condition: cond,
    fitIn,
    fitOut,
    instructions,
    traits: traits.map((trait) => traitLabels[trait] ?? trait),
    notes,
  }
}

function bestAlternative(player: MatchPlayer, squad: MatchPlayer[]) {
  const base = basePosition(player.inPossession?.position ?? player.position)
  if (!base) return undefined
  const current = roleFit(player, player.inPossession?.role)?.score ?? 0
  return squad
    .filter(isAvailableSubstitute)
    .filter((candidate) => (candidate.positionFamiliarities?.[base] ?? 0) >= 13)
    .map((candidate) => ({ player: candidate, fit: roleFit(candidate, player.inPossession?.role) }))
    .filter((item) => item.fit == null || item.fit.score >= current - 0.5)
    .sort((a, b) => (b.fit?.score ?? 0) - (a.fit?.score ?? 0))[0]
}

export function instructionTagLabel(tag: PlayerInstructionTag) {
  return playerInstructionLabels[tag]
}
