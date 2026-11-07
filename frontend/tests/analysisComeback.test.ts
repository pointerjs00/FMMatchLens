import { describe, expect, it } from "vitest"
import type { MatchPlayer, MatchSnapshot, PlayerStats, TeamSide } from "@/types/match"
import { analyseMatch, fullMatchWindow } from "@/features/analysis/engine"
import { comebackPlan } from "@/features/analysis/gamePlan"
import { opponentReport } from "@/features/analysis/opponent"
import { playerImpact, positionGroup, teamPerformance } from "@/features/analysis/playerImpact"
import { defaultTacticProfile } from "@/features/analysis/tacticProfile"

/** Attributes as the game shows them (1–20); stored ×5 like the plugin does. */
function player(
  id: number,
  team: TeamSide,
  slot: string,
  shown: Record<string, number>,
  options: { rating?: number; stats?: Partial<PlayerStats>; bench?: boolean; role?: string; familiarities?: Record<string, number> } = {}
): MatchPlayer {
  const scaled = Object.fromEntries(Object.entries(shown).map(([key, value]) => [key, value * 5]))
  return {
    id,
    name: `P${id}`,
    team,
    position: slot,
    isStarter: !options.bench,
    isOnPitch: !options.bench,
    rating: options.rating,
    inPossession: { position: slot, role: options.role },
    outOfPossession: { position: slot },
    positionFamiliarities: options.familiarities,
    attributes: { technical: scaled, mental: {}, physical: {}, goalkeeping: {}, traits: "0" },
    stats: { goals: 0, assists: 0, ...options.stats },
  } as unknown as MatchPlayer
}

function match(minute: number, score: { home: number; away: number }, players: MatchPlayer[], extra: Partial<MatchSnapshot> = {}) {
  return {
    matchId: "match-1",
    clock: { minute, second: 0, elapsedMinute: minute, elapsedSecond: 0, elapsedTick: minute * 240 },
    period: minute > 45 ? 2 : 1,
    score,
    home: { name: "Benfica", manager: { isHumanControlled: true }, stats: {} },
    away: { name: "Nacional", stats: {} },
    players,
    events: [],
    xgTimeline: [],
    heatmaps: {},
    tacticalEvents: [],
    xgShots: [],
    momentum: [],
    rollingMomentum: [],
    ...extra,
  } as unknown as MatchSnapshot
}

describe("player performance", () => {
  it("groups positions like the calibration table", () => {
    expect(["GK", "DCL", "DR", "DMC", "MCR", "AML", "AMC", "ST"].map(positionGroup)).toEqual(["GK", "CB", "FB", "DM", "CM", "W", "AM", "ST"])
  })

  it("explains a performance with the numbers that stand out for the position", () => {
    const winger = player(1, "home", "AMR", {}, { rating: 6.3, stats: { possessionLost: 12, passes: 25, passesCompleted: 16, crosses: 5, crossesCompleted: 0 } })
    const impact = playerImpact(match(48, { home: 0, away: 1 }, [winger]), winger, [winger])
    const texts = impact.reasons.map((reason) => reason.text)
    expect(texts).toContain("5 cruzamentos, nenhum certo.")
    expect(texts.some((text) => text.startsWith("Perdeu 12 bolas"))).toBe(true)
    expect(texts.some((text) => text.startsWith("Sem remates nem passes para remate em 48 minutos"))).toBe(true)
    expect(impact.reasons.every((reason) => reason.tone === "bad")).toBe(true)
  })

  it("ranks by the game's rating and leaves out players with too few minutes", () => {
    const players = [
      player(1, "home", "DCR", {}, { rating: 7.2 }),
      player(2, "home", "DCL", {}, { rating: 6.9 }),
      player(3, "home", "MCL", {}, { rating: 6.7 }),
      player(4, "home", "ST", {}, { rating: 6.2 }),
    ]
    const { best, worst } = teamPerformance(match(40, { home: 0, away: 0 }, players), "home", 1)
    expect(best.map((item) => item.id)).toEqual([1])
    expect(worst.map((item) => item.id)).toEqual([4])
    expect(teamPerformance(match(10, { home: 0, away: 0 }, players), "home").best).toEqual([])
  })
})

