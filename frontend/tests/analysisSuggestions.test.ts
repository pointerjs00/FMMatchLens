import { describe, expect, it } from "vitest"
import type { HeatmapGrid, MatchPlayer, MatchSnapshot, TacticalEventPoint, TeamSide } from "@/types/match"
import { duelBalance, fieldMatchups } from "@/features/analysis/matchups"
import {
  changesMade,
  consolidateSuggestions,
  pendingChanges,
  followedSuggestions,
  parseSuggestion,
  ruleEffects,
  suggestionsAt,
  watchedAt,
  type Suggestion,
  type SuggestionLog,
} from "@/features/analysis/suggestions"
import type { TacticMoment } from "@/features/analysis/tacticChanges"
import { defaultTacticProfile } from "@/features/analysis/tacticProfile"

function player(id: number, team: TeamSide, slot: string, name = `P${id}`): MatchPlayer {
  return {
    id,
    name,
    team,
    position: slot,
    isStarter: true,
    isOnPitch: true,
    inPossession: { position: slot },
    outOfPossession: { position: slot },
    stats: { goals: 0, assists: 0 },
  } as unknown as MatchPlayer
}

function snapshot(players: MatchPlayer[], extra: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return {
    matchId: "m",
    clock: { minute: 40, second: 0, elapsedMinute: 40, elapsedSecond: 0, elapsedTick: 9600 },
    period: 1,
    score: { home: 0, away: 1 },
    home: { name: "Benfica", manager: { isHumanControlled: true }, stats: {} },
    away: { name: "Nacional", stats: {} },
    players,
    events: [],
    xgTimeline: [],
    heatmaps: { grids: new Map(), revision: 0 },
    tacticalEvents: [],
    xgShots: [],
    momentum: [],
    rollingMomentum: [],
    ...extra,
  } as unknown as MatchSnapshot
}

describe("reading the panel's suggestions back", () => {
  const squad = [player(1, "home", "AMR", "Schjelderup"), player(2, "home", "AMR", "Rafa")]
  const match = snapshot(squad)

  it("reads team instructions, mentality, individual instructions and substitutions", () => {
    expect(parseSuggestion("Abrir o campo um nível: Largura Atacante: Compacto.", match, "home")).toEqual([
      { kind: "team", id: "attackingWidth", value: "narrower" },
    ])
    expect(parseSuggestion("Mudar Largura Atacante: Mais Compacto.", match, "home")).toEqual([
      { kind: "team", id: "attackingWidth", value: "muchNarrower" },
    ])
    expect(parseSuggestion("Mentalidade: Positiva → Atacar.", match, "home")).toEqual([{ kind: "mentality", value: "attacking" }])
    expect(parseSuggestion("Mantém Positiva por agora. Se aos 60–65' continuar igual, sobe para Atacar.", match, "home")).toEqual([])
    expect(parseSuggestion('Tirar "Correr menos riscos no passe" a Schjelderup (Visão 16, Passe 15): a perder…', match, "home")).toEqual([
      { kind: "player", tag: "lessRisk", add: false, playerId: 1 },
    ])
    expect(parseSuggestion("Ao intervalo: Schjelderup (MO (D)) → Rafa. Nota 6,4.", match, "home")).toEqual([
      { kind: "sub", offId: 1, onId: 2 },
    ])
  })

  it("ignores advice to keep things as they are", () => {
    expect(parseSuggestion("Já tens Linha de pressão: Pressão alta: mantém.", match, "home")).toEqual([])
    expect(parseSuggestion('Schjelderup já tem "Fintar mais": mantém.', match, "home")).toEqual([])
  })
})

