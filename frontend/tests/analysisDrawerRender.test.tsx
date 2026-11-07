import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { MatchSnapshot } from "@/types/match"
import { ChangesSummary, ChangesTab, OpponentTab, TacticTab } from "@/features/analysis/AnalysisDrawer"
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

describe("opponent tab", () => {
  it("renders weaknesses, team habits and the opponent's players", () => {
    const html = renderToStaticMarkup(
      <OpponentTab
        opponentName="Nacional"
        report={{
          performance: { side: "away", players: [], best: [], worst: [] },
          exploits: [
            {
              id: "pace.1.2",
              tone: "good",
              title: "Durán é bem mais rápido do que Zé Vitor",
              detail: "Bolas nas costas dele.",
              evidence: ["Durán: Velocidade 16"],
              actions: ["Dar \"Fazer mais arrancadas\" a Durán."],
              weight: 8,
              ourPlayerIds: [1],
              theirPlayerIds: [2],
            },
          ],
          tendencies: [],
          changes: [{ minute: 37, kind: "role", title: "Matheus Dias mudou de papel com bola", detail: "Médio defensivo → Médio box-to-box." }],
        }}
      />
    )
    expect(html).toContain("Pontos fracos a explorar")
    expect(html).toContain("Durán é bem mais rápido do que Zé Vitor")
    expect(html).toContain("Como o Nacional está a jogar")
    expect(html).toContain("aparece a partir dos 15 minutos")
    expect(html).toContain("O que o Nacional mudou")
    expect(html).toContain("Matheus Dias mudou de papel com bola")
  })
})

describe("summary of suggested changes", () => {
  it("lists each change once with its rules and the alternatives it beat", () => {
    const winner = {
      key: "team:progressThrough:left",
      label: "Progredir por: Esquerda",
      change: { kind: "team" as const, id: "progressThrough" as const, value: "left" },
      weight: 158,
      sources: [
        { ruleId: "opponent.dribble", ruleTitle: "Prestianni ganha o 1x1", action: "a" },
        { ruleId: "plan.opponent", ruleTitle: "Plano para dar a volta · Explorar o adversário", action: "b" },
      ],
    }
    const html = renderToStaticMarkup(
      <ChangesSummary
        consolidation={{
          changes: [winner],
          rejected: [
            {
              key: "team:progressThrough:right",
              label: "Progredir por: Direita",
              change: { kind: "team", id: "progressThrough", value: "right" },
              weight: 157,
              sources: [{ ruleId: "opponent.booked", ruleTitle: "Kokolo está amarelado", action: "c" }],
              lostTo: winner,
            },
          ],
          notes: new Map(),
        }}
      />
    )
    expect(html).toContain("Mudanças sugeridas")
    expect(html).toContain("2 regras: Prestianni ganha o 1x1 · Plano para dar a volta · Explorar o adversário")
    expect(html).toContain("Sugestões que se contradiziam")
    expect(html).toContain("Progredir por: Direita")
  })
})
