import { describe, expect, it } from "vitest"
import type { TacticChange } from "@/features/analysis/tacticChanges"
import { applyTacticChanges, describeTacticChange } from "@/features/analysis/tacticChanges"
import { defaultTacticProfile } from "@/features/analysis/tacticProfile"
import type { MatchPlayer } from "@/types/match"
import type { PlayerInstructionTag } from "@/features/analysis/tacticProfile"
import {
  applyObservedPlayerInstructions,
  findPlayerByGameName,
  normalizeTacticChanges,
  observedPlayerInstructions,
  observedTeamInstructions,
  profileOptionFor,
  uiInstructionOf,
} from "@/features/analysis/uiTactic"

let sequence = 0
function record(seconds: number, kind: TacticChange["kind"], extra: Partial<TacticChange> = {}): TacticChange {
  sequence += 1
  return {
    sequence,
    kind,
    capturedUnixMilliseconds: seconds * 1000,
    tick: 1000 + seconds,
    displayTick: 1000 + seconds,
    appliedTick: 1100 + seconds,
    appliedDisplayTick: 1100 + seconds,
    ...extra,
  }
}
const ui = (seconds: number, ...pairs: Array<[string, string]>) =>
  record(seconds, "uiValues", { uiValues: pairs.map(([label, icon]) => ({ label, icon })) })

const tempo = (variant: string) => `in-possession-tempo-var-${variant}`
const shooting = (variant: string) => `player-instructions-in-possession-shooting-var-${variant}`

// Shapes and texts from the session 15 log (FM27 PT, 6 Nov 2026).
const session = [
  record(0, "mentality", { mentality: 5, mentalityName: "Positiva", initial: true }),
  ui(
    80,
    ["Contra-ataque", "in-possession-overview-attacking-transition-var-hold-shape"],
    ["Mais rápido", tempo("higher")],
    ["Passar para o espaço", "team-instructions-in-possession-progression-passing-reception-var-pass-into-space"],
    ["Direito", "team-instructions-in-possession-progression-supporting-runs-var-underlap-right"]
  ),
  ui(81.1, ["Normal", tempo("standard")]),
  ui(81.3, ["Mais lento", tempo("lower")]),
  ui(81.4, ["Muito mais lento", tempo("much-lower")]),
  record(88, "teamInstruction", { instruction: 21, steps: -3 }),
  ui(90, ["Muito mais lento", tempo("much-lower")], ["Contra-ataque", "in-possession-overview-attacking-transition-var-hold-shape"]),
  ui(91, ["Mais lento", tempo("lower")]),
  ui(91.2, ["Normal", tempo("standard")]),
  ui(91.3, ["Mais rápido", tempo("higher")]),
  record(93, "teamInstruction", { instruction: 21, steps: 3 }),
  ui(101, ["Normal", "player-instructions-in-possession-forward-runs-var-standard--null-"], ["Padrão", shooting("standard--nul-")]),
  ui(102, ["Rematar Menos", shooting("shoot-less-often")]),
  record(104, "playerInstruction", { steps: -1, stepCount: 1 }),
  ui(112, ["Padrão", shooting("standard--nul-")]),
  record(114, "playerInstruction", { steps: 1, stepCount: 1 }),
  record(121, "swap"),
]

