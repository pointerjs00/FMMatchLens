import type { MatchPlayer, MatchSnapshot, TeamSide } from "@/types/match"
import { minutesPlayed, opposite, type TeamWindowMetrics } from "@/features/analysis/metrics"
import { attribute, playerLabel, slotLabel } from "@/features/analysis/roles"
import { dec, instructionSetting, pct } from "@/features/analysis/engine"
import {
  instructionsForSlot,
  playerInstructionLabels,
  type PlayerInstructionTag,
  type TacticProfile,
} from "@/features/analysis/tacticProfile"
import { teamPerformance, type TeamPerformance } from "@/features/analysis/playerImpact"

/**
 * What the opponent gives away: its players who are having a bad game, attribute match-ups our players
 * win, and team habits (block height, where it loses the ball) that call for a change in our tactic.
 *
 * Attributes are on the 1–20 scale the game shows. The opponent's right side faces our left side.
 */

export type Exploit = {
  id: string
  tone: "good" | "warning" | "info"
  title: string
  detail: string
  evidence: string[]
  actions: string[]
  /** Higher first. */
  weight: number
  ourPlayerIds: number[]
  theirPlayerIds: number[]
}

export type OpponentReport = {
  performance: TeamPerformance
  exploits: Exploit[]
  tendencies: Exploit[]
}

/** Height of the defensive actions (% of the pitch): p25 of the calibration matches. */
const lowBlockHeight = 25
/** A gap of 3 points (on 1–20) between two players is clearly visible in the match engine. */
const clearGap = 3

const a = (player: MatchPlayer, name: string) => attribute(player, name)
const mean = (...values: Array<number | undefined>) =>
  values.every((value) => value != null) ? values.reduce((sum, value) => sum! + value!, 0)! / values.length : undefined
const speed = (player: MatchPlayer) => mean(a(player, "Pace"), a(player, "Acceleration"))
const aerial = (player: MatchPlayer) => mean(a(player, "Heading"), a(player, "Jumping Reach"))
const dribbling = (player: MatchPlayer) => mean(a(player, "Dribbling"), a(player, "Agility"))
const oneOnOneDefending = (player: MatchPlayer) => mean(a(player, "Tackling"), a(player, "Agility"))
const onBall = (player: MatchPlayer) => mean(a(player, "Passing"), a(player, "Composure"))

/** Their defenders, by the side of the pitch they defend (their out-of-possession slot). */
function defenderZone(player: MatchPlayer): "left" | "right" | "centre" | undefined {
  const slot = (player.outOfPossession?.position ?? player.inPossession?.position ?? player.position ?? "").toUpperCase()
  if (slot === "DL" || slot === "WBL") return "left"
  if (slot === "DR" || slot === "WBR") return "right"
  if (slot.startsWith("DC")) return "centre"
  return undefined
}

/** Our attacking players in the zone facing a defender. Their left side faces our right side. */
function attackersFacing(zone: "left" | "right" | "centre", ours: MatchPlayer[]) {
  const slots =
    zone === "left"
      ? ["AMR", "MR", "WBR", "STR"]
      : zone === "right"
        ? ["AML", "ML", "WBL", "STL"]
        : ["ST", "STC", "STL", "STR", "AMC", "AMCL", "AMCR"]
  return ours.filter((player) => slots.includes((player.inPossession?.position ?? "").toUpperCase()))
}

/** Our corridor (as we attack) where a defender of the given zone plays: "corredor direito". */
const ourFlank = { left: "direito", right: "esquerdo", centre: "central" } as const
const progressValue = { left: "right", right: "left", centre: "middle" } as const

function tagAction(profile: TacticProfile, player: MatchPlayer, tag: PlayerInstructionTag) {
  const has = instructionsForSlot(profile, player.inPossession?.position).includes(tag)
  return has
    ? `${playerLabel(player)} já tem "${playerInstructionLabels[tag]}": mantém.`
    : `Dar "${playerInstructionLabels[tag]}" a ${playerLabel(player)}.`
}

function teamAction(profile: TacticProfile, id: Parameters<typeof instructionSetting>[0], value: string) {
  return profile.team[id] === value ? `Já tens ${instructionSetting(id, value)}: mantém.` : `Mudar ${instructionSetting(id, value)}.`
}