describe("matching recorded changes with suggestions", () => {
  const squad = [player(1, "home", "AMR", "Schjelderup")]
  const match = snapshot(squad)
  const suggestion = (ruleId: string, action: string): Suggestion => ({
    ruleId,
    ruleTitle: ruleId,
    action,
    changes: parseSuggestion(action, match, "home"),
  })

  it("credits a change that does what was suggested, and only that rule", () => {
    const moment: TacticMoment = {
      minute: 14,
      madeMinute: 14,
      pending: false,
      lines: [],
      profileBefore: { ...defaultTacticProfile, team: { ...defaultTacticProfile.team, attackingWidth: "narrower" } },
      profileAfter: { ...defaultTacticProfile, team: { ...defaultTacticProfile.team, attackingWidth: "balanced" } },
      changes: [],
    }
    const made = changesMade(moment, match, "home")
    expect(made).toEqual([{ kind: "team", id: "attackingWidth", value: "balanced" }])
    const followed = followedSuggestions(moment, made, [
      suggestion("attack.sterile-possession", "Abrir o campo um nível: Largura Atacante: Normal."),
      suggestion("tactic.high-line-slow-cbs", "Contra adversários rápidos, Linha Defensiva: Normal."),
    ])
    expect(followed.map((item) => item.ruleId)).toEqual(["attack.sterile-possession"])
  })

  it("takes the net effect of several clicks on one player's instruction", () => {
    const click = (sequence: number, from: string, to: string) => ({
      sequence,
      kind: "playerInstruction" as const,
      source: "ui" as const,
      capturedUnixMilliseconds: 0,
      tick: 10_000 + sequence,
      displayTick: 10_000 + sequence,
      playerName: "Andreas Schjelderup",
      uiKey: "pi_in_possession-passing-risk",
      fromLabel: from,
      toLabel: to,
    })
    const moment: TacticMoment = {
      minute: 44,
      madeMinute: 44,
      pending: false,
      lines: [],
      changes: [
        click(1, "Correr Menos Riscos", "Correr Mais Riscos"),
        click(2, "Correr Mais Riscos", "Correr Menos Riscos"),
        click(3, "Correr Menos Riscos", "Padrão"),
      ],
    }
    expect(changesMade(moment, match, "home")).toEqual([{ kind: "player", tag: "lessRisk", add: false, playerId: 1 }])
  })

  it("accepts a bigger step in the suggested direction of the mentality", () => {
    const moment: TacticMoment = {
      minute: 70,
      madeMinute: 70,
      pending: false,
      lines: [],
      profileBefore: defaultTacticProfile,
      profileAfter: { ...defaultTacticProfile, mentality: "veryAttacking" },
    }
    const followed = followedSuggestions(moment, changesMade(moment, match, "home"), [
      suggestion("plan.risk", "Mentalidade: Positiva → Atacar."),
    ])
    expect(followed).toHaveLength(1)
  })

  it("knows when the panel was open and what it showed", () => {
    const log: SuggestionLog = {
      minutes: [40, 41, 42],
      entries: [{ ...suggestion("plan.risk", "Mentalidade: Positiva → Atacar."), firstMinute: 41, lastMinute: 42 }],
    }
    expect(watchedAt(log, 43)).toBe(true)
    expect(watchedAt(log, 60)).toBe(false)
    expect(suggestionsAt(log, 43)).toHaveLength(1)
    expect(suggestionsAt(log, 40)).toHaveLength(0)
  })

  it("averages the effect of followed suggestions per rule, measured ones only", () => {
    const comparison = (xg: [number, number], reliable: boolean) => ({
      mode: "beforeAfter" as const,
      before: { fromMinute: 0, toMinute: 10, label: "" },
      after: { fromMinute: 11, toMinute: 30, label: "" },
      beforeMinutes: 10,
      afterMinutes: 20,
      perNinety: reliable,
      reliable,
      rows: [{ label: "xG por 90'", before: xg[0], after: xg[1], format: "dec" as const, better: 1 as const }],
    })
    const [effect] = ruleEffects([
      { ruleId: "r", ruleTitle: "R", action: "a", minute: 10, comparison: comparison([1, 2], true) },
      { ruleId: "r", ruleTitle: "R", action: "a", minute: 50, comparison: comparison([1, 1.5], true) },
      { ruleId: "r", ruleTitle: "R", action: "a", minute: 80, comparison: comparison([1, 9], false) },
    ])
    expect(effect).toMatchObject({ followed: 3, measured: 2, xgFor: 0.75 })
  })
})