describe("instructions read from the game UI", () => {
  it("names instructions from the icon and maps the game texts to options", () => {
    expect(uiInstructionOf(tempo("much-lower"))).toMatchObject({ key: "in-possession-tempo", scope: "team", profileId: "tempo" })
    expect(uiInstructionOf(shooting("shoot-less-often"))).toMatchObject({ scope: "player", title: "Remates" })
    expect(uiInstructionOf("out-of-possession-line-of-engagement-var-high")).toMatchObject({
      scope: "team",
      title: "Line of engagement",
    })
    expect(profileOptionFor("tempo", "Normal")).toBe("balanced")
    expect(profileOptionFor("passReception", "Passar para o espaço")).toBe("space")
    expect(profileOptionFor("attackingWidth", "Mais Compacto")).toBe("muchNarrower")
    expect(profileOptionFor("attackingWidth", "Sem tradução")).toBeUndefined()
  })

  it("turns the panel and the quick-change clicks into absolute changes", () => {
    const normalized = normalizeTacticChanges(session)
    const shown = normalized.filter((change) => !change.initial).map((change) => describeTacticChange(change))
    expect(shown).toEqual([
      "Ritmo: Mais rápido → Muito mais lento",
      "Ritmo: Muito mais lento → Mais rápido",
      "Instrução individual · Remates: Padrão → Rematar Menos (jogador não identificado)",
      "Instrução individual · Remates: Rematar Menos → Padrão (jogador não identificado)",
      "Substituição ou troca de posições",
    ])
    // The starting values become the tactic in force.
    const start = { ...defaultTacticProfile, team: { ...defaultTacticProfile.team, tempo: "balanced", passReception: "balanced" } }
    const firstChange = normalized.find((change) => change.source === "ui" && !change.initial)!
    const before = applyTacticChanges(start, normalized.filter((change) => change.sequence < firstChange.sequence))
    expect(before.team.tempo).toBe("higher")
    expect(before.team.passReception).toBe("space")
    expect(applyTacticChanges(start, [...normalized.filter((change) => change.initial), firstChange]).team.tempo).toBe("muchLower")
    expect(applyTacticChanges(start, normalized).team.tempo).toBe("higher")
    expect(observedTeamInstructions(normalized).map((item) => `${item.title}: ${item.label}`)).toContain("Ritmo: Mais rápido")
  })

  it("keeps a change made in an instruction's detail menu apart from the clicks that follow it", () => {
    // Match of 7 Nov 2026: tempo picked in the detail menu (no event), seen when the panel was drawn
    // again at 13', then two quick-change clicks down to Normal.
    const at = (minute: number, seconds: number, ...pairs: Array<[string, string]>) => ({
      ...ui(seconds, ...pairs),
      displayTick: minute * 240,
    })
    const changes = normalizeTacticChanges([
      at(9, 500, ["Mais rápido", tempo("higher")], ["Contra-ataque", "in-possession-overview-attacking-transition-var-hold-shape"]),
      at(13, 700, ["Muito mais elevado", tempo("much-higher")], ["Contra-ataque", "in-possession-overview-attacking-transition-var-hold-shape"]),
      at(13, 703, ["Mais rápido", tempo("higher")]),
      at(13, 704, ["Normal", tempo("standard")]),
      { ...record(705, "teamInstruction", { instruction: 21, steps: -2 }), displayTick: 13 * 240 },
    ])
    expect(changes.filter((change) => !change.initial).map((change) => describeTacticChange(change))).toEqual([
      "Ritmo: Mais rápido → Muito mais elevado (feita entre 9' e 13')",
      "Ritmo: Muito mais elevado → Normal",
    ])
    expect(applyTacticChanges(defaultTacticProfile, changes.slice(0, 3)).team.tempo).toBe("muchHigher")
  })
})