export function opponentReport(
  match: MatchSnapshot,
  side: TeamSide,
  profile: TacticProfile,
  metrics: TeamWindowMetrics,
  opponentMetrics: TeamWindowMetrics
): OpponentReport {
  const theirSide = opposite(side)
  const ours = match.players.filter((player) => player.team === side && player.isOnPitch)
  const theirs = match.players.filter((player) => player.team === theirSide && player.isOnPitch)
  const performance = teamPerformance(match, theirSide)
  const exploits: Exploit[] = []
  const minute = match.clock.minute
  // A deep block leaves no room behind (see opponentTendencies for the threshold).
  const lowBlock = minute >= 15 && opponentMetrics.defensiveActionHeight != null && opponentMetrics.defensiveActionHeight <= lowBlockHeight

  for (const defender of theirs) {
    const zone = defenderZone(defender)
    if (!zone) continue
    const facing = attackersFacing(zone, ours)
    const name = playerLabel(defender)
    const where = `${slotLabel(defender.outOfPossession?.position ?? defender.inPossession?.position)} (${zone === "centre" ? "ao centro" : `no teu corredor ${ourFlank[zone]}`})`

    // Pace: runs in behind.
    const theirSpeed = speed(defender)
    for (const attacker of facing) {
      const ourSpeed = speed(attacker)
      if (ourSpeed == null || theirSpeed == null || ourSpeed < 14 || ourSpeed - theirSpeed < clearGap) continue
      exploits.push({
        id: `pace.${attacker.id}.${defender.id}`,
        tone: "good",
        title: `${playerLabel(attacker)} é bem mais rápido do que ${name}`,
        detail: lowBlock
          ? `${name} joga como ${where} e perde em velocidade. Com o adversário tão recuado há pouco espaço nas costas: a vantagem conta sobretudo em contra-ataque.`
          : `${name} joga como ${where} e perde em velocidade: bolas nas costas dele são a forma mais direta de criar ocasiões.`,
        evidence: [
          `${playerLabel(attacker)}: Velocidade ${a(attacker, "Pace")}, Aceleração ${a(attacker, "Acceleration")}`,
          `${name}: Velocidade ${a(defender, "Pace")}, Aceleração ${a(defender, "Acceleration")}`,
        ],
        actions: lowBlock
          ? [teamAction(profile, "attackingTransition", "counter"), tagAction(profile, attacker, "moreForwardRuns")]
          : [teamAction(profile, "passReception", "space"), tagAction(profile, attacker, "moreForwardRuns")],
        weight: (lowBlock ? 3 : 6) + (ourSpeed - theirSpeed),
        ourPlayerIds: [attacker.id],
        theirPlayerIds: [defender.id],
      })
    }

    // Dribbling against a weak one-on-one defender (wide defenders only: centre-backs are covered).
    const theirDuel = oneOnOneDefending(defender)
    if (zone !== "centre") {
      for (const attacker of facing) {
        const ourDribble = dribbling(attacker)
        // The defender's tackling alone must also be clearly below the attacker's dribbling.
        const tacklingGap = (a(attacker, "Dribbling") ?? 0) - (a(defender, "Tackling") ?? 20)
        if (ourDribble == null || theirDuel == null || ourDribble < 14 || ourDribble - theirDuel < clearGap || tacklingGap < 2) continue
        exploits.push({
          id: `dribble.${attacker.id}.${defender.id}`,
          tone: "good",
          title: `${playerLabel(attacker)} ganha o 1x1 contra ${name}`,
          detail: `No corredor ${ourFlank[zone]}, ${playerLabel(attacker)} tem muito mais drible e agilidade do que ${name}: no 1x1 deve passar.`,
          evidence: [
            `${playerLabel(attacker)}: Drible ${a(attacker, "Dribbling")}, Agilidade ${a(attacker, "Agility")}`,
            `${name}: Desarme ${a(defender, "Tackling")}, Agilidade ${a(defender, "Agility")}`,
          ],
          actions: [tagAction(profile, attacker, "dribbleMore"), teamAction(profile, "progressThrough", progressValue[zone])],
          weight: 5 + (ourDribble - theirDuel),
          ourPlayerIds: [attacker.id],
          theirPlayerIds: [defender.id],
        })
      }
    }

    // Concentration / positioning: loses runners.
    const concentration = a(defender, "Concentration")
    const positioning = a(defender, "Positioning")
    if ((concentration != null && concentration <= 8) || (positioning != null && positioning <= 8)) {
      const runners = facing.filter((attacker) => (a(attacker, "Off The Ball") ?? 0) >= 13)
      if (runners.length) {
        exploits.push({
          id: `marking.${defender.id}`,
          tone: "good",
          title: `${name} perde as marcações`,
          detail: `${name} (${where}) tem pouca concentração ou posicionamento: desmarcações para as costas dele resultam.`,
          evidence: [
            `${name}: Concentração ${concentration ?? "?"}, Posicionamento ${positioning ?? "?"}`,
            ...runners.map((runner) => `${playerLabel(runner)}: Sem bola ${a(runner, "Off The Ball")}`),
          ],
          actions: runners.map((runner) => tagAction(profile, runner, "moreForwardRuns")),
          weight: 4 + (9 - Math.min(concentration ?? 20, positioning ?? 20)),
          ourPlayerIds: runners.map((runner) => runner.id),
          theirPlayerIds: [defender.id],
        })
      }
    }

    // Booked defender: dribbling at him invites a foul he cannot make.
    const booked = match.events.some((event) => event.type === "yellow_card" && event.playerId === defender.id)
    if (booked) {
      const dribbler = facing
        .filter((attacker) => (a(attacker, "Dribbling") ?? 0) >= 12)
        .sort((x, y) => (a(y, "Dribbling") ?? 0) - (a(x, "Dribbling") ?? 0))[0]
      exploits.push({
        id: `booked.${defender.id}`,
        tone: "good",
        title: `${name} está amarelado`,
        detail: `Um defesa amarelado tem de medir cada entrada. Atacar o corredor ${ourFlank[zone]} em 1x1 obriga-o a escolher entre deixar passar e arriscar a expulsão.`,
        evidence: [`${name}: ${where}, Desarme ${a(defender, "Tackling") ?? "?"}, Agressividade ${a(defender, "Aggression") ?? "?"}`],
        actions: dribbler
          ? [tagAction(profile, dribbler, "dribbleMore"), teamAction(profile, "progressThrough", progressValue[zone])]
          : [teamAction(profile, "progressThrough", progressValue[zone])],
        weight: 7,
        ourPlayerIds: dribbler ? [dribbler.id] : [],
        theirPlayerIds: [defender.id],
      })
    }

    // Tired defender late in the game.
    const condition = defender.stats.overallPhysicalCondition
    if (minute >= 55 && condition != null && condition > 0 && condition < 70) {
      exploits.push({
        id: `tired.${defender.id}`,
        tone: "good",
        title: `${name} está cansado`,
        detail: `Com ${Math.round(condition)}% de condição física, ${name} perde velocidade e concentração. Um jogador fresco e rápido no corredor ${ourFlank[zone]} tira partido disso.`,
        evidence: [`${name}: ${where}, ${Math.round(condition)}% de condição`],
        actions: [teamAction(profile, "progressThrough", progressValue[zone])],
        weight: 5 + (70 - condition) / 5,
        ourPlayerIds: [],
        theirPlayerIds: [defender.id],
      })
    }
  }

  // Aerial duels: our strikers against their centre-backs.
  const strikers = ours.filter((player) => (player.inPossession?.position ?? "").toUpperCase().startsWith("ST"))
  const centreBacks = theirs.filter((player) => defenderZone(player) === "centre")
  const cbAerial = centreBacks.map((player) => ({ player, value: aerial(player) })).filter((item) => item.value != null)
  if (strikers.length && cbAerial.length) {
    const bestCb = cbAerial.sort((x, y) => y.value! - x.value!)[0]
    const bestSt = strikers.map((player) => ({ player, value: aerial(player) })).filter((item) => item.value != null).sort((x, y) => y.value! - x.value!)[0]
    if (bestSt && bestSt.value! - bestCb.value! >= clearGap) {
      exploits.push({
        id: `aerial.${bestSt.player.id}`,
        tone: "good",
        title: `${playerLabel(bestSt.player)} ganha no ar aos centrais`,
        detail: "Os centrais adversários são fracos no jogo aéreo; cruzamentos para o avançado têm boa probabilidade de dar remate.",
        evidence: [
          `${playerLabel(bestSt.player)}: Cabeceamento ${a(bestSt.player, "Heading")}, Impulsão ${a(bestSt.player, "Jumping Reach")}`,
          ...centreBacks.map((cb) => `${playerLabel(cb)}: Cabeceamento ${a(cb, "Heading")}, Impulsão ${a(cb, "Jumping Reach")}`),
        ],
        actions: [teamAction(profile, "crossingStyle", "floated")],
        weight: 5 + (bestSt.value! - bestCb.value!),
        ourPlayerIds: [bestSt.player.id],
        theirPlayerIds: centreBacks.map((cb) => cb.id),
      })
    } else if (bestSt && bestCb.value! - bestSt.value! >= clearGap) {
      const crossers = ours.filter((player) => instructionsForSlot(profile, player.inPossession?.position).includes("crossToTargetForward"))
      exploits.push({
        id: `aerial-against.${bestCb.player.id}`,
        tone: "warning",
        title: `${playerLabel(bestCb.player)} domina o jogo aéreo`,
        detail: `Cruzamentos altos para a área acabam quase sempre na cabeça de ${playerLabel(bestCb.player)}. ${metrics.crossesAttempted ? `Até agora: ${metrics.crossesCompleted} de ${metrics.crossesAttempted} cruzamentos certos.` : ""}`.trim(),
        evidence: [
          `${playerLabel(bestCb.player)}: Cabeceamento ${a(bestCb.player, "Heading")}, Impulsão ${a(bestCb.player, "Jumping Reach")}, Força ${a(bestCb.player, "Strength") ?? "?"}`,
          `${playerLabel(bestSt.player)}: Cabeceamento ${a(bestSt.player, "Heading")}, Impulsão ${a(bestSt.player, "Jumping Reach")}`,
        ],
        actions: [
          teamAction(profile, "crossingStyle", "low"),
          ...crossers.map((player) => `Tirar "${playerInstructionLabels.crossToTargetForward}" a ${playerLabel(player)}.`),
        ],
        weight: 4 + (bestCb.value! - bestSt.value!) + (metrics.crossesAttempted >= 8 ? 2 : 0),
        ourPlayerIds: [bestSt.player.id, ...crossers.map((player) => player.id)],
        theirPlayerIds: [bestCb.player.id],
      })
    }
  }

  // Weak passers at the back: pressing targets.
  const pressTargets = theirs.filter((player) => {
    const slot = (player.inPossession?.position ?? "").toUpperCase()
    const deep = slot === "GK" || slot.startsWith("DC") || slot.startsWith("DM") || defenderZone(player) != null
    const value = onBall(player)
    return deep && value != null && value <= 10
  })
  if (pressTargets.length) {
    exploits.push({
      id: "press.targets",
      tone: "good",
      title: "Saída de bola adversária frágil",
      detail: "Estes jogadores têm pouco passe e pouca compostura; pressionados, perdem a bola perto da baliza deles.",
      evidence: pressTargets.map((player) => `${playerLabel(player)} (${slotLabel(player.inPossession?.position)}): Passe ${a(player, "Passing")}, Compostura ${a(player, "Composure")}`),
      actions: [
        teamAction(profile, "lineOfEngagement", "highPress"),
        pressTargets.some((player) => player.inPossession?.position === "GK") ? teamAction(profile, "shortGkDistribution", "yes") : "",
      ].filter(Boolean),
      weight: 3 + pressTargets.length,
      ourPlayerIds: [],
      theirPlayerIds: pressTargets.map((player) => player.id),
    })
  }

  // Their players having a bad game in defensive positions: attack that side.
  for (const player of performance.worst) {
    const source = theirs.find((candidate) => candidate.id === player.id)
    const zone = source ? defenderZone(source) : undefined
    if (!source || zone == null || zone === "centre" || player.rating == null || player.rating > 6.5) continue
    if (minutesPlayed(source, minute) < 30) continue
    exploits.push({
      id: `poor.${player.id}`,
      tone: "info",
      title: `${player.name} está a fazer um mau jogo`,
      detail: `${player.name} (${player.slotLabel}) tem nota ${dec(player.rating, 1)}. Insistir pelo corredor ${ourFlank[zone]} põe-no à prova mais vezes.`,
      evidence: player.reasons.filter((reason) => reason.tone === "bad").slice(0, 2).map((reason) => reason.text),
      actions: [teamAction(profile, "progressThrough", progressValue[zone])],
      weight: 3 + (6.5 - player.rating) * 4,
      ourPlayerIds: [],
      theirPlayerIds: [player.id],
    })
  }

  return {
    performance,
    exploits: exploits.sort((x, y) => y.weight - x.weight),
    tendencies: opponentTendencies(match, profile, metrics, opponentMetrics),
  }
}