describe("who faces whom on the pitch", () => {
  /** A heatmap with all the time in one zone of 5×5 cells (zone column 0–7, zone row 0–11). */
  function grid(column: number, row: number, samples = 1000): HeatmapGrid {
    const density = new Float32Array(40 * 60)
    for (let y = row * 5; y < row * 5 + 5; y += 1) for (let x = column * 5; x < column * 5 + 5; x += 1) density[y * 40 + x] = samples / 25
    return { width: 40, height: 60, density, sampleCount: samples, averageX: column * 12.5 + 6, averageY: row * 8.33 + 4 }
  }

  it("pairs players who share zones and credits the duels there", () => {
    // Home keeper at the bottom of the heatmap (y > 50): event (x, y) → heatmap (y, 100 − x).
    const keeper = player(9, "home", "GK")
    const winger = player(1, "home", "AML")
    const striker = player(2, "home", "ST")
    const fullBack = player(11, "away", "DR")
    const centreBack = player(12, "away", "DCL")
    const grids = new Map<string, HeatmapGrid>([
      ["player:9:all:full", grid(4, 11)],
      ["player:1:inPossession:full", grid(1, 3)],
      ["player:11:outOfPossession:full", grid(1, 3)],
      ["player:2:inPossession:full", grid(4, 2)],
      ["player:12:outOfPossession:full", grid(4, 2)],
    ])
    // Zone column 1, row 3 = heatmap x 12,5–25, y 25–33 → event y ≈ 18, x ≈ 71.
    const event = (id: number, playerId: number, team: TeamSide, metricId: TacticalEventPoint["metricId"]) =>
      ({ id: String(id), playerId, team, metricId, x: 71, y: 18, tick: id, displayTick: id, minute: 30, nativeEventType: 0, flags: 0 }) as TacticalEventPoint
    const match = snapshot([keeper, winger, striker, fullBack, centreBack], {
      heatmaps: { grids, revision: 1 },
      tacticalEvents: [
        event(1, 1, "home", "dribblesCompleted"),
        event(2, 1, "home", "dribblesCompleted"),
        event(3, 1, "home", "possessionLost"),
        event(4, 11, "away", "tacklesWon"),
      ],
    })
    const field = fieldMatchups(match, "home")!
    expect(field.facing(11).map((pair) => pair.attackerId)).toEqual([1])
    expect(field.facing(12).map((pair) => pair.attackerId)).toEqual([2])
    const duels = field.pair(1, 11)!.duels
    expect(duels).toMatchObject({ dribbles: 2, lost: 1, defensive: 1 })
    expect(duelBalance(duels)).toEqual({ wins: 2, losses: 1, total: 3 })
  })

  it("gives up without position data", () => {
    expect(fieldMatchups(snapshot([player(1, "home", "AML")]), "home")).toBeUndefined()
  })
})