describe("opponent weaknesses", () => {
  it("finds pace and one-on-one mismatches on the mirrored flank", () => {
    // Their right-back faces our left winger; their centre-back faces our striker.
    const ours = [
      player(1, "home", "AML", { Dribbling: 17, Agility: 17, Pace: 13, Acceleration: 13 }),
      player(2, "home", "ST", { Pace: 16, Acceleration: 15, Heading: 12, "Jumping Reach": 12 }),
    ]
    const theirs = [
      player(11, "away", "DR", { Tackling: 12, Agility: 12, Pace: 14, Acceleration: 14, Concentration: 12, Positioning: 12 }),
      player(12, "away", "DCL", { Pace: 11, Acceleration: 10, Heading: 16, "Jumping Reach": 16, Concentration: 13, Positioning: 13 }),
    ]
    const snapshot = match(30, { home: 0, away: 1 }, [...ours, ...theirs])
    const analysis = analyseMatch(snapshot, defaultTacticProfile, { window: fullMatchWindow(snapshot) })
    const report = opponentReport(snapshot, "home", defaultTacticProfile, analysis.metrics, analysis.opponent)
    const ids = report.exploits.map((exploit) => exploit.id)
    expect(ids).toContain("dribble.1.11")
    expect(ids).toContain("pace.2.12")
    expect(ids).toContain("aerial-against.12")
    const dribble = report.exploits.find((exploit) => exploit.id === "dribble.1.11")!
    expect(dribble.detail).toContain("corredor esquerdo")
    expect(dribble.actions).toContain("Mudar Avançar por: Esquerda.")
  })

  it("does not call a strong tackler beatable because of low agility", () => {
    const ours = [player(1, "home", "AML", { Dribbling: 17, Agility: 17 })]
    const theirs = [player(11, "away", "DR", { Tackling: 17, Agility: 10 })]
    const snapshot = match(30, { home: 0, away: 0 }, [...ours, ...theirs])
    const analysis = analyseMatch(snapshot, defaultTacticProfile, { window: fullMatchWindow(snapshot) })
    const report = opponentReport(snapshot, "home", defaultTacticProfile, analysis.metrics, analysis.opponent)
    expect(report.exploits.some((exploit) => exploit.id.startsWith("dribble."))).toBe(false)
  })
})

describe("comeback plan", () => {
  const squad = () => [
    player(1, "home", "AMR", { Dribbling: 14 }, { rating: 6.2, role: "Winger", stats: { possessionLost: 12 } }),
    player(2, "home", "DCR", {}, { rating: 7.1 }),
    player(3, "home", "AMR", { Dribbling: 16, Crossing: 15, Pace: 16, Acceleration: 16 }, { bench: true, role: "Winger", familiarities: { AMR: 18 } }),
    player(11, "away", "DL", {}, { rating: 6.8 }),
  ]

  it("only appears when losing", () => {
    const snapshot = match(46, { home: 1, away: 1 }, squad())
    const analysis = analyseMatch(snapshot, defaultTacticProfile, { window: fullMatchWindow(snapshot) })
    const opponent = opponentReport(snapshot, "home", defaultTacticProfile, analysis.metrics, analysis.opponent)
    expect(comebackPlan(snapshot, defaultTacticProfile, analysis, opponent, teamPerformance(snapshot, "home"))).toBeUndefined()
  })

  it("at half-time names the risk step, the goal conceded and a substitution", () => {
    const snapshot = match(45, { home: 0, away: 1 }, squad(), {
      xgShots: [{ id: "s", eventIndex: 1, team: "away", playerId: 11, tick: 1, displayTick: 1, minute: 44, x: 0, y: 0, xg: 0.02, metricId: "goals" }],
    } as Partial<MatchSnapshot>)
    const analysis = analyseMatch(snapshot, defaultTacticProfile, { window: fullMatchWindow(snapshot) })
    const opponent = opponentReport(snapshot, "home", defaultTacticProfile, analysis.metrics, analysis.opponent)
    const plan = comebackPlan(snapshot, defaultTacticProfile, analysis, opponent, teamPerformance(snapshot, "home"))!
    expect(plan.title).toBe("A perder 0-1 ao intervalo: plano para dar a volta")
    expect(plan.steps.find((step) => step.id === "reading")?.evidence).toContain("Golo sofrido aos 44' (P11): remate de 0,02 xG")
    expect(plan.steps.find((step) => step.id === "risk")?.actions).toEqual(["Mentalidade: Positiva → Atacar."])
    const players = plan.steps.find((step) => step.id === "players")
    expect(players?.actions[0]).toMatch(/^Ao intervalo: P1 \(MO \(D\)\) → P3\./)
  })

  it("raises the mentality two levels in the last ten minutes", () => {
    const snapshot = match(82, { home: 0, away: 1 }, squad())
    const analysis = analyseMatch(snapshot, defaultTacticProfile, { window: fullMatchWindow(snapshot) })
    const opponent = opponentReport(snapshot, "home", defaultTacticProfile, analysis.metrics, analysis.opponent)
    const plan = comebackPlan(snapshot, defaultTacticProfile, analysis, opponent, teamPerformance(snapshot, "home"))!
    expect(plan.steps.find((step) => step.id === "risk")?.actions[0]).toBe("Mentalidade: Positiva → Muito Atacante.")
  })
})