describe("picks in an instruction's detail menu and cancelled changes", () => {
  // Test of 7 Nov 2026 (00:54–00:57): quick +1 on tempo then "cancel pending changes", then picks in the
  // detail menus of tempo (no option name), defensive line and attacking width; only tempo was drawn again.
  const width = (variant: string) => `in-possession-team-width-var-${variant}`
  const line = (variant: string) => `team-instructions-out-of-possession-overview-defensive-line-var-${variant}`
  const at = (minute: number, seconds: number, ...values: Array<[string, string, string?]>) => ({
    ...record(seconds, "uiValues", {
      uiValues: values.map(([label, icon, optionKey]) => ({ label, icon, optionKey: optionKey ?? null })),
    }),
    displayTick: minute * 240,
  })
  const changes = normalizeTacticChanges([
    at(0, 4, ["Mais rápido", tempo("higher")], ["Mais Compacto", width("much-more-narrow")]),
    { ...at(1, 8, ["Muito mais elevado", tempo("much-higher")]), cancelled: true },
    { ...record(9, "teamInstruction", { instruction: 21, steps: 1 }), displayTick: 240, cancelled: true },
    at(2, 48, ["Mais rápido", tempo("higher")], ["Mais Compacto", width("much-more-narrow")]),
    at(2, 52, ["", tempo("lower")]),
    at(3, 73, ["Mais lento", tempo("lower")], ["Mais Compacto", width("much-more-narrow")]),
    at(4, 76, ["Mais avançada", line("higher")]),
    at(4, 78, ["", line("much-higher"), "Backline Depth High"]),
    at(6, 121, ["", width("more-direct"), "Attacking Width Wide"]),
  ])

  it("ignores cancelled changes and names icon-only picks", () => {
    expect(changes.filter((change) => !change.initial).map((change) => describeTacticChange(change))).toEqual([
      "Ritmo: Mais rápido → Mais lento",
      "Linha defensiva: Mais avançada → Muito mais avançada",
      "Largura ofensiva: Mais Compacto → Largura",
    ])
    const tactic = applyTacticChanges(defaultTacticProfile, changes)
    expect([tactic.team.tempo, tactic.team.defensiveLine, tactic.team.attackingWidth]).toEqual([
      "lower",
      "muchHigher",
      "wider",
    ])
  })

  it("times a pick when it is made, not when the panel is drawn again", () => {
    const tempoChange = changes.find((change) => change.uiKey === "in-possession-tempo" && !change.initial)
    expect(tempoChange?.displayTick).toBe(2 * 240)
    expect(tempoChange?.uiSinceDisplayTick).toBeUndefined()
  })
})

describe("a player's instructions panel", () => {
  const dahl = { id: 4, name: "Dahl", fullName: "Samuel Dahl", shirtName: "Dahl", team: "home", inPossession: { position: "DL" } }
  const prestianni = { id: 11, name: "Prestianni", fullName: "Gianluca Prestianni", team: "home", inPossession: { position: "AML" } }
  const players = [dahl, prestianni] as unknown as MatchPlayer[]
  const panel = (seconds: number, name: string, ...pairs: Array<[string, string]>) => ({
    ...record(seconds, "uiValues", { uiValues: pairs.map(([label, icon]) => ({ label, icon })) }),
    playerName: name,
  })
  const frequency = (variant: string) => `player-instructions-in-possession-dribbling-frequency-var-${variant}`
  const runs = (variant: string) => `player-instructions-in-possession-forward-runs-var-${variant}`

  it("finds the player from the name shown in the panel header", () => {
    expect(findPlayerByGameName("Samuel Dahl", players)).toBe(dahl)
    expect(findPlayerByGameName("G. Prestianni", players)).toBe(prestianni)
    expect(findPlayerByGameName("Fredrik Aursnes", players)).toBeUndefined()
  })

  it("names the player of an individual instruction change", () => {
    const changes = normalizeTacticChanges([
      panel(10, "Samuel Dahl", ["Fintar Menos", frequency("less-often")], ["Normal", runs("standard--null-")]),
      panel(12, "Samuel Dahl", ["Fintar Mais", frequency("more-often")]),
    ])
    expect(changes.map((change) => describeTacticChange(change))).toEqual([
      "Instrução individual · Samuel Dahl · Frequência do drible: Fintar Menos → Fintar Mais",
    ])
  })

  it("uses the instructions read from the panel for the player's position", () => {
    const profile = { ...defaultTacticProfile, players: { DL: ["dribbleLess", "moreForwardRuns", "pressLess"] as PlayerInstructionTag[] } }
    const observed = observedPlayerInstructions([
      panel(10, "Samuel Dahl", ["Fintar Menos", frequency("less-often")], ["Normal", runs("standard--null-")]),
    ])
    // "Fazer mais arrancadas" is gone (the panel says Normal); the out-of-possession "pressLess" stays.
    expect(applyObservedPlayerInstructions(profile, observed, players).players.DL).toEqual(["dribbleLess", "pressLess"])
  })
})
