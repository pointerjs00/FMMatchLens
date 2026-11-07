import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { MatchSnapshot } from "@/types/match"
import { ChangesTab, TacticTab } from "@/features/analysis/AnalysisDrawer"
import { tacticChangesReport, type TacticChange } from "@/features/analysis/tacticChanges"
import { defaultTacticProfile } from "@/features/analysis/tacticProfile"
import { normalizeTacticChanges, observedTeamInstructions } from "@/features/analysis/uiTactic"

const snapshot = {
  matchId: "match-1",
  clock: { minute: 70, second: 0, elapsedMinute: 70, elapsedSecond: 0, elapsedTick: 70 * 240 },
  period: 2,
  score: { home: 1, away: 0 },
  home: { name: "Benfica", stats: {} },
  away: { name: "Nacional", stats: {} },
  players: [],
  events: [],
  xgTimeline: [],
  heatmaps: {},
  tacticalEvents: [],
  xgShots: [],
  momentum: [],
  rollingMomentum: [],
} as unknown as MatchSnapshot

const change = (sequence: number, minute: number, applied: number | null, extra: Partial<TacticChange>): TacticChange => ({
  sequence,
  kind: "uiValues",
  capturedUnixMilliseconds: sequence * 10_000,
  tick: minute * 240,
  displayTick: minute * 240,
  appliedTick: applied == null ? null : applied * 240,
  appliedDisplayTick: applied == null ? null : applied * 240,
  ...extra,
})

const raw: TacticChange[] = [
  change(1, 0, 0, { kind: "mentality", mentality: 5, initial: true }),
  change(2, 5, 5, {
    uiValues: [
      { label: "Mais rápido", icon: "in-possession-tempo-var-higher" },
      { label: "Pressão alta", icon: "team-instructions-out-of-possession-overview-line-of-engagement-var-high-press" },
    ],
  }),
  change(3, 20, 21, { uiValues: [{ label: "Mais lento", icon: "in-possession-tempo-var-lower" }] }),
  change(4, 50, 51, { kind: "mentality", mentality: 6, previousMentality: 5 }),
  change(5, 69, null, { kind: "swap" }),
]

describe("analysis drawer tabs render", () => {
  it("renders the changes timeline, newest first, with the newest card open", () => {
    const normalized = normalizeTacticChanges(raw)
    const html = renderToStaticMarkup(
      <ChangesTab report={tacticChangesReport(snapshot, "home", defaultTacticProfile, normalized)} recorded />
    )
    expect(html).toContain("Efeito do conjunto das alterações")
    expect(html.indexOf("69&#x27; · pendente")).toBeLessThan(html.indexOf("Ritmo: Mais rápido → Mais lento"))
    expect(html).toContain("Mentalidade: Positiva → Atacar")
    expect(html).toContain("Ver comparação completa")
  })

  it("explains when a match has no recorded changes", () => {
    expect(renderToStaticMarkup(<ChangesTab recorded={false} />)).toContain("Sem registo de alterações táticas")
  })

  it("groups what was read from the game by phase and keeps the editor", () => {
    const observed = observedTeamInstructions(normalizeTacticChanges(raw))
    const html = renderToStaticMarkup(<TacticTab profile={defaultTacticProfile} onChange={() => undefined} observed={observed} />)
    expect(html).toContain("Lido do jogo")
    expect(html.indexOf("Com bola")).toBeLessThan(html.indexOf("Sem bola"))
    expect(html).toContain("Bloco / linha de pressão:")
    expect(html).toContain("Editar tática de partida")
    expect(html).toContain("Instruções de equipa")
  })
})