describe("one answer per instruction", () => {
  const squad = [player(1, "home", "AMR", "Schjelderup")]
  const match = snapshot(squad)
  const suggestion = (ruleId: string, action: string, weight: number): Suggestion => ({
    ruleId,
    ruleTitle: ruleId,
    action,
    weight,
    changes: parseSuggestion(action, match, "home"),
  })

  it("merges the same change asked by several rules", () => {
    const result = consolidateSuggestions(
      [
        suggestion("attack.sterile-possession", "Abrir o campo um nível: Largura Atacante: Normal.", 275),
        suggestion("opponent.tendency", "Esticar o bloco: Largura Atacante: Normal.", 155),
      ],
      match
    )
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0].sources.map((source) => source.ruleId)).toEqual(["attack.sterile-possession", "opponent.tendency"])
    expect(result.notes.get("Esticar o bloco: Largura Atacante: Normal.")).toBe("Também sugerido por: attack.sterile-possession.")
  })

  it("keeps the strongest of two values for one instruction and of opposite individual instructions", () => {
    const result = consolidateSuggestions(
      [
        suggestion("opponent.dribble", "Mudar Avançar por: Esquerdo.", 158),
        suggestion("opponent.booked", "Mudar Avançar por: Direito.", 157),
        suggestion("opponent.duel-won", 'Dar "Fintar mais" a Schjelderup.', 160),
        suggestion("player", 'Dar "Fintar menos" a Schjelderup.', 355),
      ],
      match
    )
    expect(result.changes.map((item) => item.label)).toEqual(['Dar "Fintar menos" a Schjelderup', "Avançar por: Esquerdo"])
    expect(result.rejected.map((item) => [item.label, item.lostTo.label])).toEqual([
      ["Avançar por: Direito", "Avançar por: Esquerdo"],
      ['Dar "Fintar mais" a Schjelderup', 'Dar "Fintar menos" a Schjelderup'],
    ])
    expect(result.notes.get("Mudar Avançar por: Direito.")).toMatch(/^Em conflito com "Avançar por: Esquerdo"/)
  })

  it("losing late, caution gives way to the plan's call for risk", () => {
    const all = [
      suggestion("plan.risk", "Mentalidade: Positiva → Muito Atacante.", 400),
      suggestion("transition.exposed", "Baixar a linha um nível: Linha Defensiva: Normal.", 385),
    ]
    expect(consolidateSuggestions(all, match).changes).toHaveLength(2)
    const late = consolidateSuggestions(all, match, { chasingLate: true })
    expect(late.changes.map((item) => item.label)).toEqual(["Mentalidade: Muito Atacante"])
    expect(late.rejected[0]).toMatchObject({ label: "Linha Defensiva: Normal" })
  })
})

describe("warnings that name an option", () => {
  it("are not read as a request to choose it", () => {
    const match = snapshot([])
    expect(
      parseSuggestion('Na Distribuição do GR, o próprio jogo avisa que "Laterais" é um passe difícil para o guarda-redes; com Passe 9, vê no jogo o feedback das outras opções.', match, "home")
    ).toEqual([])
    expect(parseSuggestion("Mudar Pontapés de Baliza: Mista (menos saídas curtas a partir dos pés dele).", match, "home")).toEqual([
      { kind: "team", id: "goalKicks", value: "balanced" },
    ])
  })
})

describe("the current value competes with the suggestions", () => {
  // Seen live: one rule per flank; keeping one side made the other side's rule win, back and forth.
  const match = snapshot([])
  const rule = (ruleId: string, action: string, weight: number): Suggestion => ({
    ruleId,
    ruleTitle: ruleId,
    action,
    weight,
    changes: parseSuggestion(action.replace(/^Já tens (.+): mantém\.$/, "Mudar $1."), match, "home"),
  })
  const profileWith = (value: string) => ({ ...defaultTacticProfile, team: { ...defaultTacticProfile.team, progressThrough: value } })

  it("recommends the same side whatever is set now", () => {
    const left = (keep: boolean) => rule("opponent.dribble.left", keep ? "Já tens Avançar por: Esquerdo: mantém." : "Mudar Avançar por: Esquerdo.", 160)
    const right = (keep: boolean) => rule("opponent.dribble.right", keep ? "Já tens Avançar por: Direito: mantém." : "Mudar Avançar por: Direito.", 158)
    // Left set: keeping it (160) beats moving right (158): nothing to do.
    const leftNow = consolidateSuggestions([left(true), right(false)], match)
    expect(pendingChanges(leftNow, profileWith("left"))).toEqual([])
    expect(leftNow.rejected.map((item) => item.label)).toEqual(["Avançar por: Direito"])
    // Right set: moving left (160) beats keeping right (158).
    const rightNow = consolidateSuggestions([left(false), right(true)], match)
    expect(pendingChanges(rightNow, profileWith("right")).map((item) => item.label)).toEqual(["Avançar por: Esquerdo"])
    // Middle: left again.
    const middle = consolidateSuggestions([left(false), right(false)], match)
    expect(pendingChanges(middle, profileWith("middle")).map((item) => item.label)).toEqual(["Avançar por: Esquerdo"])
  })
})