/**
 * Team habits. Thresholds from the 18 team performances of the calibration matches:
 * height of defensive actions p25 24% / median 31% / p75 36%; losses in the own third per 90 p75 32;
 * shots per completed pass into the final third p25 0,067 / median 0,096.
 */
function opponentTendencies(
  match: MatchSnapshot,
  profile: TacticProfile,
  metrics: TeamWindowMetrics,
  opponent: TeamWindowMetrics
): Exploit[] {
  const out: Exploit[] = []
  const minutes = Math.max(1, match.clock.minute)
  if (minutes < 15) return out
  const team = profile.team
  const height = opponent.defensiveActionHeight
  if (height != null && height <= lowBlockHeight) {
    const narrow = team.attackingWidth === "muchNarrower" || team.attackingWidth === "narrower"
    const shotRate = metrics.finalThirdPassesCompleted > 0 ? metrics.shots / metrics.finalThirdPassesCompleted : undefined
    out.push({
      id: "tendency.low-block",
      tone: "info",
      title: "O adversário defende muito baixo",
      detail:
        `A altura média das ações defensivas dele é ${Math.round(height)}% (o normal ronda 31%). Não há espaço nas costas: o espaço está nas alas e à entrada da área.` +
        (shotRate != null && metrics.finalThirdPassesCompleted >= 30
          ? ` Chegaste ao último terço ${metrics.finalThirdPassesCompleted} vezes e fizeste ${metrics.shots} remates (${dec(shotRate * 10, 1)} por cada 10 passes; normal ${dec(0.96, 1)}).`
          : ""),
      evidence: [
        `Ações ofensivas: ${pct(metrics.attackLaneShare.left)} esq. · ${pct(metrics.attackLaneShare.centre)} centro · ${pct(metrics.attackLaneShare.right)} dir.`,
        `Agora: ${instructionSetting("attackingWidth", team.attackingWidth)}`,
      ],
      actions: [
        narrow ? `Esticar o bloco: ${instructionSetting("attackingWidth", team.attackingWidth === "muchNarrower" ? "narrower" : "balanced")}.` : "",
        team.passReception === "space" ? `Com o adversário encostado à área há pouco espaço para desmarcações: ${instructionSetting("passReception", "balanced")}.` : "",
      ].filter(Boolean),
      weight: 5,
      ourPlayerIds: [],
      theirPlayerIds: [],
    })
  } else if (height != null && height >= 36) {
    out.push({
      id: "tendency.high-line",
      tone: "info",
      title: "O adversário defende alto",
      detail: `A altura média das ações defensivas dele é ${Math.round(height)}% (o normal ronda 31%): há espaço nas costas da defesa.`,
      evidence: [],
      actions: [teamAction(profile, "passReception", "space")],
      weight: 4,
      ourPlayerIds: [],
      theirPlayerIds: [],
    })
  }
  const ownThird = (opponent.possessionLostByThird.defensive * 90) / minutes
  if (ownThird >= 32 && opponent.possessionLostByThird.defensive >= 10) {
    out.push({
      id: "tendency.loses-ball-deep",
      tone: "good",
      title: "Perde muitas bolas perto da própria baliza",
      detail: `${opponent.possessionLostByThird.defensive} perdas no terço defensivo dele (normal até ~22 por 90'). A tua pressão está a resultar.`,
      evidence: [`${metrics.highRegains} recuperações tuas no último terço`],
      actions: [teamAction(profile, "lineOfEngagement", "highPress"), teamAction(profile, "triggerPress", "moreOften")],
      weight: 4,
      ourPlayerIds: [],
      theirPlayerIds: [],
    })
  }
  if (opponent.shots >= 4) {
    const lanes = opponent.attackLaneShare
    const [lane, share] = (Object.entries(lanes) as Array<[keyof typeof lanes, number]>).sort((x, y) => y[1] - x[1])[0]
    if (lane !== "centre" && share >= 0.42) {
      // Their left attacks our right.
      out.push({
        id: "tendency.attack-flank",
        tone: "warning",
        title: `Ataca sobretudo pelo teu lado ${lane === "left" ? "direito" : "esquerdo"}`,
        detail: `${pct(share)} das ações ofensivas dele são por esse corredor.`,
        evidence: [`${opponent.shots} remates, ${dec(opponent.xg)} xG`],
        actions: [`Reforçar esse lado: dar "${playerInstructionLabels.fewerForwardRuns}" ao lateral ${lane === "left" ? "direito" : "esquerdo"}.`],
        weight: 3 + share * 4,
        ourPlayerIds: [],
        theirPlayerIds: [],
      })
    }
  }
  return out.sort((x, y) => y.weight - x.weight)
}
